import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureIdFromCompletedEvent,
  centsFromFinancialAmount,
  describeFinancialEvent,
} from '../src/financial-events.js';

test('financial amounts are parsed without floating point rounding', () => {
  assert.equal(centsFromFinancialAmount({ value: '1.00' }), 100);
  assert.equal(centsFromFinancialAmount({ value: '0.5' }), 50);
  assert.equal(centsFromFinancialAmount({ value: '1.001' }), null);
  assert.equal(centsFromFinancialAmount({ value: '-1.00' }), null);
});

test('refunded capture is linked by capture id', () => {
  assert.deepEqual(describeFinancialEvent({
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: {
      id: 'REFUND-1',
      invoice_id: '11111111-1111-4111-8111-111111111111',
      amount: { value: '1.00', currency_code: 'USD' },
      links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-1' }],
    },
  }), {
    adjustmentType: 'refund', providerAdjustmentId: 'REFUND-1',
    localOrderId: '11111111-1111-4111-8111-111111111111', providerOrderId: null,
    captureId: 'CAPTURE-1', amountCents: 100, currency: 'USD', status: 'refunded',
    reason: null, financialStatus: 'partially_refunded',
  });
});

test('capture reversal retains both order and capture identifiers', () => {
  const result = describeFinancialEvent({
    event_type: 'PAYMENT.CAPTURE.REVERSED',
    resource: {
      id: 'CAPTURE-2', amount: { value: '5.00', currency_code: 'USD' },
      supplementary_data: { related_ids: { order_id: 'ORDER-2' } },
    },
  });
  assert.equal(result.adjustmentType, 'reversal');
  assert.equal(result.localOrderId, null);
  assert.equal(result.providerOrderId, 'ORDER-2');
  assert.equal(result.captureId, 'CAPTURE-2');
  assert.equal(result.financialStatus, 'reversed');
});

test('completed capture exposes the identifier stored on the order', () => {
  assert.equal(captureIdFromCompletedEvent({ resource: { id: 'CAPTURE-4' } }), 'CAPTURE-4');
  assert.equal(captureIdFromCompletedEvent({ resource: {} }), null);
});

test('dispute is linked by seller transaction id and preserves outcome', () => {
  const result = describeFinancialEvent({
    event_type: 'CUSTOMER.DISPUTE.RESOLVED',
    resource: {
      dispute_id: 'PP-D-1', status: 'RESOLVED', reason: 'UNAUTHORISED',
      dispute_amount: { value: '0.50', currency_code: 'USD' },
      disputed_transactions: [{ transaction_info: { seller_transaction_id: 'CAPTURE-3' } }],
      dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' },
    },
  });
  assert.equal(result.providerAdjustmentId, 'PP-D-1');
  assert.equal(result.localOrderId, null);
  assert.equal(result.captureId, 'CAPTURE-3');
  assert.equal(result.amountCents, 50);
  assert.equal(result.status, 'resolved');
  assert.equal(result.reason, 'UNAUTHORISED:RESOLVED_BUYER_FAVOUR');
  assert.equal(result.financialStatus, 'dispute_resolved');
});

test('unrelated webhook events are ignored', () => {
  assert.equal(describeFinancialEvent({ event_type: 'CHECKOUT.ORDER.APPROVED' }), null);
});
