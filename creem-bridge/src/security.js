import crypto from 'node:crypto';

export function secretsMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function checkoutPayload({ userId, username, expiresAt, nonce }) {
  return `v1\n${userId}\n${username}\n${expiresAt}\n${nonce}`;
}

function checkoutSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(checkoutPayload(payload)).digest('base64url');
}

// A ticket is minted server-side by One API after its normal UserAuth middleware
// has identified the current user. It lets the bridge remain closed to arbitrary
// browser requests without exposing BRIDGE_CHECKOUT_SECRET to a client.
export function verifyOneApiCheckoutTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== 'string' || !ticket || typeof secret !== 'string' || !secret) return null;
  try {
    const decoded = JSON.parse(Buffer.from(ticket, 'base64url').toString('utf8'));
    if (decoded.v !== 1
      || !Number.isSafeInteger(decoded.userId) || decoded.userId < 1
      || typeof decoded.username !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(decoded.username)
      || !Number.isSafeInteger(decoded.expiresAt) || decoded.expiresAt <= now || decoded.expiresAt > now + 15 * 60 * 1000
      || typeof decoded.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(decoded.nonce)
      || typeof decoded.signature !== 'string') return null;
    const expected = checkoutSignature(decoded, secret);
    if (!secretsMatch(decoded.signature, expected)) return null;
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
}
