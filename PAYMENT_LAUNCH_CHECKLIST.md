# NexaRelay PayPal Payment Launch Checklist

This file records the current PayPal safety state and the remaining production gates. Do not store Client IDs, API secrets, webhook IDs, bridge secrets, database URLs, or One API admin tokens in this repository.

## Current state

- PayPal Complete Payments access is approved.
- PayPal remains in Sandbox mode.
- Public registration and public payment creation remain disabled.
- Live credentials are not used.
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
- A Sandbox buyer opened and then cancelled a USD 1.00 digital-goods dispute.
- PayPal delivered `CUSTOMER.DISPUTE.CREATED`, three lifecycle `CUSTOMER.DISPUTE.UPDATED` events, and `CUSTOMER.DISPUTE.RESOLVED`.
- All five dispute events remained associated with one dispute adjustment; the final adjustment status is `resolved`, the order is `financial_status=dispute_resolved`, and the unmatched-adjustment count is zero.
- The credited order and delivered quota were preserved while `financial_review_required=true` remained set for an operator decision.

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
3. Completed 2026-08-11: the verified Sandbox refund Webhook was resent and the existing adjustment was not duplicated.
4. Completed 2026-08-11: a Sandbox dispute completed the `CREATED` -> `UPDATED` -> `RESOLVED` lifecycle, stayed linked to one adjustment, and preserved the credited order for manual review.
5. Completed 2026-08-11: `FINANCIAL_REVIEW_RUNBOOK.md` defines the no-loss, fully recoverable, partially consumed, and fully consumed quota decisions. The bridge records authenticated resolutions but never changes One API quota automatically.
6. Create a separate Live webhook and subscribe to the same required events.
7. Store Live credentials and the Live webhook ID only in Render.
8. Keep `PAYMENT_PUBLIC_ENABLED=false` for the first controlled Live USD 1.00 payment.
9. Enable `PAYPAL_MODE=live` only together with the independent `PAYPAL_LIVE_ENABLED=true` gate.
10. Verify the first controlled Live payment, webhook, ledger entry, quota delivery, and reconciliation queues before considering public access.

## Do not do yet

- Do not enable Live PayPal mode.
- Do not enable public payment creation.
- Do not automatically deduct quota for refunds or disputes.
- Do not delete Sandbox credentials, webhook configuration, ledger rows, or database backups.
- Do not expose secrets in chat, screenshots, logs, GitHub, or public pages.
