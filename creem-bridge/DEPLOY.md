# Deployment Notes

Deploy only after local migration and sandbox tests pass.

## Required Render variables

```text
PUBLIC_BASE_URL=https://pay.getnexarelay.com
DATABASE_URL=<Render PostgreSQL internal connection string>
PAYMENT_PUBLIC_ENABLED=false
PAYPAL_MODE=sandbox
PAYPAL_LIVE_ENABLED=false
PAYPAL_CLIENT_ID=<sandbox client id>
PAYPAL_CLIENT_SECRET=<sandbox client secret>
PAYPAL_WEBHOOK_ID=<sandbox webhook id>
ONE_API_BASE_URL=https://api.getnexarelay.com
ONE_API_ADMIN_TOKEN=<One API system token>
ONE_API_AUTH_HEADER=Authorization
ONE_API_AUTH_SCHEME=Bearer
BRIDGE_CHECKOUT_SECRET=<long random value>
```

Use `node src/migrate.js && node src/server.js` as the start command. Configure the PayPal sandbox webhook only after the bridge is live and `/health` returns `ok: true`.

After each deployment, verify that `/health` reports `reconciliationEnabled: true`. Review items through `GET /api/payment/admin/review-required` and retry a single paid item through `POST /api/payment/admin/orders/:orderId/retry-credit`, passing `x-bridge-secret` only from an administrator-controlled client.

The PayPal webhook must subscribe to these financial lifecycle events in addition to `PAYMENT.CAPTURE.COMPLETED`:

```text
PAYMENT.CAPTURE.REFUNDED
PAYMENT.CAPTURE.REVERSED
PAYMENT.REFUND.PENDING
PAYMENT.REFUND.FAILED
CUSTOMER.DISPUTE.CREATED
CUSTOMER.DISPUTE.UPDATED
CUSTOMER.DISPUTE.RESOLVED
```

Review them through `GET /api/payment/admin/financial-review`. `/health` must report `financialEventLedgerEnabled: true` and `automaticQuotaClawbackEnabled: false`. Financial events are ledgered and flagged for manual review; they never deduct quota automatically.

Use the repository-level `FINANCIAL_REVIEW_RUNBOOK.md` for the required operator decision. After verifying any manual One API change, record the outcome through `POST /api/payment/admin/orders/:orderId/resolve-financial-review`. The endpoint is protected by `x-bridge-secret`, writes the operator, decision, note, and resolution time, and does not change quota or account status itself.

## Verified Sandbox recovery drill

On 2026-08-11, a controlled post-redemption acknowledgement failure was injected into a USD 1.00 Sandbox order. The order entered `review_required`; the authenticated retry reconciled the already-used single-use redemption, changed the order to `credited`, and removed it from the review queue. The user balance was USD 5.02-equivalent both immediately before and after retry, confirming that recovery did not deliver quota twice. The temporary fault-injection routes were removed after the drill.

## Verified Sandbox refund drill

On 2026-08-11, a USD 1.00 full refund completed in PayPal Sandbox. The `PAYMENT.CAPTURE.REFUNDED` event was stored as a USD 1.00 refund, migration `004_reconcile_refund_links.sql` associated the event through the PayPal invoice/HATEOAS capture links, the order entered `financial_status=refunded`, and the unmatched-adjustment count became zero. The same PayPal Webhook was resent from the Sandbox Webhook Events dashboard; the database still contained exactly one payment event and one refund adjustment, confirming end-to-end idempotency. Automatic quota clawback remained disabled. The temporary authenticated Sandbox refund route was removed after verification.

## Verified Sandbox dispute drill

On 2026-08-11, a Sandbox buyer opened a USD 1.00 digital-goods dispute and later cancelled it. PayPal delivered `CUSTOMER.DISPUTE.CREATED`, three `CUSTOMER.DISPUTE.UPDATED` events, and `CUSTOMER.DISPUTE.RESOLVED`. The five events were stored against one dispute adjustment, which ended with `status=resolved` and `last_event_type=CUSTOMER.DISPUTE.RESOLVED`. The order remained `credited`, entered `financial_status=dispute_resolved`, retained `financial_review_required=true`, and had zero unmatched adjustments. No quota was deducted automatically.

## Verified Sandbox financial-review drill

On 2026-08-11, migration `005_financial_review_resolutions.sql` deployed successfully. The buyer-cancelled dispute was resolved as `no_action_no_financial_loss`, and an identical retry returned `duplicate=true`. The fully refunded USD 1.00 order passed an exact balance precondition, recovered 500,000 credits (`2,510,000 -> 2,010,000`), passed a read-back check, and was resolved as `quota_removed_full`. The financial-review queue, unmatched-adjustment queue, and credit-delivery review queue all ended at zero. Automatic quota clawback remained disabled throughout.

Do not change `PAYMENT_PUBLIC_ENABLED` to `true`, switch to `PAYPAL_MODE=live`, set `PAYPAL_LIVE_ENABLED=true`, or expose a public checkout UI during this phase.
