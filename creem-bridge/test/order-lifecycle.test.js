import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsCompletedCapture, cancelPendingOrder } from '../src/order-lifecycle.js';

test('only pending or cancelled orders accept an authoritative completed capture', () => {
  assert.equal(acceptsCompletedCapture({ status: 'pending' }), true);
  assert.equal(acceptsCompletedCapture({ status: 'cancelled' }), true);
  assert.equal(acceptsCompletedCapture({ status: 'paid' }), false);
  assert.equal(acceptsCompletedCapture({ status: 'credited' }), false);
  assert.equal(acceptsCompletedCapture(null), false);
});

test('cancellation atomically requires a pristine pending order', async () => {
  const calls = [];
  const cancelledOrder = { id: 'order-1', status: 'cancelled' };
  const dbQuery = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [cancelledOrder], rowCount: 1 };
  };

  const result = await cancelPendingOrder(dbQuery, 'order-1');

  assert.deepEqual(result, { order: cancelledOrder, cancelled: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /status = 'pending'/);
  assert.match(calls[0].sql, /capture_id IS NULL/);
  assert.match(calls[0].sql, /paid_at IS NULL/);
  assert.match(calls[0].sql, /credited_at IS NULL/);
  assert.deepEqual(calls[0].params, ['order-1']);
});

test('a non-cancellable order is returned without overwriting its state', async () => {
  const calls = [];
  const paidOrder = { id: 'order-2', status: 'paid', paid_at: new Date().toISOString() };
  const dbQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return { rows: [], rowCount: 0 };
    return { rows: [paidOrder], rowCount: 1 };
  };

  const result = await cancelPendingOrder(dbQuery, 'order-2');

  assert.deepEqual(result, { order: paidOrder, cancelled: false });
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /^SELECT \* FROM orders/);
});
