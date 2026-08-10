# NexaRelay PayPal Bridge

This service is a deliberately closed-by-default payment bridge for NexaRelay.

- The historical Creem endpoints return unavailable or gone responses.
- Public payment creation remains disabled unless `PAYMENT_PUBLIC_ENABLED=true`.
- The PayPal order amount, currency, and credits are selected only from the server-side plan table.
- PostgreSQL stores orders, webhook events, and credit deliveries.
- A delivery that may have reached One API but lacks a final acknowledgement is sent to `review_required`; it is never blindly retried.

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

For the initial test, keep `PAYMENT_PUBLIC_ENABLED=false`, `PAYPAL_MODE=sandbox`, and use `x-bridge-secret` from an internal test client. Do not set live credentials or enable public payments until the complete sandbox test has succeeded.

## Routes

```text
GET   /health
POST  /api/payment/paypal/orders
POST  /api/payment/paypal/orders/:orderId/capture
POST  /api/payment/paypal/webhook
GET   /api/payment/orders/:orderId
```

`POST /api/payment/paypal/orders` requires `plan`, `userId`, and `username`. It rejects browser-supplied prices or credits because those fields are not part of the request contract.

## Secrets

Never commit or send these values in chat, screenshots, or client-side code:

```text
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID
ONE_API_ADMIN_TOKEN
DATABASE_URL
BRIDGE_CHECKOUT_SECRET
```
