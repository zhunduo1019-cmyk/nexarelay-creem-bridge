import crypto from 'node:crypto';
import { config, requireConfig } from './config.js';

function adminHeaders() {
  const settings = config();
  const token = requireConfig(settings.oneApiAdminToken, 'ONE_API_ADMIN_TOKEN');
  return {
    [settings.oneApiAuthHeader]: settings.oneApiAuthScheme ? `${settings.oneApiAuthScheme} ${token}` : token,
    'content-type': 'application/json',
  };
}

function userHeaders(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('One API user access token is missing');
  return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

async function request(path, { accessToken, ...options } = {}) {
  const baseUrl = requireConfig(config().oneApiBaseUrl, 'ONE_API_BASE_URL').replace(/\/$/, '');
  const authHeaders = accessToken ? userHeaders(accessToken) : adminHeaders();
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...authHeaders, ...(options.headers || {}) } });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  if (!response.ok || body.success === false) throw new Error(`One API request failed ${response.status}: ${body.message || raw}`);
  return body;
}

async function findExactUser(userId, username) {
  const result = await request(`/api/user/search?keyword=${encodeURIComponent(username)}`);
  const users = Array.isArray(result.data) ? result.data : [];
  const user = users.find((item) => String(item.id) === String(userId) && item.username === username);
  if (!user) throw new Error('One API user does not match the order owner');
  return user;
}

export function redemptionNameForOrder(orderId) {
  if (typeof orderId !== 'string' || !orderId) throw new Error('A valid order id is required');
  return `nr-${crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 17)}`;
}

export const redemptionStatuses = Object.freeze({
  enabled: 1,
  disabled: 2,
  used: 3,
});

function validateCredits(credits) {
  const value = Number(credits);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('A valid credit amount is required');
  return value;
}

export async function createQuotaRedemption({ orderId, userId, username, credits }) {
  const amount = validateCredits(credits);
  const user = await findExactUser(userId, username);
  if (typeof user.access_token !== 'string' || !user.access_token) throw new Error('One API user access token is missing');

  const name = redemptionNameForOrder(orderId);
  const created = await request('/api/redemption/', {
    method: 'POST',
    body: JSON.stringify({ name, quota: amount, count: 1 }),
  });
  const key = Array.isArray(created.data) ? created.data[0] : null;
  if (typeof key !== 'string' || !key) throw new Error('One API did not return a redemption key');

  return {
    key,
    name,
    userId: user.id,
    username: user.username,
    previousQuota: Number(user.quota || 0),
    credits: amount,
  };
}

export async function findQuotaRedemption({ orderId, expectedKey, credits }) {
  const amount = validateCredits(credits);
  const name = redemptionNameForOrder(orderId);
  const result = await request(`/api/redemption/search?keyword=${encodeURIComponent(name)}`);
  const redemptions = Array.isArray(result.data) ? result.data : [];
  const matches = redemptions.filter((item) => item?.name === name
    && Number(item.quota) === amount
    && (!expectedKey || item.key === expectedKey));

  if (matches.length > 1) throw new Error('One API returned multiple matching redemptions');
  if (!matches.length) return null;

  const match = matches[0];
  if (typeof match.key !== 'string' || !match.key) throw new Error('One API redemption key is missing');
  return {
    key: match.key,
    name,
    status: Number(match.status),
    quota: Number(match.quota),
  };
}

export async function redeemQuota({ key, name, userId, username, credits }) {
  const amount = validateCredits(credits);
  if (typeof key !== 'string' || !key) throw new Error('One API redemption key is missing');
  const user = await findExactUser(userId, username);
  const result = await request('/api/user/topup', {
    accessToken: user.access_token,
    method: 'POST',
    body: JSON.stringify({ key }),
  });
  if (Number(result.data) !== amount) throw new Error('One API redeemed quota does not match this delivery');

  return {
    mode: 'redemption',
    redemptionName: name,
    userId: user.id,
    username: user.username,
    addedQuota: amount,
  };
}
