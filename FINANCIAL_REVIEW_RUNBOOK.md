# NexaRelay Financial Review Runbook

This runbook defines the required manual response to PayPal refunds, reversals, and disputes. The bridge must never deduct One API quota automatically.

## Safety rules

- Work only from `GET /api/payment/admin/financial-review` using the administrator-held `x-bridge-secret`.
- Match the PayPal adjustment, bridge order, One API user ID, and username before changing anything.
- Do not act on a pending refund or an unresolved dispute. Keep the review open until the financial outcome is final.
- Never make a One API quota balance negative.
- Make any required One API quota or account-status change first. Record the bridge resolution only after verifying that change.
- Put the PayPal case or refund reference, before/after quota, and reason in the resolution note. Never put credentials or tokens in the note.

## Determine affected credits

- Full refund, capture reversal, or buyer-favour dispute: the affected amount is the full delivered credits for the order.
- Partial refund: `floor(order credits × total successfully refunded cents ÷ order amount cents)`.
- Buyer-cancelled dispute, seller-favour dispute, or failed refund: no financial loss; do not remove quota.
- Multiple refund events must be summed by their idempotent adjustment rows and capped at the order amount.

## Operator decision

Treat quota as a fungible account balance and compare the current One API quota with the affected credits:

| Condition | Required action | Resolution decision |
|---|---|---|
| No final financial loss | Do not change quota or account status | `no_action_no_financial_loss` |
| Current quota is at least the affected credits | Manually subtract exactly the affected credits and verify the resulting balance | `quota_removed_full` |
| Current quota is positive but below the affected credits | Set quota to zero, temporarily restrict the account, and record the unrecovered amount | `quota_removed_partial_account_restricted` |
| Current quota is zero | Do not create a negative balance; temporarily restrict the account and record the full unrecovered amount | `account_restricted_quota_consumed` |
| Evidence is incomplete or an approved exception applies | Do not change quota until a documented operator decision exists | `manual_exception` |

Temporary restriction is a fraud-loss control, not an automatic accusation. Restore access only after the payment liability is settled or an approved exception is documented.

## Record the completed review

After the external action is verified, call:

```text
POST /api/payment/admin/orders/<order-id>/resolve-financial-review
x-bridge-secret: <administrator-held secret>
content-type: application/json

{
  "decision": "<resolution decision>",
  "operator": "<operator identifier>",
  "note": "<PayPal reference; quota before -> after; concise reason>"
}
```

This records an audit trail and removes the order from the open financial-review queue. It does not modify One API quota or account status.

## Current One API compatibility

The deployed NexaRelay One API is `v0.6.4`. That version does not provide the newer administrator `POST /api/topup` route. Prefer the administrator UI for quota changes. If an API operation is required, `PUT /api/user/` must use a freshly read complete user record, an exact precondition on the current quota, and a post-update read-back. Never repeat an uncertain update; inspect the current quota first.

On 2026-08-11, the Sandbox full-refund drill used those guards to change quota from 2,510,000 to 2,010,000. The bridge then recorded `quota_removed_full`. The buyer-cancelled dispute recorded `no_action_no_financial_loss`. All review queues were empty afterward.
