import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getPlan, config } from './config.js';
import { query, withTransaction } from './db.js';
import {
  createPaypalOrder,
  capturePaypalOrder,
  verifyPaypalWebhook,
} from './paypal.js';
import {
  createQuotaRedemption,
  findQuotaRedemption,
  redeemQuota,
  redemptionStatuses,
} from './oneapi.js';
import { paymentResultPage, paypalReturnTokenMatches } from './pages.js';
import { secretsMatch } from './security.js';
import {
  captureIdFromCompletedEvent,
  describeFinancialEvent,
} from './financial-events.js';
import { financialReviewDecisions } from './financial-review-policy.js';
import { acceptsCompletedCapture, cancelPendingOrder } from './order-lifecycle.js';
import { databaseIsReady } from './readiness.js';

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
  return bridgeSecretAllowed(req);
}

function bridgeSecretAllowed(req) {
  return secretsMatch(req.headers['x-bridge-secret'], config().bridgeCheckoutSecret);
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

function safeErrorMessage(error) {
  return String(error?.message || 'credit delivery failed').replace(/[\r\n\t]+/g, ' ').slice(0, 500);
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
    await client.query(`UPDATE credit_deliveries
      SET status = 'delivering', attempt_count = attempt_count + 1, last_attempt_at = NOW(), last_error = NULL
      WHERE id = $1`, [delivery.id]);
    await client.query(`UPDATE orders SET status = 'credit_pending' WHERE id = $1`, [order.id]);
    return { action: 'deliver', order };
  });
}

async function savePreparedRedemption(orderId, prepared) {
  await query(`UPDATE credit_deliveries SET one_api_result = $1 WHERE order_id = $2`, [{
    mode: 'redemption_prepared',
    redemptionName: prepared.name,
    redemptionKey: prepared.key,
    userId: prepared.userId,
    username: prepared.username,
    credits: prepared.credits,
  }, orderId]);
}

async function completeCreditDelivery(orderId, result) {
  await withTransaction(async (client) => {
    await client.query(`UPDATE credit_deliveries
      SET status = 'credited', one_api_result = $1, delivered_at = COALESCE(delivered_at, NOW()), last_error = NULL
      WHERE order_id = $2`, [result, orderId]);
    await client.query(`UPDATE orders
      SET status = 'credited', credited_at = COALESCE(credited_at, NOW())
      WHERE id = $1`, [orderId]);
  });
}

