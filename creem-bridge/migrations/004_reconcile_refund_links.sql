WITH parsed AS (
  SELECT
    a.id AS adjustment_id,
    NULLIF(a.payload #>> '{resource,invoice_id}', '') AS local_order_id,
    substring((
      SELECT link ->> 'href'
      FROM jsonb_array_elements(COALESCE(a.payload #> '{resource,links}', '[]'::jsonb)) AS link
      WHERE link ->> 'rel' = 'up'
        AND link ->> 'href' ~ '/v2/payments/captures/'
      LIMIT 1
    ) FROM '/v2/payments/captures/([^/?#]+)') AS linked_capture_id
  FROM payment_adjustments a
  WHERE a.order_id IS NULL
), matched AS (
  SELECT p.adjustment_id, p.linked_capture_id, o.id AS order_id
  FROM parsed p
  JOIN orders o ON o.id::text = p.local_order_id OR o.capture_id = p.linked_capture_id
)
UPDATE payment_adjustments a
SET order_id = m.order_id,
    capture_id = COALESCE(a.capture_id, m.linked_capture_id),
    status = CASE
      WHEN a.last_event_type = 'PAYMENT.CAPTURE.REFUNDED' THEN 'refunded'
      WHEN a.last_event_type = 'PAYMENT.REFUND.PENDING' THEN 'pending'
      WHEN a.last_event_type = 'PAYMENT.REFUND.FAILED' THEN 'failed'
      ELSE a.status
    END,
    reason = concat(a.last_event_type, ':', CASE
      WHEN a.last_event_type = 'PAYMENT.CAPTURE.REFUNDED' THEN 'refunded'
      WHEN a.last_event_type = 'PAYMENT.REFUND.PENDING' THEN 'pending'
      WHEN a.last_event_type = 'PAYMENT.REFUND.FAILED' THEN 'failed'
      ELSE a.status
    END)
FROM matched m
WHERE a.id = m.adjustment_id;

UPDATE payment_events e
SET order_id = a.order_id
FROM payment_adjustments a
WHERE e.provider = a.provider
  AND e.provider_event_id = a.payload ->> 'id'
  AND e.order_id IS NULL
  AND a.order_id IS NOT NULL;

WITH refund_totals AS (
  SELECT order_id, COALESCE(SUM(amount_cents), 0)::BIGINT AS refunded_cents
  FROM payment_adjustments
  WHERE order_id IS NOT NULL
    AND adjustment_type = 'refund'
    AND status = 'refunded'
  GROUP BY order_id
), latest_reason AS (
  SELECT DISTINCT ON (order_id) order_id, reason
  FROM payment_adjustments
  WHERE order_id IS NOT NULL
  ORDER BY order_id, updated_at DESC
)
UPDATE orders o
SET financial_status = CASE
      WHEN r.refunded_cents >= o.amount_cents THEN 'refunded'
      ELSE 'partially_refunded'
    END,
    financial_review_required = TRUE,
    financial_review_reason = l.reason
FROM refund_totals r
LEFT JOIN latest_reason l ON l.order_id = r.order_id
WHERE o.id = r.order_id;
