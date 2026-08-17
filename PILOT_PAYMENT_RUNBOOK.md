# NexaRelay Closed Payment Pilot Runbook

This runbook governs a closed, invitation-only PayPal pilot. It does not
authorize public payment creation, public registration, or self-service
checkout.

## Non-negotiable service state

Keep the deployed bridge in this state before, during, and after every pilot
invite:

```text
PAYMENT_PUBLIC_ENABLED=false
PAYPAL_MODE=sandbox
PAYPAL_LIVE_ENABLED=false
```

Live mode may be enabled only for the short, recorded window required to
create a single approved Live checkout invitation. Return to the state above
immediately after the order is created, or after its capture/cancellation is
verified. Never send `BRIDGE_CHECKOUT_SECRET`, PayPal credentials, database
URLs, or One API administrative credentials to an invitee.

## Pilot eligibility and consent

Before creating an invitation, record all of the following outside of the
payment database:

1. Exact One API user ID and username, verified by an operator.
2. The user's explicit agreement to receive a real PayPal checkout link.
3. The selected server-side plan (`starter`, `plus`, or `pro`) and its posted
   price.
4. A private delivery channel controlled by that user.
5. The user's acknowledgement that they must use their own lawful PayPal
   account or payment method and billing address.

Do not invite a user solely because their username is known. Do not collect,
request, transmit, or handle their card number, PayPal password, OTP, or
billing-address details.

## Create one invitation

1. Confirm `/health` reports `publicPaymentsEnabled:false` and a ready
   database.
2. Temporarily use the dedicated Live configuration only if this is an
   approved real-payment invitation. Keep public payments disabled.
3. From the Render Web Shell, call the protected
   `POST /api/payment/paypal/orders` route with the bridge secret supplied
   only from `process.env.BRIDGE_CHECKOUT_SECRET`, and pass the verified
   user ID, username, and plan.
4. Privately send only the returned one-time PayPal approval URL to the
   consented invitee. Do not publish it in an issue, chat room, screenshot,
   repository, or public page.
5. The invitee completes or cancels the checkout themselves. An operator
   never enters or receives payment credentials.
6. Immediately restore the required Sandbox/closed configuration once the
   outcome has been observed.

## Acceptance checks

For a completed invitation, verify all of the following before recording a
successful pilot result:

- The bridge order is `credited` and has non-null `paid_at` and `credited_at`.
- The `credit_deliveries` row is `credited` for the same order.
- `payment_events` contains the captured-payment event; duplicate deliveries
  must be idempotent and must not create a second credit delivery.
- The protected operational summary reports zero for `deliveryReview`,
  `financialReview`, `unmatchedAdjustments`, and `stalePending`.
- A read-only One API check confirms the intended user's current quota.
- The final `/health` response reports Sandbox mode, Live disabled, public
  payments disabled, database ready, reconciliation enabled, and automatic
  quota clawback disabled.

For a cancellation or failed checkout, verify the order is `cancelled` (or
still pending only while the user is actively checking out), with no paid or
credited timestamp and no credit delivery.

## Monitoring and incident response

- Keep the Render `/health` monitor and the protected operations monitor
  enabled. Check both immediately after every pilot outcome.
- Preserve PostgreSQL backups and the existing isolated restore procedure.
- For a webhook, delivery, refund, reversal, or dispute anomaly, leave quota
  unchanged automatically; enter the existing financial-review process.
- If an unexpected order, non-zero review queue, database readiness failure,
  or access-control regression appears, stop creating invitations, retain
  evidence, return to Sandbox/closed state, and investigate before resuming.
- A refund or dispute decision that changes money or quota requires a separate
  recorded operator decision; automatic quota clawback remains disabled.

## Suggested invite text

> You are invited to a limited NexaRelay payment pilot. This private PayPal
> link is for your verified NexaRelay account only. You may use only your own
> lawful PayPal/payment method and billing details. Do not send us passwords,
> card data, or verification codes. If you do not wish to participate, simply
> do not complete checkout.

## Public-launch boundary

The protected invitation flow is the only permitted pilot mechanism until a
separate, authenticated front-end checkout design has been implemented and
reviewed. Do not set `PAYMENT_PUBLIC_ENABLED=true` for pilot users.
