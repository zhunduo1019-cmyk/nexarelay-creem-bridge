# NexaRelay PayPal Payment Launch Checklist

This file records the current PayPal safety state and the remaining production gates. Do not store Client IDs, API secrets, webhook IDs, bridge secrets, database URLs, or One API admin tokens in this repository.

## Current state

- PayPal Complete Payments access is approved.
- PayPal remains in Sandbox mode.
- Public registration and public payment creation remain disabled.
- Live credentials are staged in dedicated Render variables but are not used while `PAYPAL_MODE=sandbox` and `PAYPAL_LIVE_ENABLED=false`.
- PostgreSQL stores orders, PayPal webhook events, credit deliveries, and financial adjustments.
- Credit delivery uses a single-use One API redemption and authenticated reconciliation.
- Refund, reversal, and dispute events are ledgered idempotently and require manual review.
- Automatic quota clawback is disabled.

## Verified Sandbox controls

- USD 1.00 Starter checkout, capture, webhook handling, and quota delivery completed successfully.
- Repeated return handling did not deliver quota twice.
- A controlled post-redemption acknowledgement failure entered `review_required`.
- Authenticated retry repaired the ledger without delivering quota twice.
- The temporary fault-injection routes were removed after verification.
- A USD 1.00 full refund completed in PayPal Sandbox and produced `PAYMENT.CAPTURE.REFUNDED`.
- Migration `004_reconcile_refund_links.sql` matched the refund through PayPal invoice/HATEOAS links.
- The order is flagged `financial_status=refunded`; the unmatched-adjustment count is zero.
- Resending the same refund Webhook left exactly one payment event and one refund adjustment; the unmatched count remained zero.
- The user's delivered quota was not automatically deducted, as required by the current manual-review policy.
- The temporary Sandbox refund route was removed after the drill.
- On 2026-08-12, the deployed protected operations monitor initially found one
  Sandbox order that had remained `pending` for 44.7 hours. A read-only audit
  confirmed that PayPal returned HTTP 404 for the provider order and that the
  local order had no capture, paid timestamp, credited timestamp, delivery, or
  payment event. The order was closed as `cancelled` with all of those guards
  applied atomically. A repeated `npm run check:operations` then passed with
  delivery-review, financial-review, unmatched-adjustment, and stale-pending
  counts all at zero.
- On 2026-08-12, the encrypted Render export completed an isolated PostgreSQL
  18.4 restore drill. All four ledger tables and migrations 001-005 were
  present, aggregate row counts were readable, duplicate provider event IDs
  were zero, and a temporary bridge connected only to the restored database
  passed `/health` in the required Sandbox/closed state. No production service
  pointed at the drill database, and all temporary plaintext and runtime files
  were removed afterward.
- A Sandbox buyer opened and then cancelled a USD 1.00 digital-goods dispute.
- PayPal delivered `CUSTOMER.DISPUTE.CREATED`, three lifecycle `CUSTOMER.DISPUTE.UPDATED` events, and `CUSTOMER.DISPUTE.RESOLVED`.
- All five dispute events remained associated with one dispute adjustment; the final adjustment status is `resolved`, the order is `financial_status=dispute_resolved`, and the unmatched-adjustment count is zero.
- The credited order and delivered quota were preserved while `financial_review_required=true` remained set for an operator decision.
- The cancelled-buyer dispute was closed with `no_action_no_financial_loss`; repeating the same authenticated resolution returned a duplicate success without changing the audit record.
- The fully refunded USD 1.00 order recovered exactly 500,000 Sandbox credits after a guarded balance check (`2,510,000 -> 2,010,000`) and was closed with `quota_removed_full`.
- After both decisions, the financial-review, unmatched-adjustment, and credit-delivery review queues all contained zero items.
- A first controlled Live USD 1.00 order reached PayPal guest checkout, where
  PayPal rejected a Mainland China billing address because the seller is also
  registered in Mainland China. The buyer returned through the cancel route;
  no authorization or capture occurred, no quota was delivered, and the order
  was closed as `cancelled` with null capture, paid, and credited fields. The
  user's quota remained `2,010,000`, and the bridge was returned to Sandbox.
