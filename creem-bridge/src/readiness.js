const requiredTables = Object.freeze([
  'orders',
  'payment_events',
  'credit_deliveries',
  'payment_adjustments',
]);

export async function databaseIsReady(dbQuery) {
  try {
    const result = await dbQuery(`SELECT
      to_regclass('public.orders') IS NOT NULL AS orders,
      to_regclass('public.payment_events') IS NOT NULL AS payment_events,
      to_regclass('public.credit_deliveries') IS NOT NULL AS credit_deliveries,
      to_regclass('public.payment_adjustments') IS NOT NULL AS payment_adjustments`);
    const row = result.rows?.[0];
    return Boolean(row) && requiredTables.every((table) => row[table] === true);
  } catch {
    return false;
  }
}
