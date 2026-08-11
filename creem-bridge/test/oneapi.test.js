import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createQuotaRedemption,
  findQuotaRedemption,
  redeemQuota,
  redemptionNameForOrder,
  redemptionStatuses,
} from '../src/oneapi.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function withMockedOneApi(responses, work) {
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.ONE_API_BASE_URL;
  const previousToken = process.env.ONE_API_ADMIN_TOKEN;
  const calls = [];
  process.env.ONE_API_BASE_URL = 'https://one-api.example';
  process.env.ONE_API_ADMIN_TOKEN = 'admin-secret';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  };
  try {
    return await work(calls);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.ONE_API_BASE_URL;
    else process.env.ONE_API_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.ONE_API_ADMIN_TOKEN;
    else process.env.ONE_API_ADMIN_TOKEN = previousToken;
  }
}

test('redemption names are deterministic and fit One API limits', () => {
  const name = redemptionNameForOrder('6c9a6845-c2da-431f-9b33-9acfebdceca3');
  assert.equal(name, redemptionNameForOrder('6c9a6845-c2da-431f-9b33-9acfebdceca3'));
  assert.match(name, /^nr-[a-f0-9]{17}$/);
  assert.equal(name.length, 20);
});

test('quota delivery creates one server-side redemption without exposing the user token', async () => {
  await withMockedOneApi([
    response({ success: true, data: [{ id: 4, username: 'tester2', quota: 100, access_token: 'user-secret' }] }),
    response({ success: true, data: ['redemption-secret'] }),
  ], async (calls) => {
    const prepared = await createQuotaRedemption({ orderId: 'order-1', userId: 4, username: 'tester2', credits: 500000 });
    assert.deepEqual(prepared, {
      key: 'redemption-secret',
      name: redemptionNameForOrder('order-1'),
      userId: 4,
      username: 'tester2',
      previousQuota: 100,
      credits: 500000,
    });
    assert.equal(calls[0].url, 'https://one-api.example/api/user/search?keyword=tester2');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-secret');
    assert.deepEqual(JSON.parse(calls[1].options.body), { name: prepared.name, quota: 500000, count: 1 });
    assert.equal(JSON.stringify(prepared).includes('user-secret'), false);
  });
});

test('quota delivery redeems with the matched user token and verifies the amount', async () => {
  await withMockedOneApi([
    response({ success: true, data: [{ id: 4, username: 'tester2', quota: 100, access_token: 'user-secret' }] }),
    response({ success: true, data: 500000 }),
  ], async (calls) => {
    const result = await redeemQuota({ key: 'redemption-secret', name: 'nr-order', userId: 4, username: 'tester2', credits: 500000 });
    assert.deepEqual(result, { mode: 'redemption', redemptionName: 'nr-order', userId: 4, username: 'tester2', addedQuota: 500000 });
    assert.equal(calls[1].options.headers.authorization, 'Bearer user-secret');
    assert.deepEqual(JSON.parse(calls[1].options.body), { key: 'redemption-secret' });
    assert.equal(JSON.stringify(result).includes('user-secret'), false);
    assert.equal(JSON.stringify(result).includes('redemption-secret'), false);
  });
});

test('reconciliation finds the exact deterministic redemption without exposing unrelated codes', async () => {
  const orderId = 'order-2';
  const name = redemptionNameForOrder(orderId);
  await withMockedOneApi([
    response({ success: true, data: [
      { id: 10, name: `${name}-other`, key: 'wrong-name', quota: 500000, status: redemptionStatuses.enabled },
      { id: 11, name, key: 'wrong-quota', quota: 1, status: redemptionStatuses.enabled },
      { id: 12, name, key: 'expected-key', quota: 500000, status: redemptionStatuses.used },
    ] }),
  ], async (calls) => {
    const found = await findQuotaRedemption({ orderId, expectedKey: 'expected-key', credits: 500000 });
    assert.deepEqual(found, {
      key: 'expected-key',
      name,
      status: redemptionStatuses.used,
      quota: 500000,
    });
    assert.equal(calls[0].url, `https://one-api.example/api/redemption/search?keyword=${encodeURIComponent(name)}`);
  });
});

test('reconciliation refuses ambiguous redemptions', async () => {
  const orderId = 'order-3';
  const name = redemptionNameForOrder(orderId);
  await withMockedOneApi([
    response({ success: true, data: [
      { id: 20, name, key: 'key-1', quota: 500000, status: redemptionStatuses.enabled },
      { id: 21, name, key: 'key-2', quota: 500000, status: redemptionStatuses.enabled },
    ] }),
  ], async () => {
    await assert.rejects(
      findQuotaRedemption({ orderId, credits: 500000 }),
      /multiple matching redemptions/,
    );
  });
});
