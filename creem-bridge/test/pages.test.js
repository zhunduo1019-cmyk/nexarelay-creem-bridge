import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentResultPage, paypalReturnTokenMatches } from '../src/pages.js';

test('PayPal return token must match the stored provider order id', () => {
  const order = { provider_order_id: 'PAYPAL-123' };
  assert.equal(paypalReturnTokenMatches(order, 'PAYPAL-123'), true);
  assert.equal(paypalReturnTokenMatches(order, 'PAYPAL-456'), false);
  assert.equal(paypalReturnTokenMatches(order, null), false);
  assert.equal(paypalReturnTokenMatches({}, 'PAYPAL-123'), false);
});

test('payment result page escapes order and URL values', () => {
  const page = paymentResultPage({
    title: '<Paid>',
    heading: 'Done & safe',
    message: 'No <script>',
    tone: 'success',
    order: { id: '<order>', plan_key: 'starter', credits: 500000 },
    accountUrl: 'https://example.com/user?x=1&y=2',
  });

  assert.match(page, /&lt;Paid&gt;/);
  assert.match(page, /Done &amp; safe/);
  assert.match(page, /No &lt;script&gt;/);
  assert.match(page, /&lt;order&gt;/);
  assert.match(page, /x=1&amp;y=2/);
  assert.doesNotMatch(page, /No <script>/);
});

test('pending result page refreshes only to the supplied retry URL', () => {
  const page = paymentResultPage({
    title: 'Pending', heading: 'Pending', message: 'Pending', tone: 'pending',
    order: { id: 'order-1', plan_key: 'starter', credits: 500000 },
    retryUrl: 'https://pay.example/return/order-1?token=PAYPAL-1',
  });
  assert.match(page, /http-equiv="refresh"/);
  assert.match(page, /token=PAYPAL-1/);
});
