import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPeople } from '../../src/shared/rules/people.js';

test('cumulative rounding: bed k of n gets round(N·k/n) − round(N·(k−1)/n)', () => {
  assert.deepEqual(splitPeople(5, [1, 1, 1]), [2, 1, 2]);
  assert.deepEqual(splitPeople(3, [1, 1, 1]), [1, 1, 1]);
  assert.deepEqual(splitPeople(4, [1, 1, 1]), [1, 2, 1]);
  assert.deepEqual(splitPeople(1, [1, 1, 1, 1]), [0, 1, 0, 0]);
  assert.deepEqual(splitPeople(0, [1, 1]), [0, 0]);
});
test('weighted leaves: a 3-bed unit leaf gets three times the share of a 1-bed leaf', () => {
  assert.deepEqual(splitPeople(4, [3, 1]), [3, 1]);
});
test('sum is always preserved', () => {
  for (let n = 0; n < 12; n++) for (const w of [[1, 1], [1, 1, 1], [2, 3, 1], [1, 1, 1, 1, 1]]) assert.equal(splitPeople(n, w).reduce((a, b) => a + b, 0), n);
});
test('no weight at all puts everyone on the first leaf', () => { assert.deepEqual(splitPeople(2, [0, 0]), [2, 0]); });
