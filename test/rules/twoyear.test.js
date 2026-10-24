import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLease } from '../../src/shared/rules/lease.js';
import { house, lease, fixture, run, LISTS } from '../helpers.js';
import { lookupsFromLists } from '../../src/shared/rules/index.js';

const lk = { ...lookupsFromLists(LISTS), ayYears: { 7: 2025, 4: 2026, 2: 2027, 3: 2028 } };
const norm = (o) => normalizeLease(lease(o), lk);

test('discriminator is term length ≥ 15 months FROM THE DATES, not end date vs AY window', () => {
  const charleston = norm({ start: '08/05/2026', end: '07/25/2027', duration: 12 }); // ordinary Charleston 12-month lease runs Aug → Jul
  assert.equal(charleston.isTwoYear, false);
  assert.equal(charleston.years.length, 1);
  const savannah = norm({ start: '08/15/2026', end: '07/31/2027', duration: 12 });
  assert.equal(savannah.isTwoYear, false);
  const two = norm({ start: '06/01/2026', end: '05/23/2028', duration: 24 });
  assert.equal(two.isTwoYear, true);
  const fifteen = norm({ start: '03/11/2026', end: '05/16/2027', duration: 15 });
  assert.equal(fifteen.isTwoYear, true);
  const fourteen = norm({ start: '03/25/2026', end: '05/16/2027', duration: 14 });
  assert.equal(fourteen.isTwoYear, false);
});
test('duration field says 24 but the dates cover 12: NOT two-year, flagged as TERM_MISMATCH', () => {
  const l = norm({ start: '06/01/2026', end: '05/31/2027', duration: 18 });
  assert.equal(l.isTwoYear, false);
  assert.equal(l.termMismatch, true);
  assert.equal(l.years.length, 1);
});
test('duration field says 12 but the dates cover 24: the dates win, two years', () => {
  const l = norm({ start: '06/01/2027', end: '05/31/2029', duration: 12, ay: 2027 });
  assert.equal(l.isTwoYear, true);
  assert.equal(l.termMonths, 24);
  assert.deepEqual(l.years.map((y) => [y.ay, y.months, y.carried]), [[2027, 12, false], [2028, 12, true]]);
});
test('two-year leases anchor on the START DATE, not the Academic Year field', () => {
  // tagged AY 2027-2028 but starts in AY 2026-2027: counts in 2026 and 2027, never 2028
  const l = norm({ start: '06/01/2026', end: '05/23/2028', duration: 24, ay: 2027 });
  assert.deepEqual(l.years.map((y) => y.ay), [2026, 2027]);
  assert.equal(l.years[1].carried, true);
});
test('one-year leases use the Academic Year field; start date is only the fallback', () => {
  const tagged = norm({ start: '05/20/2027', end: '05/15/2028', duration: 12, ay: 2027 }); // early move-in, tagged 27-28
  assert.deepEqual(tagged.years.map((y) => y.ay), [2027]);
  const untagged = normalizeLease(lease({ start: '08/05/2026', end: '07/25/2027', ay: null }), lk);
  assert.deepEqual(untagged.years.map((y) => y.ay), [2026]);
});
test('apportionment: each year gets its months and monthly_rent × months; 22-month lease splits 12 + 10', () => {
  const l = norm({ start: '08/01/2026', end: '05/31/2028', duration: 22, monthly: 1000 });
  assert.deepEqual(l.years.map((y) => [y.ay, y.months, y.revenue]), [[2026, 12, 12000], [2027, 10, 10000]]);
});
test('term: duration field first, then total ÷ monthly rounded up, then the dates', () => {
  assert.equal(norm({ duration: 11 }).termMonths, 11);
  assert.equal(normalizeLease(lease({ duration: null, monthly: 1000, total: 11500 }), lk).termMonths, 12);
  assert.equal(normalizeLease(lease({ duration: null, monthly: 1000, total: null, start: '06/01/2026', end: '05/23/2027' }), lk).termMonths, 12);
  assert.equal(normalizeLease(lease({ duration: null, monthly: 1000, total: null, start: '06/01/2026', end: '05/23/2027' }), lk).termSource, 'dates');
});
test('a two-year lease occupies in both years; the carried year is excluded from leasing velocity', () => {
  const h = house();
  const fx = fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', duration: 24, start: '06/01/2026', end: '05/23/2028', monthly: 3000, signed: '01/15/2026', sent: '01/10/2026' })] });
  const y1 = run(fx, { ay: 2026 }), y2 = run(fx, { ay: 2027 }), y3 = run(fx, { ay: 2028 });
  assert.equal(y1.summary.student.occupied, 3); assert.equal(y2.summary.student.occupied, 3); assert.equal(y3.summary.student.occupied, 0);
  assert.equal(y1.summary.student.annual, 36000); assert.equal(y2.summary.student.annual, 36000);
  assert.equal(y1.summary.student.carriedBeds, 0); assert.equal(y2.summary.student.carriedBeds, 3);
  const lr2 = [...y2.placement.leaseResults.values()][0];
  assert.equal(lr2.year.carried, true);
});
test('tenant ids parse from the multi-select string', () => {
  assert.deepEqual(normalizeLease(lease({ tenants: ['12194', '12196'] }), lk).tenantIds, ['12194', '12196']);
  assert.deepEqual(normalizeLease({ ...lease({}), tenants: '12194, 12196' }, lk).tenantIds, ['12194', '12196']);
});
