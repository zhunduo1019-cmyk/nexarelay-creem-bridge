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

test('admin reconciliation endpoints require the exact bridge secret', async () => {
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

      const accepted = await fetch(`${baseUrl}/api/payment/admin/orders/not-a-uuid/retry-credit`, {
        method: 'POST',
        headers: { 'x-bridge-secret': 'bridge-admin-secret' },
      });
      assert.equal(accepted.status, 400);
      assert.deepEqual(await accepted.json(), { success: false, message: 'invalid order id' });

      const drill = await fetch(`${baseUrl}/api/payment/admin/sandbox/orders/not-a-uuid/arm-post-redemption-failure`, {
        method: 'POST',
        headers: { 'x-bridge-secret': 'bridge-admin-secret' },
      });
      assert.equal(drill.status, 400);
      assert.deepEqual(await drill.json(), { success: false, message: 'invalid order id' });
    });
  } finally {
    if (previousSecret === undefined) delete process.env.BRIDGE_CHECKOUT_SECRET;
    else process.env.BRIDGE_CHECKOUT_SECRET = previousSecret;
  }
});
