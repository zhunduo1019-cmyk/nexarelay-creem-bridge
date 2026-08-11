const rawPlans = {
  starter: { name: 'NexaRelay Starter Credits', amountCents: 100, currency: 'USD', credits: 500000 },
  plus: { name: 'NexaRelay Plus Credits', amountCents: 500, currency: 'USD', credits: 2800000 },
  pro: { name: 'NexaRelay Pro Credits', amountCents: 1000, currency: 'USD', credits: 6000000 },
};

export const plans = Object.freeze(rawPlans);

export function getPlan(planKey) {
  return plans[planKey] || null;
}

export function config() {
  const mode = process.env.PAYPAL_MODE || 'sandbox';
  if (!['sandbox', 'live'].includes(mode)) throw new Error('PAYPAL_MODE must be sandbox or live');
  const paypalLiveEnabled = process.env.PAYPAL_LIVE_ENABLED === 'true';
  if (mode === 'live' && !paypalLiveEnabled) {
    throw new Error('PAYPAL_MODE=live requires PAYPAL_LIVE_ENABLED=true');
  }

  return {
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    oneApiBaseUrl: process.env.ONE_API_BASE_URL,
    oneApiAdminToken: process.env.ONE_API_ADMIN_TOKEN,
    oneApiAuthHeader: process.env.ONE_API_AUTH_HEADER || 'Authorization',
    oneApiAuthScheme: process.env.ONE_API_AUTH_SCHEME || 'Bearer',
    paypalMode: mode,
    paypalLiveEnabled,
    paypalClientId: process.env.PAYPAL_CLIENT_ID,
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET,
    paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID,
    publicPaymentsEnabled: process.env.PAYMENT_PUBLIC_ENABLED === 'true',
    bridgeCheckoutSecret: process.env.BRIDGE_CHECKOUT_SECRET,
  };
}

export function requireConfig(value, name) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
