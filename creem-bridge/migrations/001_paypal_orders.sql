CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('paypal')),
  provider_order_id TEXT UNIQUE,
  user_id BIGINT NOT NULL,
  username TEXT NOT NULL,
  plan_key TEXT NOT NULL CHECK (plan_key IN ('starter', 'plus', 'pro')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL,
  credits BIGINT NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'credit_pending', 'credited', 'review_required', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  credited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx ON orders (provider_order_id);
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('paypal')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id UUID REFERENCES orders(id),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS credit_deliveries (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  user_id BIGINT NOT NULL,
  credits BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'credited', 'review_required')),
  one_api_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS credit_deliveries_updated_at ON credit_deliveries;
CREATE TRIGGER credit_deliveries_updated_at BEFORE UPDATE ON credit_deliveries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