- On 2026-08-17, a second controlled Live USD 1.00 Starter order was created
  for One API user `ft0717` through the bridge's protected endpoint. PayPal
  returned `PAYER_ACTION_REQUIRED`, and the hosted Live checkout exposed the
  guest debit/credit-card flow through its email step. No legitimate
  non-Mainland payment method was available, so the order was deliberately
  cancelled before authorization. The ledger shows `cancelled` with null paid
  and credited timestamps; no quota was delivered. The bridge was then
  returned to the required Sandbox/Live-disabled/public-disabled state. This
  verifies Live order creation, guest-checkout reachability, token-bound
  cancellation, and the no-credit guard only; it does not verify a successful
  Live capture, Live webhook, or Live quota delivery.
- On 2026-08-17, a third controlled Live USD 1.00 Starter order was completed
  for One API user `ft0717` through the protected bridge endpoint. The order
  was captured and entered `credited`; its paid and credited timestamps were
  recorded one second apart. The ledger recorded two idempotently handled
  `PAYMENT.CAPTURE.COMPLETED` deliveries and the corresponding credit-delivery
  row is `credited`. The protected operations monitor then reported zero
  delivery-review, financial-review, unmatched-adjustment, and stale-pending
  items. A read-only One API check showed the target user's quota as
  `2,509,703`. The bridge was immediately restored to
  `PAYPAL_MODE=sandbox`, `PAYPAL_LIVE_ENABLED=false`, and
  `PAYMENT_PUBLIC_ENABLED=false`; the final public health check confirmed
  database readiness, reconciliation and ledger checks enabled, automatic
  quota clawback disabled, and public payments closed. This completes the
  controlled Live capture, webhook, ledger, and quota-delivery verification;
  it does not authorize public payment access.

## Server-side pricing

| Plan | Price | Quota Delivered |
|---|---:|---:|
| Starter Credits | USD 1.00 | 500,000 quota credits |
| Plus Credits | USD 5.00 | 2,800,000 quota credits |
| Pro Credits | USD 10.00 | 6,000,000 quota credits |

The bridge is the only authority for amount, currency, plan, and quota. Browser input and webhook metadata never choose the delivered quota.

## Required Sandbox safety state

```text
PUBLIC_BASE_URL=https://pay.getnexarelay.com
ONE_API_BASE_URL=https://api.getnexarelay.com
PAYMENT_PUBLIC_ENABLED=false
PAYPAL_MODE=sandbox
PAYPAL_LIVE_ENABLED=false
```

All credentials and tokens must remain only in Render secret environment variables.
Sandbox credentials use `PAYPAL_SANDBOX_CLIENT_ID`,
`PAYPAL_SANDBOX_CLIENT_SECRET`, and `PAYPAL_SANDBOX_WEBHOOK_ID`. Live credentials
use the independent `PAYPAL_LIVE_CLIENT_ID`, `PAYPAL_LIVE_CLIENT_SECRET`, and
`PAYPAL_LIVE_WEBHOOK_ID` slots. The legacy generic variables are Sandbox-only
fallbacks and are never accepted in Live mode.

## Required Sandbox webhook events

```text
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.REFUNDED
PAYMENT.CAPTURE.REVERSED
PAYMENT.REFUND.PENDING
PAYMENT.REFUND.FAILED
CUSTOMER.DISPUTE.CREATED
CUSTOMER.DISPUTE.UPDATED
CUSTOMER.DISPUTE.RESOLVED
```

Webhook URL:

```text
https://pay.getnexarelay.com/api/payment/paypal/webhook
```

## Production gates

Do not enable Live or public payments until every item is complete:

1. Confirm the deployed health response reports:
   - `mode: sandbox` during testing.
   - `reconciliationEnabled: true`.
   - `financialEventLedgerEnabled: true`.
   - `financialEventLinkMatchingEnabled: true`.
   - `automaticQuotaClawbackEnabled: false`.
   - `paypalLiveEnabled: false`.
   - `publicPaymentsEnabled: false`.
