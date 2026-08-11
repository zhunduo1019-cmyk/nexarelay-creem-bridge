import test from 'node:test';
import assert from 'node:assert/strict';
import { secretsMatch } from '../src/security.js';

test('bridge secrets require an exact non-empty match', () => {
  assert.equal(secretsMatch('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(secretsMatch('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(secretsMatch('short', 'longer'), false);
  assert.equal(secretsMatch('', ''), false);
  assert.equal(secretsMatch(undefined, 'secret'), false);
});
