# NexaRelay PayPal Bridge

This service is a deliberately closed-by-default payment bridge for NexaRelay.

- The historical Creem endpoints return unavailable or gone responses.
- Public payment creation remains disabled unless `PAYMENT_PUBLIC_ENABLED=true`.
- The PayPal order amount, currency, and credits are selected only from the server-side plan table.
- PayPal checkout uses `PAY_NOW` with no shipping because all plans deliver digital API credits.
- Approval returns to a token-bound bridge route that performs an idempotent capture. A token-bound cancellation atomically closes only a pristine pending order; a later verified completed-capture event remains authoritative and safely restores the paid delivery flow.
- PostgreSQL stores orders, webhook events, and credit deliveries.
- Credit delivery uses a single-use One API redemption code. One API consumes the code and increments quota atomically in its own transaction, avoiding read-modify-write quota races.
- A delivery that may have reached One API but lacks a final acknowledgement is sent to `review_required`; it is never blindly retried. An authenticated reconciliation retry first inspects the original single-use redemption: an unused code is redeemed once, while an already-used code only repairs the local ledger.

## Plans

| Plan | Amount | Credits |
| --- | ---: | ---: |
| Starter | USD 1.00 | 500,000 |
| Plus | USD 5.00 | 2,800,000 |
| Pro | USD 10.00 | 6,000,000 |

## Local setup

1. Copy `.env.example` to `.env` and fill values outside source control.
2. Create a PostgreSQL database and set `DATABASE_URL`.
3. Run `npm install`, then `npm run migrate`.
4. Run `npm test`.
5. Run `npm start`.

For the initial test, keep `PAYMENT_PUBLIC_ENABLED=false`, `PAYPAL_MODE=sandbox`, `PAYPAL_LIVE_ENABLED=false`, and use `x-bridge-secret` from an internal test client. After the complete Sandbox test succeeds, Live credentials may be staged only in the dedicated `PAYPAL_LIVE_*` variables; staging them must not change any activation switch.

Live mode is fail-closed: `PAYPAL_MODE=live` is rejected unless the separate `PAYPAL_LIVE_ENABLED=true` switch is also present. Sandbox and Live credentials occupy independent `PAYPAL_SANDBOX_*` and `PAYPAL_LIVE_*` variables; Live mode never falls back to the legacy generic Sandbox variables. Keep the Live switch false until the production-readiness review is complete.

## Routes

```text
GET   /health
POST  /api/payment/paypal/orders
POST  /api/payment/paypal/orders/:orderId/capture
POST  /api/payment/paypal/webhook
GET   /api/payment/paypal/return/:orderId
GET   /api/payment/paypal/cancel/:orderId
GET   /api/payment/orders/:orderId
GET   /api/payment/admin/review-required
GET   /api/payment/admin/financial-review
POST  /api/payment/admin/orders/:orderId/retry-credit
```

`POST /api/payment/paypal/orders` requires `plan`, `userId`, and `username`. It rejects browser-supplied prices or credits because those fields are not part of the request contract.

PayPal redirects approved buyers to the return route. The route verifies PayPal's `token` against the stored provider order ID, captures the approved order with an idempotency key, delivers credits once, and renders a user-facing result page. The cancel route requires the same token match and atomically changes only an unpaid, uncaptured, uncredited `pending` order to `cancelled`; it never captures an order.

Both admin reconciliation routes always require the exact `x-bridge-secret`, even if public payments are enabled. The list route never returns the stored redemption key. Retry only accepts paid orders in a reviewable state and records attempt count, timestamp, and the latest sanitized error in PostgreSQL.

Refund, reversal, and dispute webhooks are stored idempotently in `payment_events` and summarized in `payment_adjustments`. They update a separate financial status and enter the authenticated financial-review queue without changing a successfully delivered order back from `credited`. The bridge intentionally does not deduct quota automatically; a refund can be partial, a dispute can later resolve for the seller, and already-delivered API quota may have been consumed.

## Secrets

Never commit or send these values in chat, screenshots, or client-side code:

```text
PAYPAL_SANDBOX_CLIENT_SECRET
PAYPAL_SANDBOX_WEBHOOK_ID
PAYPAL_LIVE_CLIENT_SECRET
PAYPAL_LIVE_WEBHOOK_ID
ONE_API_ADMIN_TOKEN
DATABASE_URL
BRIDGE_CHECKOUT_SECRET
```
