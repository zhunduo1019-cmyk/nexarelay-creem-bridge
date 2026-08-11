import crypto from 'node:crypto';

export function secretsMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
