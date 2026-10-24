import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toISO, monthsBetweenCeil, monthsBetweenFraction, ayForDate, ayYearFromLabel, weekStart, isoWeekday, lastYearShiftDays, addDays } from '../../src/shared/rules/dates.js';

test('toISO accepts NetSuite MM/DD/YYYY and ISO', () => {
  assert.equal(toISO('06/01/2027'), '2027-06-01');
  assert.equal(toISO('2027-6-1'), '2027-06-01');
  assert.equal(toISO(''), null);
  assert.equal(toISO(null), null);
});
test('term from dates is always rounded up (11-month terms are 12 months of service)', () => {
  assert.equal(monthsBetweenCeil('2026-06-01', '2027-05-31'), 12);
  assert.equal(monthsBetweenCeil('2026-06-01', '2027-05-23'), 12);   // Binghamton 6/1 → 5/23
  assert.equal(monthsBetweenCeil('2026-08-05', '2027-07-25'), 12);   // Charleston 8/5 → 7/25
  assert.equal(monthsBetweenCeil('2026-06-15', '2027-05-22'), 12);   // Lehigh
  assert.equal(monthsBetweenCeil('2026-06-01', '2028-05-23'), 24);   // two-year
  assert.equal(monthsBetweenCeil('2026-08-15', '2026-12-20'), 5);    // fall-only
  assert.equal(monthsBetweenCeil('2026-06-01', '2026-06-30'), 1);
  assert.ok(Math.abs(monthsBetweenFraction('2026-06-01', '2027-05-31') - 12) < 1e-9);
  assert.equal(monthsBetweenCeil('2027-01-01', '2026-12-01'), -1);
});
test('academic year of a date uses the June 1 boundary (A-1)', () => {
  assert.equal(ayForDate('2026-06-01'), 2026);
  assert.equal(ayForDate('2026-05-31'), 2025);
  assert.equal(ayForDate('2027-01-15'), 2026);
  assert.equal(ayForDate('2026-08-05'), 2026);
});
test('AY label parsing', () => {
  assert.equal(ayYearFromLabel('AY 2027-2028'), 2027);
  assert.equal(ayYearFromLabel('2027-2028'), 2027);
  assert.equal(ayYearFromLabel('AY 27-28'), 2027);
  assert.equal(ayYearFromLabel('Test 2026-2027'), 2026);
  assert.equal(ayYearFromLabel(''), null);
});
test('weeks are Mon–Sun and last year shifts by whole weeks', () => {
  assert.equal(isoWeekday('2026-10-23'), 5); // Friday
  assert.equal(weekStart('2026-10-23'), '2026-10-19');
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday belongs to the week that started Monday
  assert.equal(lastYearShiftDays(2027), 364);
  assert.equal(isoWeekday(addDays('2026-10-23', -364)), 5);
});
