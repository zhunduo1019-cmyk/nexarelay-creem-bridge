import { config, requireConfig } from './config.js';

function paypalBaseUrl() {
  return config().paypalMode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function accessToken() {
  const settings = config();
  const clientId = requireConfig(settings.paypalClientId, 'PAYPAL_CLIENT_ID');
  const secret = requireConfig(settings.paypalClientSecret, 'PAYPAL_CLIENT_SECRET');
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`PayPal authentication failed: ${response.status}`);
  return body.access_token;
}

async function apiRequest(path, { method = 'GET', body, requestId, prefer } = {}) {
  const response = await fetch(`${paypalBaseUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json',
      ...(requestId ? { 'paypal-request-id': requestId } : {}),
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PayPal API failed ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

export function buildPaypalOrderRequest(order, publicBaseUrl) {
  const baseUrl = requireConfig(publicBaseUrl, 'PUBLIC_BASE_URL').replace(/\/+$/, '');
  const paypalReturnUrl = `${baseUrl}/api/payment/paypal/return/${encodeURIComponent(order.id)}`;
  const paypalCancelUrl = `${baseUrl}/api/payment/paypal/cancel/${encodeURIComponent(order.id)}`;

  return {
    intent: 'CAPTURE',
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'NexaRelay',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: paypalReturnUrl,
          cancel_url: paypalCancelUrl,
        },
      },
    },
    purchase_units: [{
      reference_id: order.id,
      custom_id: order.id,
      invoice_id: order.id,
      description: `${order.plan_key} prepaid API usage credits`,
      amount: {
        currency_code: order.currency,
        value: (order.amount_cents / 100).toFixed(2),
      },
    }],
  };
}

export async function createPaypalOrder(order) {
  const settings = config();
  return apiRequest('/v2/checkout/orders', {
    method: 'POST',
    requestId: `create:${order.id}`,
    body: buildPaypalOrderRequest(order, settings.publicBaseUrl),
  });
}

export async function capturePaypalOrder(providerOrderId) {
  return apiRequest(`/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, {
    method: 'POST',
    requestId: `capture:${providerOrderId}`,
    prefer: 'return=representation',
  });
}

export async function refundPaypalCapture(captureId, orderId) {
  return apiRequest(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    requestId: `sandbox-refund:${orderId}`,
    prefer: 'return=representation',
  });
}

export async function verifyPaypalWebhook(headers, event) {
  const webhookId = requireConfig(config().paypalWebhookId, 'PAYPAL_WEBHOOK_ID');
  const verification = await apiRequest('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return verification.verification_status === 'SUCCESS';
}
