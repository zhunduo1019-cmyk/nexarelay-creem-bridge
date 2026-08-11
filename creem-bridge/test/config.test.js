import test from 'node:test';
import assert from 'node:assert/strict';
import { config, getPlan, plans } from '../src/config.js';

test('server-side plans have fixed prices and credits', () => {
  assert.deepEqual(getPlan('starter'), { name: 'NexaRelay Starter Credits', amountCents: 100, currency: 'USD', credits: 500000 });
  assert.deepEqual(getPlan('plus'), { name: 'NexaRelay Plus Credits', amountCents: 500, currency: 'USD', credits: 2800000 });
  assert.deepEqual(getPlan('pro'), { name: 'NexaRelay Pro Credits', amountCents: 1000, currency: 'USD', credits: 6000000 });
  assert.equal(getPlan('unknown'), null);
  assert.equal(Object.isFrozen(plans), true);
});

test('live mode requires an independent explicit opt-in', () => {
  const previousMode = process.env.PAYPAL_MODE;
  const previousLiveEnabled = process.env.PAYPAL_LIVE_ENABLED;
  try {
    process.env.PAYPAL_MODE = 'live';
    delete process.env.PAYPAL_LIVE_ENABLED;
    assert.throws(() => config(), /PAYPAL_LIVE_ENABLED=true/);

    process.env.PAYPAL_LIVE_ENABLED = 'true';
    assert.equal(config().paypalMode, 'live');
    assert.equal(config().paypalLiveEnabled, true);
  } finally {
    if (previousMode === undefined) delete process.env.PAYPAL_MODE;
    else process.env.PAYPAL_MODE = previousMode;
    if (previousLiveEnabled === undefined) delete process.env.PAYPAL_LIVE_ENABLED;
    else process.env.PAYPAL_LIVE_ENABLED = previousLiveEnabled;
  }
});

test('sandbox and live credentials remain in separate slots', () => {
  const keys = [
    'PAYPAL_MODE',
    'PAYPAL_LIVE_ENABLED',
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'PAYPAL_WEBHOOK_ID',
    'PAYPAL_SANDBOX_CLIENT_ID',
    'PAYPAL_SANDBOX_CLIENT_SECRET',
    'PAYPAL_SANDBOX_WEBHOOK_ID',
    'PAYPAL_LIVE_CLIENT_ID',
    'PAYPAL_LIVE_CLIENT_SECRET',
    'PAYPAL_LIVE_WEBHOOK_ID',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.PAYPAL_MODE = 'sandbox';
    process.env.PAYPAL_LIVE_ENABLED = 'false';
    process.env.PAYPAL_CLIENT_ID = 'legacy-sandbox-client';
    process.env.PAYPAL_CLIENT_SECRET = 'legacy-sandbox-secret';
    process.env.PAYPAL_WEBHOOK_ID = 'legacy-sandbox-webhook';
    process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sandbox-client';
    process.env.PAYPAL_SANDBOX_CLIENT_SECRET = 'sandbox-secret';
    process.env.PAYPAL_SANDBOX_WEBHOOK_ID = 'sandbox-webhook';
    process.env.PAYPAL_LIVE_CLIENT_ID = 'live-client';
    process.env.PAYPAL_LIVE_CLIENT_SECRET = 'live-secret';
    process.env.PAYPAL_LIVE_WEBHOOK_ID = 'live-webhook';

    assert.deepEqual(
      {
        clientId: config().paypalClientId,
        clientSecret: config().paypalClientSecret,
        webhookId: config().paypalWebhookId,
      },
      { clientId: 'sandbox-client', clientSecret: 'sandbox-secret', webhookId: 'sandbox-webhook' },
    );

    process.env.PAYPAL_MODE = 'live';
    process.env.PAYPAL_LIVE_ENABLED = 'true';
    assert.deepEqual(
      {
        clientId: config().paypalClientId,
        clientSecret: config().paypalClientSecret,
        webhookId: config().paypalWebhookId,
      },
      { clientId: 'live-client', clientSecret: 'live-secret', webhookId: 'live-webhook' },
    );

    delete process.env.PAYPAL_LIVE_CLIENT_ID;
    delete process.env.PAYPAL_LIVE_CLIENT_SECRET;
    delete process.env.PAYPAL_LIVE_WEBHOOK_ID;
    assert.deepEqual(
      {
        clientId: config().paypalClientId,
        clientSecret: config().paypalClientSecret,
        webhookId: config().paypalWebhookId,
      },
      { clientId: undefined, clientSecret: undefined, webhookId: undefined },
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
