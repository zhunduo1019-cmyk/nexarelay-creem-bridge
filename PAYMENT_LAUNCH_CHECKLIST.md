# NexaRelay Payment Launch Checklist

This file records the current Creem test setup and the production switch plan.
Do not store API keys, webhook secrets, or admin tokens in this repository.

## Current Status

- Creem production payout review has been resubmitted.
- Creem production payouts are not enabled yet.
- Render should stay on Creem test mode until Creem approves production payouts.
- Test checkout, test webhook, and automatic NexaRelay quota top-up have been verified successfully.
- Public payment domain is verified and active:
  - `https://pay.getnexarelay.com`
- Creem webhook URL should be:
  - `https://pay.getnexarelay.com/api/payment/creem/webhook`

## Test Mode Configuration

Keep these values in Render while production review is pending:

```text
CREEM_API_BASE_URL=https://test-api.creem.io
PUBLIC_BASE_URL=https://pay.getnexarelay.com
ONE_API_BASE_URL=https://api.getnexarelay.com
TOPUP_MODE=direct
ONE_API_AUTH_HEADER=Authorization
```

The following values must remain secret in Render:

```text
CREEM_API_KEY=<Creem test API key>
CREEM_WEBHOOK_SECRET=<Creem test webhook signing secret>
CREEM_PRODUCT_STARTER=<Creem test Starter product ID>
CREEM_PRODUCT_PLUS=<Creem test Plus product ID>
CREEM_PRODUCT_PRO=<Creem test Pro product ID>
ONE_API_ADMIN_TOKEN=<NexaRelay / One API admin token>
```

## Pricing and Quota Mapping

| Plan | Price | Quota Delivered |
|---|---:|---:|
| Starter Credits | USD 1.00 | 500,000 quota credits |
| Plus Credits | USD 5.00 | 2,800,000 quota credits |
| Pro Credits | USD 10.00 | 6,000,000 quota credits |

## Production Switch Plan

Only start this section after Creem shows production payouts enabled.

1. In Creem live mode, confirm or create these live products:
   - NexaRelay Starter Credits
   - NexaRelay Plus Credits
   - NexaRelay Pro Credits
2. Copy the live product IDs.
3. Create a live API key.
4. Create a live webhook:
   - Name: `NexaRelay Production Webhook`
   - URL: `https://pay.getnexarelay.com/api/payment/creem/webhook`
   - Required event: `checkout.completed`
5. Copy the live webhook signing secret.
6. In Render, update these environment variables:

```text
CREEM_API_BASE_URL=https://api.creem.io
CREEM_API_KEY=<Creem live API key>
CREEM_WEBHOOK_SECRET=<Creem live webhook signing secret>
CREEM_PRODUCT_STARTER=<Creem live Starter product ID>
CREEM_PRODUCT_PLUS=<Creem live Plus product ID>
CREEM_PRODUCT_PRO=<Creem live Pro product ID>
```

7. Keep these existing Render values unchanged:

```text
PUBLIC_BASE_URL=https://pay.getnexarelay.com
ONE_API_BASE_URL=https://api.getnexarelay.com
TOPUP_MODE=direct
ONE_API_AUTH_HEADER=Authorization
ONE_API_ADMIN_TOKEN=<existing NexaRelay / One API admin token>
```

8. Click `Save, rebuild, and deploy` in Render.
9. Wait until Render shows `Live`.
10. Run one real USD 1.00 Starter payment.
11. Verify:
   - Creem live order is successful.
   - Creem live webhook is successful.
   - Render logs show the webhook and quota top-up.
   - NexaRelay user balance increases.

## Public Site Trust Checklist

Before requesting or maintaining production approval, public pages should show:

- Public pricing for Starter, Plus, and Pro.
- Clear top-up instructions.
- Privacy Policy.
- Terms of Service.
- Support email: `support@getnexarelay.com`.
- API Base URL: `https://api.getnexarelay.com/v1`.

## Do Not Do Yet

- Do not switch Render to live Creem values before production payouts are approved.
- Do not delete test products or test webhooks.
- Do not expose API keys, webhook secrets, or admin tokens in GitHub or public pages.
- Do not run broad public launch traffic before a real USD 1.00 live payment test succeeds.
