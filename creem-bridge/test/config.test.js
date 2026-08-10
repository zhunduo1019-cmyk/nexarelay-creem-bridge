import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlan, plans } from '../src/config.js';

test('server-side plans have fixed prices and credits', () => {
  assert.deepEqual(getPlan('starter'), { name: 'NexaRelay Starter Credits', amountCents: 100, currency: 'USD', credits: 500000 });
  assert.deepEqual(getPlan('plus'), { name: 'NexaRelay Plus Credits', amountCents: 500, currency: 'USD', credits: 2800000 });
  assert.deepEqual(getPlan('pro'), { name: 'NexaRelay Pro Credits', amountCents: 1000, currency: 'USD', credits: 6000000 });
  assert.equal(getPlan('unknown'), null);
  assert.equal(Object.isFrozen(plans), true);
});
