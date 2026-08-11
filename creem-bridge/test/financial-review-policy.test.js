import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAffectedCredits,
  recommendQuotaDisposition,
} from '../src/financial-review-policy.js';

test('partial financial loss maps proportionally to server-side credits', () => {
  assert.equal(calculateAffectedCredits({
    orderCredits: 2_800_000,
    orderAmountCents: 500,
    lossAmountCents: 100,
  }), 560_000);
  assert.equal(calculateAffectedCredits({
    orderCredits: 500_000,
    orderAmountCents: 100,
    lossAmountCents: 500,
  }), 500_000);
});

test('unused affected quota is fully recoverable without restriction', () => {
  assert.deepEqual(recommendQuotaDisposition({ affectedCredits: 500_000, currentQuota: 700_000 }), {
    decision: 'quota_removed_full', quotaToRemove: 500_000, restrictAccount: false,
  });
});

test('partially consumed affected quota is capped at the current balance', () => {
  assert.deepEqual(recommendQuotaDisposition({ affectedCredits: 500_000, currentQuota: 120_000 }), {
    decision: 'quota_removed_partial_account_restricted', quotaToRemove: 120_000,
    unrecoveredCredits: 380_000, restrictAccount: true,
  });
});

test('fully consumed affected quota never produces a negative balance', () => {
  assert.deepEqual(recommendQuotaDisposition({ affectedCredits: 500_000, currentQuota: 0 }), {
    decision: 'account_restricted_quota_consumed', quotaToRemove: 0,
    unrecoveredCredits: 500_000, restrictAccount: true,
  });
});

