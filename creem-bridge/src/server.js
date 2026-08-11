import http from 'node:http';
import crypto from 'node:crypto';
import { getPlan, config } from './config.js';
import { query, withTransaction } from './db.js';
import { createPaypalOrder, capturePaypalOrder, verifyPaypalWebhook } from './paypal.js';
import { createQuotaRedemption, redeemQuota } from './oneapi.js';
import { paymentResultPage, paypalReturnTokenMatches } from './pages.js';
import { secretsMatch } from './security.js';

const port = Number(process.env.PORT || 8787);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new Error('request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function paymentAccessAllowed(req) {
  const settings = config();
  if (settings.publicPaymentsEnabled) return true;
  return secretsMatch(req.headers['x-bridge-secret'], settings.bridgeCheckoutSecret);
}

function parseOwner(input) {
  const userId = Number(input.userId);
  const username = String(input.username || '');
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[A-Za-z0-9_.-]{1,64}$/.test(username)) throw new Error('A valid One API userId and username are required');
  return { userId, username };
}

function orderResponse(order, paypalOrder) {
  return {
    success: true,
    data: {
      orderId: order.id,
      providerOrderId: paypalOrder.id,
      status: paypalOrder.status,
      approvalUrl: paypalOrder.links?.find((link) => link.rel === 'payer-action' || link.rel === 'approve')?.href || null,
    },
  };
}

function paypalOrderIdFromEvent(event) {
  return event.resource?.supplementary_data?.related_ids?.order_id || event.resource?.id || null;
}

function centsFromAmount(amount) {
  return Math.round(Number(amount?.value || 0) * 100);
}