async function markCreditReviewRequired(orderId, error) {
  const message = safeErrorMessage(error);
  await withTransaction(async (client) => {
    await client.query(`UPDATE credit_deliveries
      SET status = 'review_required', last_error = $1
      WHERE order_id = $2`, [message, orderId]);
    await client.query(`UPDATE orders SET status = 'review_required' WHERE id = $1`, [orderId]);
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
    await savePreparedRedemption(orderId, prepared);
    const result = await redeemQuota({
      key: prepared.key,
      name: prepared.name,
      userId: claim.order.user_id,
      username: claim.order.username,
      credits: claim.order.credits,
    });
    await completeCreditDelivery(orderId, result);
    return { action: 'credited', result };
  } catch (error) {
    await markCreditReviewRequired(orderId, error);
    throw error;
  }
}

async function claimReviewDelivery(orderId) {
  return withTransaction(async (client) => {
    const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orderResult.rows[0];
    if (!order) return { action: 'missing' };
    if (order.status === 'credited') return { action: 'credited', order };
    if (!order.paid_at) return { action: 'not_paid', order };
    if (!['review_required', 'credit_pending'].includes(order.status)) return { action: 'not_reviewable', order };

    const deliveryResult = await client.query('SELECT * FROM credit_deliveries WHERE order_id = $1 FOR UPDATE', [order.id]);
    const delivery = deliveryResult.rows[0];
    if (!delivery) return { action: 'missing_delivery', order };
    if (delivery.status === 'credited') return { action: 'credited', order };
    if (delivery.status === 'delivering' && Date.now() - new Date(delivery.updated_at).getTime() < 5 * 60_000) {
      return { action: 'in_progress', order, delivery };
    }
    if (!['review_required', 'delivering'].includes(delivery.status)) return { action: 'not_reviewable', order, delivery };

    await client.query(`UPDATE credit_deliveries
      SET status = 'delivering', attempt_count = attempt_count + 1, last_attempt_at = NOW(), last_error = NULL
      WHERE id = $1`, [delivery.id]);
    await client.query(`UPDATE orders SET status = 'credit_pending' WHERE id = $1`, [order.id]);
    return { action: 'retry', order, delivery };
  });
}

async function retryCreditDelivery(orderId) {
  const claim = await claimReviewDelivery(orderId);
  if (claim.action !== 'retry') return claim;

  try {
    const stored = claim.delivery.one_api_result;
    const expectedKey = stored?.mode === 'redemption_prepared' ? stored.redemptionKey : null;
    let redemption = await findQuotaRedemption({
      orderId,
      expectedKey,
      credits: claim.order.credits,
    });

    if (!redemption) {
      if (expectedKey) throw new Error('The prepared One API redemption could not be found');
      const prepared = await createQuotaRedemption({
        orderId,
        userId: claim.order.user_id,
        username: claim.order.username,
        credits: claim.order.credits,
      });
      await savePreparedRedemption(orderId, prepared);
      redemption = { ...prepared, status: redemptionStatuses.enabled, quota: prepared.credits };
    } else if (!expectedKey) {
      await savePreparedRedemption(orderId, {
        ...redemption,
        userId: claim.order.user_id,
        username: claim.order.username,
        credits: claim.order.credits,
      });
    }

    if (redemption.status === redemptionStatuses.used) {
      const reconciled = {
        mode: 'redemption_reconciled',
        redemptionName: redemption.name,
        userId: claim.order.user_id,
        username: claim.order.username,
        addedQuota: Number(claim.order.credits),
      };
      await completeCreditDelivery(orderId, reconciled);
      return { action: 'credited', result: reconciled };
    }
    if (redemption.status !== redemptionStatuses.enabled) throw new Error('One API redemption is not enabled');

    const result = await redeemQuota({
      key: redemption.key,
      name: redemption.name,
      userId: claim.order.user_id,
      username: claim.order.username,
      credits: claim.order.credits,
    });
    await completeCreditDelivery(orderId, result);
    return { action: 'credited', result };
  } catch (error) {
    await markCreditReviewRequired(orderId, error);
    throw error;
  }
}

async function markPaidAndDeliver(providerOrderId, providerEventId, eventType, payload, captureId) {
  const saved = await withTransaction(async (client) => {
    const orderResult = await client.query('SELECT * FROM orders WHERE provider_order_id = $1 FOR UPDATE', [providerOrderId]);
    const order = orderResult.rows[0];
    if (!order) return { found: false };
    if (captureId && order.capture_id && order.capture_id !== captureId) {
      throw new Error('PayPal capture ID conflicts with the stored order');
    }
    const eventInsert = await client.query(`INSERT INTO payment_events (provider, provider_event_id, event_type, order_id, payload)
      VALUES ('paypal',$1,$2,$3,$4) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`, [providerEventId, eventType, order.id, payload]);
    if (!eventInsert.rowCount) return { found: true, duplicate: true, order };
    if (acceptsCompletedCapture(order)) await client.query(`UPDATE orders
      SET status = 'paid', paid_at = NOW(), capture_id = COALESCE(capture_id, $2)
      WHERE id = $1`, [order.id, captureId || null]);
    else if (captureId) await client.query(`UPDATE orders SET capture_id = COALESCE(capture_id, $2) WHERE id = $1`, [order.id, captureId]);
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
  const settled = await markPaidAndDeliver(order.provider_order_id, `capture:${captureId}`, 'PAYMENT.CAPTURE.COMPLETED', capture, captureId);
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
  if (!paypalReturnTokenMatches(order, token)) return html(res, 400, paymentResultPage({
    title: '支付返回无效', heading: '无法验证 PayPal 返回', message: '订单标识不匹配，系统没有更改订单。', tone: 'error', order, accountUrl: accountUrl(),
  }));
  const cancellation = await cancelPendingOrder(query, localOrderId);
  const currentOrder = cancellation.order || order;
  return html(res, 200, paymentResultPage({
    title: '支付已取消', heading: '支付已取消', message: '系统没有捕获这笔付款，也没有发放额度。', tone: 'pending', order: currentOrder, accountUrl: accountUrl(),
  }));
}

function financialReviewMessage(event, descriptor, issue) {
  return [event.event_type, descriptor.status, issue, descriptor.reason]
    .filter(Boolean)
    .join(':')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}

async function recordFinancialAdjustment(event, descriptor) {
  return withTransaction(async (client) => {
    const orderByLocalResult = descriptor.localOrderId && validOrderId(descriptor.localOrderId)
      ? await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [descriptor.localOrderId])
      : { rows: [] };
    const orderByProviderResult = descriptor.providerOrderId
      ? await client.query('SELECT * FROM orders WHERE provider_order_id = $1 FOR UPDATE', [descriptor.providerOrderId])
      : { rows: [] };
    const orderByCaptureResult = descriptor.captureId
      ? await client.query('SELECT * FROM orders WHERE capture_id = $1 FOR UPDATE', [descriptor.captureId])
      : { rows: [] };
    const orderByLocal = orderByLocalResult.rows[0] || null;
    const orderByProvider = orderByProviderResult.rows[0] || null;
    const orderByCapture = orderByCaptureResult.rows[0] || null;
    const matchedOrderIds = new Set([orderByLocal?.id, orderByProvider?.id, orderByCapture?.id].filter(Boolean));
    const mappingConflict = matchedOrderIds.size > 1;
    const order = mappingConflict ? null : (orderByLocal || orderByProvider || orderByCapture);

    const eventInsert = await client.query(`INSERT INTO payment_events
      (provider, provider_event_id, event_type, order_id, payload)
      VALUES ('paypal',$1,$2,$3,$4)
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`, [
      event.id, event.event_type, order?.id || null, event,
    ]);
    if (!eventInsert.rowCount) return { duplicate: true, matched: Boolean(order), orderId: order?.id || null };

    let issue = mappingConflict ? 'order_mapping_conflict' : (!order ? 'order_not_found' : null);
    if (order && descriptor.currency && descriptor.currency !== order.currency) issue = 'currency_mismatch';
    const adjustmentStatus = issue || descriptor.status;
    const reviewReason = financialReviewMessage(event, descriptor, issue);

    await client.query(`INSERT INTO payment_adjustments
      (id, provider, adjustment_type, provider_adjustment_id, order_id, capture_id,
       amount_cents, currency, status, reason, last_event_type, payload)
      VALUES ($1,'paypal',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (provider, adjustment_type, provider_adjustment_id) DO UPDATE SET
        order_id = COALESCE(payment_adjustments.order_id, EXCLUDED.order_id),
        capture_id = COALESCE(EXCLUDED.capture_id, payment_adjustments.capture_id),
        amount_cents = COALESCE(EXCLUDED.amount_cents, payment_adjustments.amount_cents),
        currency = COALESCE(EXCLUDED.currency, payment_adjustments.currency),
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        last_event_type = EXCLUDED.last_event_type,
        payload = EXCLUDED.payload`, [
      crypto.randomUUID(), descriptor.adjustmentType, descriptor.providerAdjustmentId,
      order?.id || null, descriptor.captureId, descriptor.amountCents, descriptor.currency,
      adjustmentStatus, reviewReason, event.event_type, event,
    ]);

    if (!order) return { duplicate: false, matched: false, orderId: null, status: adjustmentStatus };

    let financialStatus = issue || descriptor.financialStatus;
    if (!issue && descriptor.adjustmentType === 'refund') {
      const refunded = await client.query(`SELECT COALESCE(SUM(amount_cents), 0)::BIGINT AS total
        FROM payment_adjustments
        WHERE order_id = $1 AND adjustment_type = 'refund' AND status = 'refunded'`, [order.id]);
      const refundedCents = Number(refunded.rows[0].total);
      if (refundedCents >= Number(order.amount_cents)) financialStatus = 'refunded';
      else if (refundedCents > 0) financialStatus = 'partially_refunded';
    }

    await client.query(`UPDATE orders
      SET financial_status = $2,
          financial_review_required = TRUE,
          financial_review_reason = $3,
          financial_review_decision = NULL,
          financial_review_note = NULL,
          financial_review_resolved_at = NULL,
          financial_review_resolved_by = NULL
      WHERE id = $1`, [order.id, financialStatus, reviewReason]);
    return { duplicate: false, matched: true, orderId: order.id, status: financialStatus };
  });
}

async function handlePaypalWebhook(req, res) {
  const event = await readJson(req);
  if (!await verifyPaypalWebhook(req.headers, event)) return json(res, 401, { success: false, message: 'invalid PayPal webhook signature' });
  if (!event.id || !event.event_type) return json(res, 400, { success: false, message: 'missing PayPal event id or type' });
  const financialEvent = describeFinancialEvent(event);
  if (financialEvent) {
    if (!financialEvent.providerAdjustmentId) return json(res, 400, { success: false, message: 'missing PayPal adjustment id' });
    const recorded = await recordFinancialAdjustment(event, financialEvent);
    return json(res, 200, {
      success: true,
      duplicate: Boolean(recorded.duplicate),
      matched: Boolean(recorded.matched),
      financialReviewRequired: true,
    });
  }
  if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return json(res, 200, { success: true, ignored: true });
  const providerOrderId = paypalOrderIdFromEvent(event);
  if (!providerOrderId) return json(res, 400, { success: false, message: 'missing PayPal order id' });
  const orderResult = await query('SELECT * FROM orders WHERE provider_order_id = $1', [providerOrderId]);
  const order = orderResult.rows[0];
  if (!order) return json(res, 404, { success: false, message: 'order not found' });
  if (event.resource?.amount?.currency_code !== order.currency || centsFromAmount(event.resource?.amount) !== Number(order.amount_cents)) {
    return json(res, 409, { success: false, message: 'PayPal webhook amount does not match this order' });
  }
  const settled = await markPaidAndDeliver(
    providerOrderId,
    event.id,
    event.event_type,
    event,
    captureIdFromCompletedEvent(event),
  );
  return json(res, 200, { success: true, duplicate: Boolean(settled.duplicate), delivery: settled.delivery?.action || null });
}

async function orderStatus(res, orderId) {
  const result = await query(`SELECT id, plan_key, amount_cents, currency, credits, status,
    created_at, paid_at, credited_at
    FROM orders WHERE id = $1`, [orderId]);
  if (!result.rowCount) return json(res, 404, { success: false, message: 'order not found' });
  return json(res, 200, { success: true, data: result.rows[0] });
}

function validOrderId(orderId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
}

async function reviewRequiredOrders(req, res, url) {
  if (!bridgeSecretAllowed(req)) return json(res, 401, { success: false, message: 'unauthorized' });
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const result = await query(`SELECT
      o.id, o.provider_order_id, o.user_id, o.username, o.plan_key, o.amount_cents, o.currency,
      o.credits, o.status, o.created_at, o.paid_at, o.credited_at,
      d.status AS delivery_status, d.attempt_count, d.last_attempt_at, d.last_error,
      d.created_at AS delivery_created_at, d.updated_at AS delivery_updated_at
    FROM orders o
    LEFT JOIN credit_deliveries d ON d.order_id = o.id
    WHERE o.status = 'review_required'
       OR (o.status = 'credit_pending' AND d.status = 'delivering' AND d.updated_at < NOW() - INTERVAL '5 minutes')
    ORDER BY COALESCE(d.updated_at, o.updated_at) ASC
    LIMIT $1`, [limit]);
  return json(res, 200, { success: true, data: result.rows });
}

async function financialReviewOrders(req, res, url) {
  if (!bridgeSecretAllowed(req)) return json(res, 401, { success: false, message: 'unauthorized' });
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const orders = await query(`SELECT
      o.id, o.provider_order_id, o.capture_id, o.user_id, o.username, o.plan_key,
      o.amount_cents, o.currency, o.credits, o.status, o.financial_status,
      o.financial_review_reason, o.financial_review_decision, o.financial_review_note,
      o.financial_review_resolved_at, o.financial_review_resolved_by,
      o.created_at, o.paid_at, o.credited_at, o.updated_at,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'adjustmentType', a.adjustment_type,
        'providerAdjustmentId', a.provider_adjustment_id,
        'captureId', a.capture_id,
        'amountCents', a.amount_cents,
        'currency', a.currency,
        'status', a.status,
        'reason', a.reason,
        'lastEventType', a.last_event_type,
        'updatedAt', a.updated_at
      ) ORDER BY a.updated_at), '[]'::jsonb)
      FROM payment_adjustments a WHERE a.order_id = o.id) AS adjustments
    FROM orders o
    WHERE o.financial_review_required = TRUE
    ORDER BY o.updated_at ASC
    LIMIT $1`, [limit]);
  const unmatched = await query(`SELECT
      adjustment_type, provider_adjustment_id, capture_id, amount_cents, currency,
      status, reason, last_event_type, created_at, updated_at
    FROM payment_adjustments
    WHERE order_id IS NULL
    ORDER BY updated_at ASC
    LIMIT $1`, [limit]);
  return json(res, 200, {
    success: true,
    data: { orders: orders.rows, unmatchedAdjustments: unmatched.rows },
  });
}

async function resolveFinancialReview(req, res, orderId) {
  if (!bridgeSecretAllowed(req)) return json(res, 401, { success: false, message: 'unauthorized' });
  if (!validOrderId(orderId)) return json(res, 400, { success: false, message: 'invalid order id' });
  const input = await readJson(req);
  const decision = String(input.decision || '');
  const operator = String(input.operator || '').trim();
  const note = String(input.note || '').trim();
  if (!financialReviewDecisions.includes(decision)) return json(res, 400, { success: false, message: 'invalid financial review decision' });
  if (!operator || operator.length > 100 || /[\r\n\t]/.test(operator)) return json(res, 400, { success: false, message: 'invalid operator identifier' });
  if (note.length < 10 || note.length > 1000 || /[\r\n\t]/.test(note)) return json(res, 400, { success: false, message: 'invalid financial review note' });

  const resolved = await withTransaction(async (client) => {
    const found = await client.query(`SELECT id, financial_status, financial_review_required,
      financial_review_decision, financial_review_note, financial_review_resolved_at,
      financial_review_resolved_by FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!found.rowCount) return { action: 'missing' };
    const existing = found.rows[0];
    if (!existing.financial_review_required) {
      const sameResolution = existing.financial_review_decision === decision
        && existing.financial_review_note === note
        && existing.financial_review_resolved_by === operator;
      return { action: sameResolution ? 'duplicate' : 'already_resolved', order: existing };
    }
    const updated = await client.query(`UPDATE orders SET
      financial_review_required = FALSE,
      financial_review_decision = $2,
      financial_review_note = $3,
      financial_review_resolved_at = NOW(),
      financial_review_resolved_by = $4
      WHERE id = $1
      RETURNING id, financial_status, financial_review_decision,
        financial_review_resolved_at, financial_review_resolved_by`, [orderId, decision, note, operator]);
    return { action: 'resolved', order: updated.rows[0] };
  });
  if (resolved.action === 'missing') return json(res, 404, { success: false, message: 'order not found' });
  if (resolved.action === 'already_resolved') return json(res, 409, { success: false, message: 'financial review is already resolved' });
  return json(res, 200, { success: true, duplicate: resolved.action === 'duplicate', data: resolved.order });
}

async function retryReviewedOrder(req, res, orderId) {
  if (!bridgeSecretAllowed(req)) return json(res, 401, { success: false, message: 'unauthorized' });
  if (!validOrderId(orderId)) return json(res, 400, { success: false, message: 'invalid order id' });
  try {
    const result = await retryCreditDelivery(orderId);
    if (result.action === 'missing') return json(res, 404, { success: false, message: 'order not found' });
    if (result.action === 'credited') return json(res, 200, { success: true, data: { orderId, status: 'credited' } });
    if (result.action === 'in_progress') return json(res, 409, { success: false, message: 'credit delivery is already in progress' });
    return json(res, 409, { success: false, message: 'order is not eligible for credit retry', reason: result.action });
  } catch (error) {
    console.error('Credit reconciliation failed:', safeErrorMessage(error));
    return json(res, 202, {
      success: false,
      message: 'credit delivery still requires review',
      data: { orderId, status: 'review_required' },
    });
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const settings = config();
      const databaseReady = await databaseIsReady(query);
      return json(res, databaseReady ? 200 : 503, {
        ok: databaseReady,
        provider: 'paypal',
        mode: settings.paypalMode,
        databaseReady,
        creditDeliveryMode: 'one_api_redemption',
        reconciliationEnabled: true,
        financialEventLedgerEnabled: true,
        financialEventLinkMatchingEnabled: true,
        automaticQuotaClawbackEnabled: false,
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
    if (req.method === 'GET' && url.pathname === '/api/payment/admin/review-required') return reviewRequiredOrders(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/payment/admin/financial-review') return financialReviewOrders(req, res, url);
    if (req.method === 'POST' && /^\/api\/payment\/admin\/orders\/[^/]+\/resolve-financial-review$/.test(url.pathname)) {
      return resolveFinancialReview(req, res, url.pathname.split('/')[5]);
    }
    if (req.method === 'POST' && /^\/api\/payment\/admin\/orders\/[^/]+\/retry-credit$/.test(url.pathname)) {
      return retryReviewedOrder(req, res, url.pathname.split('/')[5]);
    }
    if (req.method === 'GET' && /^\/api\/payment\/paypal\/return\/[^/]+$/.test(url.pathname)) return paypalReturn(res, url, url.pathname.split('/').pop());
    if (req.method === 'GET' && /^\/api\/payment\/paypal\/cancel\/[^/]+$/.test(url.pathname)) return paypalCancel(res, url, url.pathname.split('/').pop());
    if (req.method === 'GET' && /^\/api\/payment\/orders\/[^/]+$/.test(url.pathname)) return orderStatus(res, url.pathname.split('/').pop());
    return json(res, 404, { success: false, message: 'not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { success: false, message: 'payment request could not be completed' });
  }
}

export function createServer() {
  return http.createServer(route);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(port, () => console.log(`NexaRelay PayPal bridge listening on :${port}`));
}
