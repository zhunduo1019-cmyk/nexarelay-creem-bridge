# Deployment Notes

Deploy only after local migration and sandbox tests pass.

## Required Render variables

```text
PUBLIC_BASE_URL=https://pay.getnexarelay.com
DATABASE_URL=<Render PostgreSQL internal connection string>
PAYMENT_PUBLIC_ENABLED=false
PAYPAL_MODE=sandbox
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

Do not change `PAYMENT_PUBLIC_ENABLED` to `true`, switch to `PAYPAL_MODE=live`, or expose a public checkout UI during this phase.
