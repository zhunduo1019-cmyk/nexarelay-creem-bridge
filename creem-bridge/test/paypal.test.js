import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaypalOrderRequest } from '../src/paypal.js';

test('PayPal order uses a pay-now flow for digital credits', () => {
  const order = {
    id: 'order/with spaces',
    plan_key: 'starter',
    amount_cents: 100,
    currency: 'USD',
  };

  const request = buildPaypalOrderRequest(order, 'https://pay.getnexarelay.com/');

  assert.equal(request.intent, 'CAPTURE');
  assert.deepEqual(request.payment_source.paypal.experience_context, {
    brand_name: 'NexaRelay',
    shipping_preference: 'NO_SHIPPING',
    user_action: 'PAY_NOW',
    return_url: 'https://pay.getnexarelay.com/api/payment/paypal/return/order%2Fwith%20spaces',
    cancel_url: 'https://pay.getnexarelay.com/api/payment/paypal/cancel/order%2Fwith%20spaces',
  });
  assert.deepEqual(request.purchase_units, [{
    reference_id: order.id,
    custom_id: order.id,
    invoice_id: order.id,
    description: 'starter prepaid API usage credits',
    amount: { currency_code: 'USD', value: '1.00' },
  }]);
});

test('PayPal order requires the public base URL', () => {
  assert.throws(
    () => buildPaypalOrderRequest({ id: 'order-1', plan_key: 'starter', amount_cents: 100, currency: 'USD' }),
    /Missing required environment variable: PUBLIC_BASE_URL/,
  );
});