2. Confirm the delivery-review and financial-review queues are empty.
   - Verified 2026-08-12 through the deployed protected operations monitor:
     all four monitored queues were zero and the bridge remained in the
     Sandbox/closed state.
3. Completed 2026-08-11: the verified Sandbox refund Webhook was resent and the existing adjustment was not duplicated.
4. Completed 2026-08-11: a Sandbox dispute completed the `CREATED` -> `UPDATED` -> `RESOLVED` lifecycle, stayed linked to one adjustment, and preserved the credited order for manual review.
5. Completed 2026-08-11: `FINANCIAL_REVIEW_RUNBOOK.md` defines the no-loss, fully recoverable, partially consumed, and fully consumed quota decisions. The bridge records authenticated resolutions but never changes One API quota automatically.
6. Completed 2026-08-11: created a separate Live webhook at the bridge webhook
   URL and subscribed it to the same eight required payment and dispute events.
7. Completed 2026-08-11: stored the Live Client ID, Secret, and Webhook ID only
   in Render's dedicated `PAYPAL_LIVE_*` variables. The resulting deployment
   remained `PAYPAL_MODE=sandbox`, `PAYPAL_LIVE_ENABLED=false`, and
   `PAYMENT_PUBLIC_ENABLED=false`.
8. Completed for the blocked 2026-08-11 attempt: `PAYMENT_PUBLIC_ENABLED`
   remained `false` throughout the controlled Live window.
9. Completed for the blocked 2026-08-11 attempt: `PAYPAL_MODE=live` was enabled
   only together with `PAYPAL_LIVE_ENABLED=true`; both were returned to the
   Sandbox/false state after the attempt.
10. Completed 2026-08-17: a controlled Live payment with a legitimate
    non-Mainland China buyer payment method completed. Capture, Live webhook,
    ledger entry, quota delivery, and reconciliation queues were verified,
    after which the bridge was restored to Sandbox/closed state.
11. Completed 2026-08-17: `PILOT_PAYMENT_RUNBOOK.md` defines the closed,
    consent-based, one-time-link pilot procedure, acceptance checks,
    monitoring, incident response, and Sandbox/closed rollback. Public payment
    creation remains disabled because the bridge has no front-end login-session
    binding for a self-service pilot.

## Do not do yet

- Do not enable Live PayPal mode.
- Do not enable public payment creation.
- Do not automatically deduct quota for refunds or disputes.
- Do not delete Sandbox credentials, webhook configuration, ledger rows, or database backups.
- Completed 2026-08-12: verified an off-platform logical export and removed the database-specific external `0.0.0.0/0` rule. A reload showed zero PostgreSQL-specific CIDR entries and Render reported that all internet traffic is blocked by PostgreSQL inbound IP rules.
- Render health monitoring now calls `/health`, and the first server-side logical export completed at `2026-08-11 14:45 UTC`. The encrypted off-platform copy and isolated restore drill are complete.
- The first export now has a locally encrypted, authentication-checked copy, a verified decrypt/archive round-trip, a completed isolated PostgreSQL 18.4 restore drill, and a private independent Google Drive copy containing the encrypted backup, DPAPI key, and manifest. The Google Drive upload was verified by exact file names and displayed sizes; a remote download content-hash round-trip remains desirable but is not claimed as completed.
- Completed 2026-08-12: the Render network-rule impact review found one project
  and one Production environment containing the payment bridge, payment
  database, and `autolens-ai`. Workspace- or environment-level restrictions
  would affect `autolens-ai` and must not be used for database-only hardening.
  The PostgreSQL-specific rule was cleared without affecting Render internal
  connections. The Workspace and Environment rules remain unchanged, and the
  bridge health check still reports `ok=true` and `databaseReady=true`.
- The protected operational summary and `npm run check:operations` must report all four queues at zero before any payment-mode change. The monitor intentionally fails closed and must receive the bridge secret only through its process environment.
- Do not expose secrets in chat, screenshots, logs, GitHub, or public pages.
