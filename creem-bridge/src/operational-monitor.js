export function evaluateOperationalSnapshot(health, summary, expectedMode = 'sandbox') {
  const violations = [];
  if (health?.ok !== true) violations.push('bridge_unhealthy');
  if (health?.databaseReady !== true) violations.push('database_not_ready');
  if (health?.mode !== expectedMode) violations.push('unexpected_paypal_mode');
  if (health?.paypalLiveEnabled !== false) violations.push('paypal_live_enabled');
  if (health?.publicPaymentsEnabled !== false) violations.push('public_payments_enabled');
  if (health?.automaticQuotaClawbackEnabled !== false) violations.push('automatic_quota_clawback_enabled');

  const queues = summary?.queues;
  if (!queues || !Object.values(queues).every((value) => Number.isSafeInteger(value) && value >= 0)) {
    violations.push('invalid_queue_summary');
  } else {
    for (const [name, count] of Object.entries(queues)) {
      if (count > 0) violations.push(`queue_not_empty:${name}`);
    }
  }

  return { ok: violations.length === 0, violations };
}
