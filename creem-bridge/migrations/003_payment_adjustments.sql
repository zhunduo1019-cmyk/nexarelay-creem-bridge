ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS capture_id TEXT,
  ADD COLUMN IF NOT EXISTS financial_status TEXT NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS financial_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS financial_review_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_capture_id_unique
  ON orders (provider, capture_id)
  WHERE capture_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_financial_review_idx
  ON orders (financial_review_required, updated_at)
  WHERE financial_review_required = TRUE;

WITH captured_events AS (
  SELECT DISTINCT ON (order_id)
    order_id,
    COALESCE(
      NULLIF(payload #>> '{resource,id}', ''),
      NULLIF(payload #>> '{purchase_units,0,payments,captures,0,id}', ''),
      NULLIF(split_part(provider_event_id, 'capture:', 2), '')
    ) AS capture_id
  FROM payment_events
  WHERE order_id IS NOT NULL
    AND event_type = 'PAYMENT.CAPTURE.COMPLETED'
  ORDER BY order_id, received_at DESC
)
UPDATE orders o
SET capture_id = c.capture_id
FROM captured_events c
WHERE o.id = c.order_id
  AND o.capture_id IS NULL
  AND c.capture_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_adjustments (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('paypal')),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('refund', 'reversal', 'dispute')),
  provider_adjustment_id TEXT NOT NULL,
  order_id UUID REFERENCES orders(id),
  capture_id TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency CHAR(3),
  status TEXT NOT NULL,
  reason TEXT,
  last_event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, adjustment_type, provider_adjustment_id)
);

CREATE INDEX IF NOT EXISTS payment_adjustments_order_id_idx
  ON payment_adjustments (order_id, updated_at);

CREATE INDEX IF NOT EXISTS payment_adjustments_unmatched_idx
  ON payment_adjustments (updated_at)
  WHERE order_id IS NULL;

DROP TRIGGER IF EXISTS payment_adjustments_updated_at ON payment_adjustments;
CREATE TRIGGER payment_adjustments_updated_at BEFORE UPDATE ON payment_adjustments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
