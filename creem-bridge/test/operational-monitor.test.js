import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOperationalSnapshot } from '../src/operational-monitor.js';

const safeHealth = {
  ok: true,
  databaseReady: true,
  mode: 'sandbox',
  paypalLiveEnabled: false,
  publicPaymentsEnabled: false,
  automaticQuotaClawbackEnabled: false,
};

const emptySummary = {
  queues: {
    deliveryReview: 0,
    financialReview: 0,
    unmatchedAdjustments: 0,
    stalePending: 0,
  },
};

test('operational snapshot passes only in the expected closed state', () => {
  assert.deepEqual(evaluateOperationalSnapshot(safeHealth, emptySummary), { ok: true, violations: [] });
});

test('operational snapshot reports unsafe switches and review queues', () => {
  const result = evaluateOperationalSnapshot(
    { ...safeHealth, paypalLiveEnabled: true, publicPaymentsEnabled: true },
    { queues: { ...emptySummary.queues, financialReview: 2 } },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    'paypal_live_enabled',
    'public_payments_enabled',
    'queue_not_empty:financialReview',
  ]);
});

test('operational snapshot fails closed on malformed queue counts', () => {
  const result = evaluateOperationalSnapshot(safeHealth, { queues: { deliveryReview: -1 } });
  assert.deepEqual(result, { ok: false, violations: ['invalid_queue_summary'] });
});
