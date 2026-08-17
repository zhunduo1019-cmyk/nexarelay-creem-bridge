import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { secretsMatch, verifyOneApiCheckoutTicket } from '../src/security.js';

test('bridge secrets require an exact non-empty match', () => {
  assert.equal(secretsMatch('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(secretsMatch('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(secretsMatch('short', 'longer'), false);
  assert.equal(secretsMatch('', ''), false);
  assert.equal(secretsMatch(undefined, 'secret'), false);
});

function ticket(payload, secret) {
  const canonical = `v1\n${payload.userId}\n${payload.username}\n${payload.expiresAt}\n${payload.nonce}`;
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('base64url');
  return Buffer.from(JSON.stringify({ v: 1, ...payload, signature })).toString('base64url');
}

test('One API checkout tickets identify only a recent signed user', () => {
  const now = 1_700_000_000_000;
  const secret = 'checkout-hmac-secret';
  const payload = { userId: 3, username: 'ft0717', expiresAt: now + 10 * 60 * 1000, nonce: 'a'.repeat(24) };
  assert.deepEqual(verifyOneApiCheckoutTicket(ticket(payload, secret), secret, now), { userId: 3, username: 'ft0717' });
  assert.equal(verifyOneApiCheckoutTicket(ticket(payload, 'wrong'), secret, now), null);
  assert.equal(verifyOneApiCheckoutTicket(ticket({ ...payload, expiresAt: now - 1 }, secret), secret, now), null);
  assert.equal(verifyOneApiCheckoutTicket(ticket({ ...payload, expiresAt: now + 16 * 60 * 1000 }, secret), secret, now), null);
});
