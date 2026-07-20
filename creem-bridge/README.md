# NexaRelay Creem Bridge

This small service connects Creem checkout/webhooks to the current One API deployment.

Current site behavior:

- `/topup` has only redemption-code UI.
- The One API admin settings page has no built-in Creem/Cream payment configuration.
- The MVP About page currently links directly to three Creem product pages.

Automatic top-up requires changing those static Creem links to this bridge:

```text
https://pay.getnexarelay.com/checkout?plan=starter&username=ONE_API_USERNAME&email=user@example.com
https://pay.getnexarelay.com/checkout?plan=plus&username=ONE_API_USERNAME&email=user@example.com
https://pay.getnexarelay.com/checkout?plan=pro&username=ONE_API_USERNAME&email=user@example.com
```

The bridge creates a Creem checkout with metadata:

- `username`
- `email`
- `plan`
- `quota`

When Creem sends `checkout.completed`, the bridge verifies `creem-signature`, checks idempotency, finds the One API user, and adds quota.

## Endpoints

```text
GET  /health
GET  /checkout?plan=starter&username=alice&email=alice@example.com
POST /api/payment/creem/checkout
POST /api/payment/creem/webhook
```

## Deploy Notes

1. Generate a One API system access token from:
   `设置 -> 个人设置 -> 生成系统访问令牌`
2. Fill `.env` on the server.
3. Deploy this service to a public HTTPS URL, for example:
   `https://pay.getnexarelay.com`
4. In Creem test mode, set webhook URL to:
   `https://pay.getnexarelay.com/api/payment/creem/webhook`
5. Update One API About page product links to bridge checkout links.
6. Test Starter first.

## Important

Do not expose:

- `CREEM_API_KEY`
- `CREEM_WEBHOOK_SECRET`
- `ONE_API_ADMIN_TOKEN`

The `data/processed-events.json` file is a simple idempotency store for MVP testing. For production, replace it with a real database table.

