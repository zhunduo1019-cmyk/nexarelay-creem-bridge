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

## Verified Sandbox recovery drill

On 2026-08-11, a controlled post-redemption acknowledgement failure was injected into a USD 1.00 Sandbox order. The order entered `review_required`; the authenticated retry reconciled the already-used single-use redemption, changed the order to `credited`, and removed it from the review queue. The user balance was USD 5.02-equivalent both immediately before and after retry, confirming that recovery did not deliver quota twice. The temporary fault-injection routes were removed after the drill.

Do not change `PAYMENT_PUBLIC_ENABLED` to `true`, switch to `PAYPAL_MODE=live`, set `PAYPAL_LIVE_ENABLED=true`, or expose a public checkout UI during this phase.
