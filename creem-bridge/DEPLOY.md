# Deploy Creem Bridge

Recommended first deployment: Render Web Service.

## Required Environment Variables

Fill these in the hosting platform's environment settings:

```text
PUBLIC_BASE_URL=https://YOUR-BRIDGE-DOMAIN
ONE_API_BASE_URL=https://api.getnexarelay.com
CREEM_API_BASE_URL=https://api.creem.io
CREEM_API_KEY=creem_test_xxx
CREEM_WEBHOOK_SECRET=whsec_xxx
CREEM_PRODUCT_STARTER=prod_xxx
CREEM_PRODUCT_PLUS=prod_xxx
CREEM_PRODUCT_PRO=prod_xxx
ONE_API_ADMIN_TOKEN=one_api_system_token_xxx
ONE_API_AUTH_HEADER=Authorization
ONE_API_AUTH_SCHEME=Bearer
TOPUP_MODE=direct
BRIDGE_CHECKOUT_SECRET=
```

Use test-mode Creem values first.

## Render Steps

1. Push this repository to GitHub.
2. In Render, create a new Web Service from the repository.
3. Set Root Directory:

```text
creem-bridge
```

4. Set Build Command empty.
5. Set Start Command:

```text
node src/server.js
```

6. Add the environment variables above.
7. Deploy.
8. Open:

```text
https://YOUR-BRIDGE-DOMAIN/health
```

Expected:

```json
{"ok":true}
```

## Creem Webhook URL

After deployment, set the Creem test webhook URL to:

```text
https://YOUR-BRIDGE-DOMAIN/api/payment/creem/webhook
```

## First Checkout Test

Open:

```text
https://YOUR-BRIDGE-DOMAIN/checkout?plan=starter&username=YOUR_ONE_API_USERNAME
```

Complete a Creem test checkout, then confirm the user's One API quota increased by `500000`.

## Custom Domain

After the Render URL works, map:

```text
pay.getnexarelay.com
```

Then update:

```text
PUBLIC_BASE_URL=https://pay.getnexarelay.com
```

And change Creem webhook URL to:

```text
https://pay.getnexarelay.com/api/payment/creem/webhook
```

