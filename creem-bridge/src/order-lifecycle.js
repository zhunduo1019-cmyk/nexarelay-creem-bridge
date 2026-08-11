export function acceptsCompletedCapture(order) {
  return order?.status === 'pending' || order?.status === 'cancelled';
}

export async function cancelPendingOrder(dbQuery, orderId) {
  const cancelled = await dbQuery(`UPDATE orders
    SET status = 'cancelled'
    WHERE id = $1
      AND status = 'pending'
      AND capture_id IS NULL
      AND paid_at IS NULL
      AND credited_at IS NULL
    RETURNING *`, [orderId]);

  if (cancelled.rows[0]) return { order: cancelled.rows[0], cancelled: true };

  const current = await dbQuery('SELECT * FROM orders WHERE id = $1', [orderId]);
  return { order: current.rows[0] || null, cancelled: false };
}
