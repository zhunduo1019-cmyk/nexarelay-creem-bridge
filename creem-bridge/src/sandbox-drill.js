const armedPostRedemptionFailures = new Set();

export function sandboxDrillAvailable(settings) {
  return settings.paypalMode === 'sandbox'
    && settings.paypalLiveEnabled === false
    && settings.publicPaymentsEnabled === false;
}

export function armPostRedemptionFailure(orderId) {
  armedPostRedemptionFailures.add(orderId);
}

export function consumePostRedemptionFailure(orderId) {
  if (!armedPostRedemptionFailures.has(orderId)) return false;
  armedPostRedemptionFailures.delete(orderId);
  return true;
}