async function createOrder(req, res) {
  if (!paymentAccessAllowed(req)) return json(res, 503, { success: false, message: 'Online card top-ups are currently unavailable.' });
  const input = await readJson(req);
  const plan = getPlan(input.plan);
  if (!plan) return json(res, 400, { success: false, message: 'invalid plan' });
  const owner = parseOwner(input);
  const order = {
    id: crypto.randomUUID(), provider: 'paypal', user_id: owner.userId, username: owner.username,
    plan_key: input.plan, amount_cents: plan.amountCents, currency: plan.currency, credits: plan.credits, status: 'pending',
  };
  await query(`INSERT INTO orders (id, provider, user_id, username, plan_key, amount_cents, currency, credits, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [order.id, order.provider, order.user_id, order.username, order.plan_key, order.amount_cents, order.currency, order.credits, order.status]);
  try {
    const paypalOrder = await createPaypalOrder(order);
    await query('UPDATE orders SET provider_order_id = $1 WHERE id = $2', [paypalOrder.id, order.id]);
    return json(res, 201, orderResponse(order, paypalOrder));
  } catch (error) {
    await query(`UPDATE orders SET status = 'review_required' WHERE id = $1`, [order.id]);
    throw error;
  }
}

async function claimCreditDelivery(orderId) {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = result.rows[0];
    if (!order) return { action: 'missing' };
    if (order.status === 'credited') return { action: 'credited', order };
    if (!['paid', 'credit_pending'].includes(order.status)) return { action: 'not_paid', order };
    await client.query(`INSERT INTO credit_deliveries (id, order_id, user_id, credits, status)
      VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (order_id) DO NOTHING`, [crypto.randomUUID(), order.id, order.user_id, order.credits]);
    const deliveryResult = await client.query('SELECT * FROM credit_deliveries WHERE order_id = $1 FOR UPDATE', [order.id]);
    const delivery = deliveryResult.rows[0];
    if (delivery.status === 'credited') return { action: 'credited', order };
    if (delivery.status === 'delivering') {
      await client.query(`UPDATE orders SET status = 'review_required' WHERE id = $1`, [order.id]);
      return { action: 'review_required', order };
    }
    await client.query(`UPDATE credit_deliveries SET status = 'delivering' WHERE id = $1`, [delivery.id]);
    await client.query(`UPDATE orders SET status = 'credit_pending' WHERE id = $1`, [order.id]);
    return { action: 'deliver', order };
  });
}

async function deliverCredits(orderId) {
  const claim = await claimCreditDelivery(orderId);
  if (claim.action !== 'deliver') return claim;
  try {
    const prepared = await createQuotaRedemption({
      orderId,
      userId: claim.order.user_id,
      username: claim.order.username,
      credits: claim.order.credits,
    });
    await query(`UPDATE credit_deliveries SET one_api_result = $1 WHERE order_id = $2`, [{
      mode: 'redemption_prepared',
      redemptionName: prepared.name,
      redemptionKey: prepared.key,
      userId: prepared.userId,
      username: prepared.username,
      credits: prepared.credits,
    }, orderId]);
    const result = await redeemQuota({
      key: prepared.key,
      name: prepared.name,
      userId: claim.order.user_id,
      username: claim.order.username,
      credits: claim.order.credits,
    });
    await withTransaction(async (client) => {
      await client.query(`UPDATE credit_deliveries SET status = 'credited', one_api_result = $1, delivered_at = NOW() WHERE order_id = $2`, [result, orderId]);
      await client.query(`UPDATE orders SET status = 'credited', credited_at = NOW() WHERE id = $1`, [orderId]);
    });
    return { action: 'credited', result };
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query(`UPDATE credit_deliveries SET status = 'review_required' WHERE order_id = $1`, [orderId]);
      await client.query(`UPDATE orders SET status = 'review_required' WHERE id = $1`, [orderId]);
    });
    throw error;
  }
}

async function markPaidAndDeliver(providerOrderId, providerEventId, eventType, payload) {
  const saved = await withTransaction(async (client) => {
    const orderResult = await client.query('SELECT * FROM orders WHERE provider_order_id = $1 FOR UPDATE', [providerOrderId]);
    const order = orderResult.rows[0];
    if (!order) return { found: false };
    const eventInsert = await client.query(`INSERT INTO payment_events (provider, provider_event_id, event_type, order_id, payload)
      VALUES ('paypal',$1,$2,$3,$4) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`, [providerEventId, eventType, order.id, payload]);
    if (!eventInsert.rowCount) return { found: true, duplicate: true, order };
    if (order.status === 'pending') await client.query(`UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = $1`, [order.id]);
    return { found: true, order };
  });
  if (!saved.found || saved.duplicate) return saved;
  return { ...saved, delivery: await deliverCredits(saved.order.id) };
}

function captureMatchesOrder(capture, order) {
  const captureData = capture.purchase_units?.[0]?.payments?.captures?.[0];
  return capture.status === 'COMPLETED' && captureData && captureData.status === 'COMPLETED'
    && captureData.amount?.currency_code === order.currency && centsFromAmount(captureData.amount) === Number(order.amount_cents);
}

async function settleCapturedOrder(localOrderId) {
  const found = await query('SELECT * FROM orders WHERE id = $1', [localOrderId]);
  const order = found.rows[0];
  if (!order) return { missing: true };
  if (order.status === 'credited') return { order, alreadyCredited: true };
  if (!order.provider_order_id) throw new Error('PayPal provider order is missing');

  const capture = await capturePaypalOrder(order.provider_order_id);
  if (!captureMatchesOrder(capture, order)) throw new Error('PayPal capture does not match this order');
  const captureId = capture.purchase_units[0].payments.captures[0].id;
  const settled = await markPaidAndDeliver(order.provider_order_id, `capture:${captureId}`, 'PAYMENT.CAPTURE.COMPLETED', capture);
  const currentResult = await query('SELECT * FROM orders WHERE id = $1', [localOrderId]);
  return { order: currentResult.rows[0] || order, capture, settled };
}

async function captureOrder(req, res, localOrderId) {
  if (!paymentAccessAllowed(req)) return json(res, 503, { success: false, message: 'Online card top-ups are currently unavailable.' });
  const result = await settleCapturedOrder(localOrderId);
  if (result.missing) return json(res, 404, { success: false, message: 'order not found' });
  if (result.alreadyCredited) return json(res, 200, { success: true, data: { orderId: result.order.id, status: result.order.status } });
  return json(res, 200, {
    success: true,
    data: {
      orderId: result.order.id,
      captureStatus: result.capture.status,
      delivery: result.settled.delivery?.action || result.order.status,
    },
  });
}

function accountUrl() {
  const baseUrl = config().oneApiBaseUrl;
  if (!baseUrl) return null;
  try {
    return new URL('/user', baseUrl).toString();
  } catch {
    return null;
  }
}

async function paypalReturn(res, url, localOrderId) {
  const found = await query('SELECT * FROM orders WHERE id = $1', [localOrderId]);
  const order = found.rows[0];
  if (!order) return html(res, 404, paymentResultPage({
    title: '订单不存在', heading: '找不到这笔订单', message: '请返回 NexaRelay 后重新发起支付。', tone: 'error', accountUrl: accountUrl(),
  }));

  if (!paypalReturnTokenMatches(order, url.searchParams.get('token'))) return html(res, 400, paymentResultPage({
    title: '支付返回无效', heading: '无法验证 PayPal 返回', message: '订单标识不匹配，系统没有执行捕获。', tone: 'error', order, accountUrl: accountUrl(),
  }));

  const retryUrl = `${url.pathname}${url.search}`;
  if (order.status === 'credited') return html(res, 200, paymentResultPage({
    title: '支付成功', heading: '支付完成，额度已到账', message: '这笔订单已经处理完成，无需重复操作。', tone: 'success', order, accountUrl: accountUrl(),
  }));
  if (order.status === 'review_required') return html(res, 202, paymentResultPage({
    title: '订单待复核', heading: '付款正在人工复核', message: '请勿再次付款。管理员会根据订单账本处理。', tone: 'error', order, accountUrl: accountUrl(),
  }));

  try {
    const result = await settleCapturedOrder(localOrderId);
    if (result.order.status === 'credited') return html(res, 200, paymentResultPage({
      title: '支付成功', heading: '支付完成，额度已到账', message: 'PayPal 已确认付款，NexaRelay 额度已经发放。', tone: 'success', order: result.order, accountUrl: accountUrl(),
    }));
    return html(res, 202, paymentResultPage({
      title: '正在处理', heading: '付款已确认，正在发放额度', message: '页面会自动刷新，请勿再次付款。', tone: 'pending', order: result.order, accountUrl: accountUrl(), retryUrl,
    }));
  } catch (error) {
    console.error('PayPal return capture failed:', error.message);
    const currentResult = await query('SELECT * FROM orders WHERE id = $1', [localOrderId]);
    const currentOrder = currentResult.rows[0] || order;
    const needsReview = currentOrder.status === 'review_required';
    return html(res, needsReview ? 202 : 503, paymentResultPage({
      title: needsReview ? '订单待复核' : '支付处理中',
      heading: needsReview ? '付款正在人工复核' : '暂时无法确认付款',
      message: needsReview ? '请勿再次付款。管理员会根据订单账本处理。' : 'PayPal 状态暂未确认，请稍后刷新本页。',
      tone: needsReview ? 'error' : 'pending',
      order: currentOrder,
      accountUrl: accountUrl(),
      retryUrl: needsReview ? null : retryUrl,
    }));
  }
}

async function paypalCancel(res, url, localOrderId) {
  const found = await query('SELECT * FROM orders WHERE id = $1', [localOrderId]);
  const order = found.rows[0];
  if (!order) return html(res, 404, paymentResultPage({
    title: '订单不存在', heading: '找不到这笔订单', message: '请返回 NexaRelay 后重新发起支付。', tone: 'error', accountUrl: accountUrl(),
  }));
  const token = url.searchParams.get('token');
  if (token && !paypalReturnTokenMatches(order, token)) return html(res, 400, paymentResultPage({
    title: '支付返回无效', heading: '无法验证 PayPal 返回', message: '订单标识不匹配，系统没有更改订单。', tone: 'error', order, accountUrl: accountUrl(),
  }));
  return html(res, 200, paymentResultPage({
    title: '支付已取消', heading: '支付已取消', message: '系统没有捕获这笔付款，也没有发放额度。', tone: 'pending', order, accountUrl: accountUrl(),
  }));
}

async function handlePaypalWebhook(req, res) {
  const event = await readJson(req);
  if (!await verifyPaypalWebhook(req.headers, event)) return json(res, 401, { success: false, message: 'invalid PayPal webhook signature' });
  if (!event.id || !event.event_type) return json(res, 400, { success: false, message: 'missing PayPal event id or type' });
  if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return json(res, 200, { success: true, ignored: true });
  const providerOrderId = paypalOrderIdFromEvent(event);
  if (!providerOrderId) return json(res, 400, { success: false, message: 'missing PayPal order id' });
  const orderResult = await query('SELECT * FROM orders WHERE provider_order_id = $1', [providerOrderId]);
  const order = orderResult.rows[0];
  if (!order) return json(res, 404, { success: false, message: 'order not found' });
  if (event.resource?.amount?.currency_code !== order.currency || centsFromAmount(event.resource?.amount) !== Number(order.amount_cents)) {
    return json(res, 409, { success: false, message: 'PayPal webhook amount does not match this order' });
  }
  const settled = await markPaidAndDeliver(providerOrderId, event.id, event.event_type, event);
  return json(res, 200, { success: true, duplicate: Boolean(settled.duplicate), delivery: settled.delivery?.action || null });
}

async function orderStatus(res, orderId) {
  const result = await query('SELECT id, plan_key, amount_cents, currency, credits, status, created_at, paid_at, credited_at FROM orders WHERE id = $1', [orderId]);
  if (!result.rowCount) return json(res, 404, { success: false, message: 'order not found' });
  return json(res, 200, { success: true, data: result.rows[0] });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const settings = config();
      return json(res, 200, {
        ok: true,
        provider: 'paypal',
        mode: settings.paypalMode,
        creditDeliveryMode: 'one_api_redemption',
        paypalLiveEnabled: settings.paypalLiveEnabled,
        publicPaymentsEnabled: settings.publicPaymentsEnabled,
      });
    }
    if (req.method === 'GET' && url.pathname === '/') return json(res, 200, { success: false, message: 'Online card top-ups are currently unavailable.' });
    if ((req.method === 'GET' || req.method === 'POST') && (url.pathname === '/checkout' || url.pathname === '/api/payment/creem/checkout')) return json(res, 503, { success: false, message: 'Online card top-ups are currently unavailable.' });
    if (req.method === 'POST' && url.pathname === '/api/payment/creem/webhook') return json(res, 410, { success: false, message: 'Creem payments are no longer supported.' });
    if (req.method === 'POST' && url.pathname === '/api/payment/paypal/orders') return createOrder(req, res);
    if (req.method === 'POST' && /^\/api\/payment\/paypal\/orders\/[^/]+\/capture$/.test(url.pathname)) return captureOrder(req, res, url.pathname.split('/')[5]);
    if (req.method === 'POST' && url.pathname === '/api/payment/paypal/webhook') return handlePaypalWebhook(req, res);
    if (req.method === 'GET' && /^\/api\/payment\/paypal\/return\/[^/]+$/.test(url.pathname)) return paypalReturn(res, url, url.pathname.split('/').pop());
    if (req.method === 'GET' && /^\/api\/payment\/paypal\/cancel\/[^/]+$/.test(url.pathname)) return paypalCancel(res, url, url.pathname.split('/').pop());
    if (req.method === 'GET' && /^\/api\/payment\/orders\/[^/]+$/.test(url.pathname)) return orderStatus(res, url.pathname.split('/').pop());
    return json(res, 404, { success: false, message: 'not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { success: false, message: 'payment request could not be completed' });
  }
}

http.createServer(route).listen(port, () => console.log(`NexaRelay PayPal bridge listening on :${port}`));
