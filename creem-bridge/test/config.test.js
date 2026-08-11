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
