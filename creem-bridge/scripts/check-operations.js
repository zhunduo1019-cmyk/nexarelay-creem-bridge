import { evaluateOperationalSnapshot } from '../src/operational-monitor.js';

const baseUrl = new URL(process.env.PAYMENT_BASE_URL || 'https://pay.getnexarelay.com');
const bridgeSecret = process.env.BRIDGE_CHECKOUT_SECRET;
const expectedMode = process.env.EXPECTED_PAYPAL_MODE || 'sandbox';

if (!bridgeSecret) {
  console.error('BRIDGE_CHECKOUT_SECRET is required');
  process.exit(2);
}
if (!['sandbox', 'live'].includes(expectedMode)) {
  console.error('EXPECTED_PAYPAL_MODE must be sandbox or live');
  process.exit(2);
}

async function getJson(path, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const [health, operational] = await Promise.all([
    getJson('/health'),
    getJson('/api/payment/admin/operational-summary', { 'x-bridge-secret': bridgeSecret }),
  ]);
  const assessment = evaluateOperationalSnapshot(health, operational.data, expectedMode);
  console.log(JSON.stringify({
    ok: assessment.ok,
    checkedAt: new Date().toISOString(),
    mode: health.mode,
    databaseReady: health.databaseReady,
    paypalLiveEnabled: health.paypalLiveEnabled,
    publicPaymentsEnabled: health.publicPaymentsEnabled,
    automaticQuotaClawbackEnabled: health.automaticQuotaClawbackEnabled,
    queues: operational.data?.queues,
    violations: assessment.violations,
  }));
  process.exit(assessment.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || 'operational check failed').slice(0, 200) }));
  process.exit(2);
}
