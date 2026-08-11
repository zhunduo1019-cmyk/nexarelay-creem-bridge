ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS financial_review_decision TEXT,
  ADD COLUMN IF NOT EXISTS financial_review_note TEXT,
  ADD COLUMN IF NOT EXISTS financial_review_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS financial_review_resolved_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_financial_review_decision_check'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_financial_review_decision_check CHECK (
      financial_review_decision IS NULL OR financial_review_decision IN (
        'no_action_no_financial_loss',
        'quota_removed_full',
        'quota_removed_partial_account_restricted',
        'account_restricted_quota_consumed',
        'manual_exception'
      )
    );
  END IF;
END $$;

