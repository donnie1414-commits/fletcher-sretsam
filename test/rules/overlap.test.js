import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlapDays, classifyPair, collides } from '../../src/shared/rules/overlap.js';

const L = (start, end) => ({ start, end });
test('overlap is half-open: ending the day another begins does not overlap', () => {
  assert.equal(overlapDays(L('2026-06-01', '2026-12-31'), L('2027-01-01', '2027-05-31')), 0);
  assert.equal(classifyPair(L('2026-06-01', '2026-12-31'), L('2027-01-01', '2027-05-31')), 'none');
});
test('inclusive end dates: ending 5/31 and starting 6/1 is adjacent, not overlapping', () => {
  assert.equal(overlapDays(L('2025-06-01', '2026-05-31'), L('2026-06-01', '2027-05-31')), 0);
});
test('same-day start and end overlap by one day', () => {
  assert.equal(overlapDays(L('2026-06-01', '2026-12-31'), L('2026-12-31', '2027-05-31')), 1);
  assert.equal(classifyPair(L('2026-06-01', '2026-12-31'), L('2026-12-31', '2027-05-31')), 'minor');
});
test('tolerance boundary: 7 days is minor, 8 days collides', () => {
  assert.equal(classifyPair(L('2026-06-01', '2027-01-07'), L('2027-01-01', '2027-05-31')), 'minor');
  assert.equal(classifyPair(L('2026-06-01', '2027-01-08'), L('2027-01-01', '2027-05-31')), 'collide');
  assert.equal(classifyPair(L('2026-06-01', '2027-01-08'), L('2027-01-01', '2027-05-31'), 10), 'minor');
});
test('full overlap collides; sequential with a gap does not', () => {
  assert.equal(classifyPair(L('2026-06-01', '2027-05-31'), L('2026-06-01', '2027-05-31')), 'collide');
  assert.equal(classifyPair(L('2026-06-01', '2026-12-15'), L('2027-01-10', '2027-05-31')), 'none');
});
test('legacy mode: any two leases in one AY collide regardless of dates', () => {
  assert.equal(collides(L('2026-06-01', '2026-12-15'), L('2027-01-10', '2027-05-31'), { requireOverlap: false }), 'collide');
  assert.equal(collides(L('2026-06-01', '2026-12-15'), L('2027-01-10', '2027-05-31'), { requireOverlap: true }), 'none');
});
test('undated leases fall back to colliding', () => {
  assert.equal(classifyPair(L(null, null), L('2027-01-10', '2027-05-31')), 'undated');
  assert.equal(collides(L(null, null), L('2027-01-10', '2027-05-31'), { requireOverlap: true }), 'collide');
});
