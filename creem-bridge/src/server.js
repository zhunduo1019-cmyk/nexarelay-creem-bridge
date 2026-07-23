import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
const eventsPath = path.join(dataDir, 'processed-events.json');

const env = process.env;
const port = Number(env.PORT || 8787);

const plans = {
  starter: {
    name: 'NexaRelay Starter Credits',
    productId: env.CREEM_PRODUCT_STARTER,
    quota: 500000,
  },
  plus: {
    name: 'NexaRelay Plus Credits',
    productId: env.CREEM_PRODUCT_PLUS,
    quota: 2800000,
  },
  pro: {
    name: 'NexaRelay Pro Credits',
    productId: env.CREEM_PRODUCT_PRO,
    quota: 6000000,
  },
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function formatQuota(quota) {
  return new Intl.NumberFormat('en-US').format(quota);
}

function renderTopupPage() {
  const rows = Object.entries(plans).map(([key, plan]) => {
    const price = key === 'starter' ? '$1' : key === 'plus' ? '$5' : '$10';
    return `
      <article class="plan">
        <div>
          <h2>${plan.name.replace('NexaRelay ', '').replace(' Credits', '')}</h2>
          <p>${formatQuota(plan.quota)} quota credits</p>
        </div>
        <strong>${price}</strong>
        <button data-plan="${key}">Buy ${key[0].toUpperCase()}${key.slice(1)}</button>
      </article>`;
  }).join('');

  const oneApiBase = (env.ONE_API_BASE_URL || 'https://api.getnexarelay.com').replace(/\/$/, '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NexaRelay Top-up</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; background: #f7f7fb; }
    main { width: min(920px, calc(100% - 32px)); margin: 48px auto; }
    h1 { margin: 0 0 8px; font-size: 36px; }
    .lead { margin: 0 0 28px; color: #4b5563; line-height: 1.6; }
    .box { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, .06); }
    label { display: block; margin-bottom: 8px; font-weight: 700; }
    input { width: 100%; min-height: 48px; border: 1px solid #d1d5db; border-radius: 6px; padding: 0 14px; font-size: 16px; }
    .hint { margin: 8px 0 22px; color: #6b7280; font-size: 14px; }
    .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .plan { display: grid; gap: 14px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 18px; background: #fcfcfd; }
    .plan h2 { margin: 0; font-size: 20px; }
    .plan p { margin: 6px 0 0; color: #6b7280; }
    .plan strong { font-size: 30px; }
    button { min-height: 46px; border: 0; border-radius: 6px; background: #111827; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; }
    .notice { margin-top: 18px; color: #6b7280; font-size: 14px; line-height: 1.6; }
    .trust { margin-top: 18px; display: grid; gap: 8px; color: #4b5563; font-size: 14px; line-height: 1.6; }
    .trust a { color: #2563eb; }
    @media (max-width: 760px) { main { margin-top: 28px; } .plans { grid-template-columns: 1fr; } h1 { font-size: 28px; } }
  </style>
</head>
<body>
  <main>
    <h1>NexaRelay API Top-up</h1>
    <p class="lead">Affordable AI API credits for Southeast Asian developers. Enter your NexaRelay username, choose a credit package, and complete payment through Creem. Credits are added automatically after payment confirmation.</p>
    <section class="box">
      <label for="username">NexaRelay username</label>
      <input id="username" autocomplete="username" placeholder="Example: ft0717">
      <p class="hint">Use the same username you use to sign in to NexaRelay. Credits cannot be delivered automatically if the username is incorrect.</p>
      <div class="plans">${rows}</div>
      <p class="notice">Payments are processed securely by Creem. For payment, account, or API access issues, contact support@getnexarelay.com.</p>
      <div class="trust">
        <div>API Base URL: <code>https://api.getnexarelay.com/v1</code></div>
        <div>Privacy Policy and Terms of Service are available on the NexaRelay About page.</div>
        <div><a href="${oneApiBase}/about">Open NexaRelay About page</a></div>
      </div>
    </section>
  </main>
  <script>
    const input = document.querySelector('#username');
    const params = new URLSearchParams(location.search);
    input.value = params.get('username') || '';
    document.querySelectorAll('button[data-plan]').forEach((button) => {
      button.addEventListener('click', () => {
        const username = input.value.trim();
        if (!username) {
          input.focus();
          alert('Please enter your NexaRelay username first.');
          return;
        }
        const checkout = new URL('/checkout', location.origin);
        checkout.searchParams.set('plan', button.dataset.plan);
        checkout.searchParams.set('username', username);
        location.href = checkout.toString();
      });
    });
  </script>
</body>
</html>`;
}

function renderSuccessPage(planKey) {
  const plan = plans[planKey];
  const quotaText = plan ? `${formatQuota(plan.quota)} quota credits` : 'quota credits';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment received</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; background: #f7f7fb; }
    main { width: min(680px, calc(100% - 32px)); margin: 72px auto; padding: 28px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; text-align: center; }
    h1 { margin: 0 0 12px; }
    p { color: #4b5563; line-height: 1.7; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 12px; padding: 0 18px; border-radius: 6px; background: #111827; color: #fff; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Payment received</h1>
    <p>Your ${quotaText} will be added automatically after webhook confirmation. This usually takes a few seconds. Please refresh your NexaRelay balance page after returning.</p>
    <a href="${(env.ONE_API_BASE_URL || 'https://api.getnexarelay.com').replace(/\/$/, '')}/topup">Return to NexaRelay</a>
  </main>
</body>
</html>`;
}

function requireEnv(name) {
  if (!env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return env[name];
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const leftValue = String(a).replace(/[^a-f0-9]/gi, '');
  const rightValue = String(b).replace(/[^a-f0-9]/gi, '');
  const left = Buffer.from(leftValue, 'hex');
  const right = Buffer.from(rightValue, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyCreemSignature(rawBody, signature) {
  const secret = requireEnv('CREEM_WEBHOOK_SECRET');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

async function loadProcessedEvents() {
  try {
    const raw = await fs.readFile(eventsPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveProcessedEvents(events) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(eventsPath, JSON.stringify(events, null, 2));
}

function oneApiHeaders() {
  const token = requireEnv('ONE_API_ADMIN_TOKEN');
  const header = env.ONE_API_AUTH_HEADER || 'Authorization';
  const scheme = env.ONE_API_AUTH_SCHEME || 'Bearer';
  const value = scheme ? `${scheme} ${token}` : token;
  return {
    [header]: value,
    'content-type': 'application/json',
  };
}

async function oneApiFetch(urlPath, options = {}) {
  const base = requireEnv('ONE_API_BASE_URL').replace(/\/$/, '');
  const res = await fetch(`${base}${urlPath}`, {
    ...options,
    headers: {
      ...oneApiHeaders(),
      ...(options.headers || {}),
    },
  });
  const textBody = await res.text();
  let body;
  try {
    body = textBody ? JSON.parse(textBody) : {};
  } catch {
    body = { raw: textBody };
  }
  if (!res.ok || body.success === false) {
    throw new Error(`One API request failed ${res.status}: ${body.message || textBody}`);
  }
  return body;
}

async function findOneApiUser({ username, email, userId }) {
  const keyword = userId || username || email;
  if (!keyword) throw new Error('Missing username/email/userId in checkout metadata');

  const body = await oneApiFetch(`/api/user/search?keyword=${encodeURIComponent(keyword)}`, {
    method: 'GET',
  });
  const users = Array.isArray(body.data) ? body.data : [];
  const user = users.find((item) => {
    if (userId && String(item.id) === String(userId)) return true;
    if (username && item.username === username) return true;
    if (email && item.email === email) return true;
    return false;
  });

  if (!user) throw new Error(`One API user not found for ${keyword}`);
  return user;
}

async function addQuotaDirect({ username, email, userId, quota }) {
  const user = await findOneApiUser({ username, email, userId });
  const currentQuota = Number(user.quota || 0);
  const nextQuota = currentQuota + Number(quota);
  const payload = {
    ...user,
    quota: nextQuota,
  };
  await oneApiFetch('/api/user/', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return {
    mode: 'direct',
    userId: user.id,
    username: user.username,
    oldQuota: currentQuota,
    addedQuota: Number(quota),
    newQuota: nextQuota,
  };
}

async function createRedemptionCode({ plan, quota, eventId }) {
  const name = `creem-${plan}-${eventId}`;
  const body = await oneApiFetch('/api/redemption/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      quota: Number(quota),
      count: 1,
    }),
  });
  return {
    mode: 'redemption',
    name,
    codes: body.data || [],
  };
}

function extractCheckoutObject(event) {
  return event?.object || event?.data?.object || event;
}

function extractProductId(checkout) {
  return checkout?.product?.id || checkout?.product || checkout?.order?.product;
}

function extractMetadata(checkout) {
  return checkout?.metadata || checkout?.subscription?.metadata || {};
}

function planFromProduct(productId) {
  const entry = Object.entries(plans).find(([, plan]) => plan.productId === productId);
  if (!entry) return null;
  return {
    key: entry[0],
    ...entry[1],
  };
}

async function createCreemCheckout({ planKey, username, email, userId }) {
  const plan = plans[planKey];
  if (!plan || !plan.productId) throw new Error(`Invalid or unconfigured plan: ${planKey}`);

  const baseUrl = requireEnv('PUBLIC_BASE_URL').replace(/\/$/, '');
  const requestId = `nexarelay_${planKey}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const payload = {
    product_id: plan.productId,
    request_id: requestId,
    units: 1,
    success_url: `${baseUrl}/success?plan=${encodeURIComponent(planKey)}`,
    metadata: {
      source: 'nexarelay-creem-bridge',
      plan: planKey,
      quota: String(plan.quota),
      username: username || '',
      email: email || '',
      userId: userId || '',
    },
  };

  if (email) payload.customer = { email };

  const apiBase = (env.CREEM_API_BASE_URL || 'https://api.creem.io').replace(/\/$/, '');
  const res = await fetch(`${apiBase}/v1/checkouts`, {
    method: 'POST',
    headers: {
      'x-api-key': requireEnv('CREEM_API_KEY'),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Creem checkout failed ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function checkBridgeSecret(req, url) {
  const expected = env.BRIDGE_CHECKOUT_SECRET;
  if (!expected) return true;
  const actual = req.headers['x-bridge-secret'] || url.searchParams.get('secret');
  return actual === expected;
}

async function handleCheckout(req, res, url) {
  if (!checkBridgeSecret(req, url)) {
    return json(res, 403, { success: false, message: 'invalid bridge secret' });
  }

  let input = {};
  if (req.method === 'POST') {
    const raw = await readBody(req);
    input = raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } else {
    input = Object.fromEntries(url.searchParams.entries());
  }

  const planKey = input.plan || 'starter';
  const checkout = await createCreemCheckout({
    planKey,
    username: input.username,
    email: input.email,
    userId: input.userId,
  });

  if (req.method === 'GET') {
    const checkoutUrl = checkout.checkout_url || checkout.url;
    if (!checkoutUrl) return json(res, 502, { success: false, message: 'Creem did not return checkout_url', checkout });
    res.writeHead(302, { location: checkoutUrl });
    return res.end();
  }

  return json(res, 200, { success: true, data: checkout });
}

async function handleWebhook(req, res) {
  const raw = await readBody(req);
  const signature = req.headers['creem-signature'];
  if (!verifyCreemSignature(raw, signature)) {
    console.warn('Creem webhook rejected: invalid signature');
    return json(res, 401, { success: false, message: 'invalid signature' });
  }

  const event = JSON.parse(raw.toString('utf8'));
  const eventId = event.id || event.event_id;
  if (!eventId) {
    console.warn('Creem webhook rejected: missing event id');
    return json(res, 400, { success: false, message: 'missing event id' });
  }

  console.log(`Creem webhook received: ${event.eventType || 'unknown'} ${eventId}`);

  const processed = await loadProcessedEvents();
  if (processed[eventId]) {
    console.log(`Creem webhook duplicate ignored: ${eventId}`);
    return json(res, 200, { success: true, duplicate: true, result: processed[eventId] });
  }

  if (event.eventType !== 'checkout.completed') {
    processed[eventId] = { ignored: true, eventType: event.eventType, at: new Date().toISOString() };
    await saveProcessedEvents(processed);
    console.log(`Creem webhook ignored: ${event.eventType} ${eventId}`);
    return json(res, 200, { success: true, ignored: true });
  }

  const checkout = extractCheckoutObject(event);
  const metadata = extractMetadata(checkout);
  const productId = extractProductId(checkout);
  const plan = planFromProduct(productId) || plans[metadata.plan];
  if (!plan) throw new Error(`Unknown Creem product id: ${productId}`);

  const quota = Number(metadata.quota || plan.quota);
  const mode = env.TOPUP_MODE || 'direct';
  const result = mode === 'redemption'
    ? await createRedemptionCode({ plan: metadata.plan || 'unknown', quota, eventId })
    : await addQuotaDirect({
      username: metadata.username,
      email: metadata.email || checkout?.customer?.email,
      userId: metadata.userId,
      quota,
    });

  processed[eventId] = {
    eventType: event.eventType,
    productId,
    quota,
    result,
    at: new Date().toISOString(),
  };
  await saveProcessedEvents(processed);
  console.log(`Creem checkout completed: event=${eventId} product=${productId} quota=${quota} result=${JSON.stringify(result)}`);

  return json(res, 200, { success: true, result });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return html(res, 200, renderTopupPage());
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/checkout') {
      return await handleCheckout(req, res, url);
    }
    if (req.method === 'POST' && url.pathname === '/api/payment/creem/checkout') {
      return await handleCheckout(req, res, url);
    }
    if (req.method === 'POST' && url.pathname === '/api/payment/creem/webhook') {
      return await handleWebhook(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/success') {
      return html(res, 200, renderSuccessPage(url.searchParams.get('plan')));
    }
    return json(res, 404, { success: false, message: 'not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { success: false, message: error.message });
  }
}

http.createServer(route).listen(port, () => {
  console.log(`NexaRelay Creem bridge listening on :${port}`);
});
