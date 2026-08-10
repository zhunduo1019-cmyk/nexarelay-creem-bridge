import { config, requireConfig } from './config.js';

function headers() {
  const settings = config();
  const token = requireConfig(settings.oneApiAdminToken, 'ONE_API_ADMIN_TOKEN');
  return {
    [settings.oneApiAuthHeader]: settings.oneApiAuthScheme ? `${settings.oneApiAuthScheme} ${token}` : token,
    'content-type': 'application/json',
  };
}

async function request(path, options = {}) {
  const baseUrl = requireConfig(config().oneApiBaseUrl, 'ONE_API_BASE_URL').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  if (!response.ok || body.success === false) throw new Error(`One API request failed ${response.status}: ${body.message || raw}`);
  return body;
}

export async function addQuota({ userId, username, credits }) {
  const result = await request(`/api/user/search?keyword=${encodeURIComponent(userId || username)}`);
  const users = Array.isArray(result.data) ? result.data : [];
  const user = users.find((item) => String(item.id) === String(userId) && item.username === username);
  if (!user) throw new Error('One API user does not match the order owner');

  const previousQuota = Number(user.quota || 0);
  await request('/api/user/', { method: 'PUT', body: JSON.stringify({ ...user, quota: previousQuota + Number(credits) }) });
  return { userId: user.id, username: user.username, oldQuota: previousQuota, addedQuota: Number(credits), newQuota: previousQuota + Number(credits) };
}
