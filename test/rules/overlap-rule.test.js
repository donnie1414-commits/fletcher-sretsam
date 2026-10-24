/** §5.7.1 end to end: overlapping, adjacent, within tolerance, sequential with gap — and the revenue/financial-occupancy treatment of each. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, run, codesOf, leafOf } from '../helpers.js';

const ON = { requireOverlapForCollision: true };
function pair(h, a, b) { return fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', monthly: 1200, ...a }), lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', monthly: 1500, ...b })] }); }

test('legacy (flag off): sequential leases on one unit are a conflict and the beds read vacant', () => {
  const h = house();
  const r = run(pair(h, { start: '06/01/2026', end: '12/15/2026', duration: 7 }, { start: '01/10/2027', end: '05/23/2027', duration: 5 }), { flags: { requireOverlapForCollision: false } });
  assert.deepEqual(codesOf(r.placement), ['MULTI_UNIT', 'MULTI_UNIT']);
  assert.equal(r.summary.student.occupied, 0);
});
test('sequential with a gap: both placed, bed occupied once, revenue is the sum, financial occupancy is partial', () => {
  const h = house();
  const r = run(pair(h, { start: '06/01/2026', end: '12/15/2026', duration: 7, tenantCount: 3 }, { start: '01/10/2027', end: '05/23/2027', duration: 5, tenantCount: 2 }), { flags: ON });
  assert.deepEqual(codesOf(r.placement), []);
  assert.equal(r.summary.student.occupied, 3);
  assert.equal(r.summary.student.annual, 1200 * 7 + 1500 * 5);
  assert.ok(Math.abs(r.summary.student.finOccPct - (3 * 12) / 12 / 5) < 1e-12); // 7 + 5 = 12 months
  assert.equal(r.summary.student.people, 3); // headcount from the lease covering the most months
  assert.equal(leafOf(r, h.bA[0].id).sequential, true);
});
test('adjacent (ends 12/31, starts 1/1): not a collision', () => {
  const h = house();
  const r = run(pair(h, { start: '06/01/2026', end: '12/31/2026', duration: 7 }, { start: '01/01/2027', end: '05/31/2027', duration: 5 }), { flags: ON });
  assert.deepEqual(codesOf(r.placement), []);
  assert.equal(r.summary.student.occupied, 3);
});
test('within tolerance (5-day turnover overlap): both placed, low-severity OVERLAP_MINOR on both, months capped at 12', () => {
  const h = house();
  const r = run(pair(h, { start: '06/01/2026', end: '01/05/2027', duration: 8 }, { start: '01/01/2027', end: '05/31/2027', duration: 5 }), { flags: ON });
  assert.deepEqual(codesOf(r.placement), ['OVERLAP_MINOR', 'OVERLAP_MINOR']);
  assert.equal(r.placement.exceptions[0].excludes, false);
  assert.equal(r.placement.exceptions[0].overlapDays, 5);
  assert.equal(r.summary.student.occupied, 3);
  assert.ok(Math.abs(r.summary.student.finOccPct - (3 * 12) / 12 / 5) < 1e-12); // 8 + 5 = 13 → capped at 12 on the 3 covered beds
});
test('overlapping beyond tolerance: real conflict, both excluded', () => {
  const h = house();
  const r = run(pair(h, { start: '06/01/2026', end: '03/01/2027', duration: 9 }, { start: '01/01/2027', end: '05/31/2027', duration: 5 }), { flags: ON });
  assert.deepEqual(codesOf(r.placement), ['MULTI_UNIT', 'MULTI_UNIT']);
  assert.equal(r.summary.student.occupied, 0);
  assert.ok(r.placement.exceptions[0].overlapDays > 7);
});
test('tolerance is configurable in one place', () => {
  const h = house();
  const fx = pair(h, { start: '06/01/2026', end: '01/10/2027', duration: 8 }, { start: '01/01/2027', end: '05/31/2027', duration: 5 }); // 10 days
  const r7 = run(fx, { flags: ON });
  assert.deepEqual(codesOf(r7.placement), ['MULTI_UNIT', 'MULTI_UNIT']);
  const prep = r7.prep;
  const { placeLeases } = await_import();
  const r14 = placeLeases({ inventory: prep.inventory, leases: prep.leases, ay: 2026, basis: 'proforma', flags: ON, tolerance: 14 });
  assert.deepEqual(r14.exceptions.map((e) => e.code).sort(), ['OVERLAP_MINOR', 'OVERLAP_MINOR']);
});
test('tenant double-booking also requires overlap: a mid-year transfer is not a double booking', () => {
  const h = house();
  const fx = fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', start: '06/01/2026', end: '12/15/2026', duration: 7, tenants: ['9'] }), lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', start: '12/16/2026', end: '05/23/2027', duration: 5, tenants: ['9'] })] });
  assert.equal(run(fx, { flags: { requireOverlapForCollision: false } }).placement.tenantDoubles.length, 1);
  assert.equal(run(fx, { flags: ON }).placement.tenantDoubles.length, 0);
});
test('whole-house then bedroom leases at the same property, sequential: no WH_PLUS under the overlap rule', () => {
  const h = house();
  const fx = fixture({ ...h, leases: [lease({ property: h.p.id, type: 'WH', start: '06/01/2026', end: '12/31/2026', duration: 7 }), lease({ property: h.p.id, unit: h.bA[0].id, type: 'BED', start: '01/01/2027', end: '05/31/2027', duration: 5 })] });
  assert.deepEqual(codesOf(run(fx, { flags: { requireOverlapForCollision: false } }).placement), ['PROP_HAS_WH', 'WH_PLUS']);
  const r = run(fx, { flags: ON });
  assert.deepEqual(codesOf(r.placement), []);
  assert.equal(r.summary.student.occupied, 5);
});
import { placeLeases as _pl } from '../../src/shared/rules/placement.js';
function await_import() { return { placeLeases: _pl }; }
