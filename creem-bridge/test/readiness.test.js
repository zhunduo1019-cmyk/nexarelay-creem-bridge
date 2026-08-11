import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseIsReady } from '../src/readiness.js';

test('database readiness requires every payment ledger table', async () => {
  const ready = await databaseIsReady(async () => ({ rows: [{
    orders: true,
    payment_events: true,
    credit_deliveries: true,
    payment_adjustments: true,
  }] }));

  assert.equal(ready, true);
});

test('database readiness fails closed when a ledger table is missing', async () => {
  const ready = await databaseIsReady(async () => ({ rows: [{
    orders: true,
    payment_events: true,
    credit_deliveries: true,
    payment_adjustments: false,
  }] }));

  assert.equal(ready, false);
});

test('database readiness does not expose connection errors', async () => {
  const ready = await databaseIsReady(async () => {
    throw new Error('secret database host and password');
  });

  assert.equal(ready, false);
});
