export const financialReviewDecisions = Object.freeze([
  'no_action_no_financial_loss',
  'quota_removed_full',
  'quota_removed_partial_account_restricted',
  'account_restricted_quota_consumed',
  'manual_exception',
]);

function positiveSafeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive safe integer`);
  return number;
}

export function calculateAffectedCredits({ orderCredits, orderAmountCents, lossAmountCents }) {
  const credits = positiveSafeInteger(orderCredits, 'orderCredits');
  const orderAmount = positiveSafeInteger(orderAmountCents, 'orderAmountCents');
  const lossAmount = positiveSafeInteger(lossAmountCents, 'lossAmountCents');
  const cappedLoss = Math.min(lossAmount, orderAmount);
  return Number((BigInt(credits) * BigInt(cappedLoss)) / BigInt(orderAmount));
}

export function recommendQuotaDisposition({ affectedCredits, currentQuota }) {
  const affected = positiveSafeInteger(affectedCredits, 'affectedCredits');
  const quota = Number(currentQuota);
  if (!Number.isSafeInteger(quota) || quota < 0) throw new Error('currentQuota must be a non-negative safe integer');
  if (quota >= affected) {
    return { decision: 'quota_removed_full', quotaToRemove: affected, restrictAccount: false };
  }
  if (quota > 0) {
    return {
      decision: 'quota_removed_partial_account_restricted',
      quotaToRemove: quota,
      unrecoveredCredits: affected - quota,
      restrictAccount: true,
    };
  }
  return {
    decision: 'account_restricted_quota_consumed',
    quotaToRemove: 0,
    unrecoveredCredits: affected,
    restrictAccount: true,
  };
}

