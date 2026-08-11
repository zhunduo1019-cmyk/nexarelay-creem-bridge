export const financialEventTypes = new Set([
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
]);

export function centsFromFinancialAmount(amount) {
  if (!amount || typeof amount.value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount.value)) return null;
  const [whole, fraction = ''] = amount.value.split('.');
  const cents = (Number(whole) * 100) + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function captureIdFromCompletedEvent(event) {
  return event?.resource?.id || null;
}

function disputeOutcome(resource) {
  return resource?.dispute_outcome?.outcome_code
    || resource?.dispute_outcome?.code
    || null;
}

function captureIdFromLinks(links) {
  const href = links?.find((link) => link?.rel === 'up' && /\/v2\/payments\/captures\//.test(link?.href || ''))?.href;
  if (!href) return null;
  const match = href.match(/\/v2\/payments\/captures\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function describeFinancialEvent(event) {
  if (!financialEventTypes.has(event?.event_type)) return null;
  const resource = event.resource || {};
  const type = event.event_type;

  if (type.startsWith('CUSTOMER.DISPUTE.')) {
    const transaction = resource.disputed_transactions?.[0]?.seller_transaction_id
      ? resource.disputed_transactions[0]
      : resource.disputed_transactions?.[0]?.transaction_info
        ? resource.disputed_transactions[0].transaction_info
        : null;
    const outcome = disputeOutcome(resource);
    return {
      adjustmentType: 'dispute',
      providerAdjustmentId: resource.dispute_id || resource.id || null,
      localOrderId: resource.invoice_id || null,
      providerOrderId: null,
      captureId: transaction?.seller_transaction_id || null,
      amountCents: centsFromFinancialAmount(resource.dispute_amount),
      currency: resource.dispute_amount?.currency_code || null,
      status: type === 'CUSTOMER.DISPUTE.RESOLVED' ? 'resolved' : String(resource.status || 'open').toLowerCase(),
      reason: [resource.reason, outcome].filter(Boolean).join(':') || null,
      financialStatus: type === 'CUSTOMER.DISPUTE.RESOLVED' ? 'dispute_resolved' : 'disputed',
    };
  }

  const relatedIds = resource.supplementary_data?.related_ids || {};
  if (type === 'PAYMENT.CAPTURE.REVERSED') {
    return {
      adjustmentType: 'reversal',
      providerAdjustmentId: resource.id || null,
      localOrderId: resource.invoice_id || null,
      providerOrderId: relatedIds.order_id || null,
      captureId: resource.id || relatedIds.capture_id || null,
      amountCents: centsFromFinancialAmount(resource.amount),
      currency: resource.amount?.currency_code || null,
      status: 'reversed',
      reason: resource.status_details?.reason || null,
      financialStatus: 'reversed',
    };
  }

  const statusByType = {
    'PAYMENT.CAPTURE.REFUNDED': 'refunded',
    'PAYMENT.REFUND.PENDING': 'pending',
    'PAYMENT.REFUND.FAILED': 'failed',
  };
  return {
    adjustmentType: 'refund',
    providerAdjustmentId: resource.id || null,
    localOrderId: resource.invoice_id || null,
    providerOrderId: relatedIds.order_id || null,
    captureId: relatedIds.capture_id || captureIdFromLinks(resource.links),
    amountCents: centsFromFinancialAmount(resource.amount),
    currency: resource.amount?.currency_code || null,
    status: statusByType[type],
    reason: resource.status_details?.reason || null,
    financialStatus: statusByType[type] === 'refunded'
      ? 'partially_refunded'
      : `refund_${statusByType[type]}`,
  };
}
