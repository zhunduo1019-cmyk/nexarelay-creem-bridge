import test from 'node:test';
import assert from 'node:assert/strict';
import {
  armPostRedemptionFailure,
  consumePostRedemptionFailure,
  sandboxDrillAvailable,
} from '../src/sandbox-drill.js';

test('sandbox reconciliation drill is fail-closed outside private sandbox mode', () => {
  assert.equal(sandboxDrillAvailable({
    paypalMode: 'sandbox', paypalLiveEnabled: false, publicPaymentsEnabled: false,
  }), true);
  assert.equal(sandboxDrillAvailable({
    paypalMode: 'live', paypalLiveEnabled: true, publicPaymentsEnabled: false,
  }), false);
  assert.equal(sandboxDrillAvailable({
    paypalMode: 'sandbox', paypalLiveEnabled: false, publicPaymentsEnabled: true,
  }), false);
  assert.equal(sandboxDrillAvailable({
    paypalMode: 'sandbox', paypalLiveEnabled: true, publicPaymentsEnabled: false,
  }), false);
});

test('armed post-redemption failure is scoped to one order and consumed once', () => {
  armPostRedemptionFailure('order-a');
  assert.equal(consumePostRedemptionFailure('order-b'), false);
  assert.equal(consumePostRedemptionFailure('order-a'), true);
  assert.equal(consumePostRedemptionFailure('order-a'), false);
});
