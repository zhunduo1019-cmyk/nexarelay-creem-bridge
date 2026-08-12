import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';

async function withServer(work) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await work(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('admin payment review endpoints require the exact bridge secret', async () => {
  const previousSecret = process.env.BRIDGE_CHECKOUT_SECRET;
  process.env.BRIDGE_CHECKOUT_SECRET = 'bridge-admin-secret';
  try {
    await withServer(async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/payment/admin/review-required`);
      assert.equal(missing.status, 401);

      const wrong = await fetch(`${baseUrl}/api/payment/admin/review-required`, {
        headers: { 'x-bridge-secret': 'wrong-secret' },
      });
      assert.equal(wrong.status, 401);

      const financialMissing = await fetch(`${baseUrl}/api/payment/admin/financial-review`);
      assert.equal(financialMissing.status, 401);

      const financialWrong = await fetch(`${baseUrl}/api/payment/admin/financial-review`, {
        headers: { 'x-bridge-secret': 'wrong-secret' },
      });
      assert.equal(financialWrong.status, 401);

      const operationalMissing = await fetch(`${baseUrl}/api/payment/admin/operational-summary`);
      assert.equal(operationalMissing.status, 401);

      const operationalWrong = await fetch(`${baseUrl}/api/payment/admin/operational-summary`, {
        headers: { 'x-bridge-secret': 'wrong-secret' },
      });
      assert.equal(operationalWrong.status, 401);

      const accepted = await fetch(`${baseUrl}/api/payment/admin/orders/not-a-uuid/retry-credit`, {
        method: 'POST',
        headers: { 'x-bridge-secret': 'bridge-admin-secret' },
      });
      assert.equal(accepted.status, 400);
      assert.deepEqual(await accepted.json(), { success: false, message: 'invalid order id' });

      const financialResolveMissing = await fetch(`${baseUrl}/api/payment/admin/orders/not-a-uuid/resolve-financial-review`, {
        method: 'POST',
      });
      assert.equal(financialResolveMissing.status, 401);

      const financialResolveInvalidId = await fetch(`${baseUrl}/api/payment/admin/orders/not-a-uuid/resolve-financial-review`, {
        method: 'POST',
        headers: { 'x-bridge-secret': 'bridge-admin-secret' },
      });
      assert.equal(financialResolveInvalidId.status, 400);
      assert.deepEqual(await financialResolveInvalidId.json(), { success: false, message: 'invalid order id' });

      const financialResolveInvalidDecision = await fetch(`${baseUrl}/api/payment/admin/orders/11111111-1111-4111-8111-111111111111/resolve-financial-review`, {
        method: 'POST',
        headers: { 'x-bridge-secret': 'bridge-admin-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'delete_everything', operator: 'test', note: 'invalid decision test' }),
      });
      assert.equal(financialResolveInvalidDecision.status, 400);
      assert.deepEqual(await financialResolveInvalidDecision.json(), { success: false, message: 'invalid financial review decision' });

    });
  } finally {
    if (previousSecret === undefined) delete process.env.BRIDGE_CHECKOUT_SECRET;
    else process.env.BRIDGE_CHECKOUT_SECRET = previousSecret;
  }
});
