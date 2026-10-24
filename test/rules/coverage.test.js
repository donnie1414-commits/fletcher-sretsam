import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, run, leafOf, property, unit } from '../helpers.js';

test('whole-house lease with NO unit link covers every bed at the property (multi-unit)', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, type: 'WH', monthly: 5000, tenants: ['1', '2', '3', '4', '5'] })] }));
  assert.equal(r.summary.student.beds, 5);
  assert.equal(r.summary.student.occupied, 5);
  assert.equal(r.summary.student.byType.WH, 5);
  assert.equal(r.summary.student.monthly, 5000);
  assert.equal(leafOf(r, h.bA[0].id).monthly, 1000); // spread by bed count
  assert.equal(r.placement.exceptions.length, 0);
});
test('whole-house lease linked to a unit covers only that unit', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'WH' })] }));
  assert.equal(r.summary.student.occupied, 3);
  assert.equal(leafOf(r, h.bB[0].id).occupied, 0);
});
test('unit lease covers every bed in the unit; bedroom lease covers that bedroom only', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT' }), lease({ property: h.p.id, unit: h.bB[1].id, type: 'BED' })] }));
  assert.equal(r.summary.student.occupied, 4);
  assert.deepEqual(r.summary.student.byType, { WH: 0, UNIT: 3, BED: 1 });
  assert.equal(leafOf(r, h.bB[0].id).occupied, 0);
  assert.equal(leafOf(r, h.bB[1].id).occupied, 1);
});
test('headcount never affects occupancy; people are split by cumulative rounding', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', tenantCount: 5 })] }));
  assert.equal(r.summary.student.occupied, 3);
  assert.equal(r.summary.student.people, 5);
  assert.deepEqual(h.bA.map((b) => leafOf(r, b.id).people), [2, 1, 2]);
});
test('a part-let house is one bedroom lease per bedroom; the rest stay vacant', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: h.bA.slice(0, 2).map((b) => lease({ property: h.p.id, unit: b.id, type: 'BED' })) }));
  assert.equal(r.summary.student.occupied, 2);
  assert.equal(r.summary.student.vacant, 3);
});
test('unit-only inventory (no bedroom records) places a unit lease on the unit leaf', () => {
  const p = property(); const u = unit(p.id, { beds: 4 });
  const r = run(fixture({ properties: [p], units: [u], leases: [lease({ property: p.id, unit: u.id, type: 'UNIT', tenantCount: 4 })] }));
  assert.equal(r.summary.student.occupied, 4);
  assert.equal(r.summary.student.people, 4);
});
test('property-only inventory: a whole-house lease on a property with no units covers its bedroom count', () => {
  const p = property({ bedrooms: 6 });
  const r = run(fixture({ properties: [p], units: [], leases: [lease({ property: p.id, type: 'WH' })] }));
  assert.equal(r.summary.student.beds, 6);
  assert.equal(r.summary.student.occupied, 6);
});
test('basis: pro-forma counts Executed + In Process, Fully Executed counts executed only', () => {
  const h = house();
  const fx = fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', status: 'EXECUTED' }), lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', status: 'IN_PROCESS' })] });
  assert.equal(run(fx, { basis: 'proforma' }).summary.student.occupied, 5);
  assert.equal(run(fx, { basis: 'executed' }).summary.student.occupied, 3);
});
test('a lease with no status is excluded from every statistic but visible as NO_STATUS', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', status: null })] }));
  assert.equal(r.summary.student.occupied, 0);
  assert.deepEqual(r.placement.exceptions.map((e) => e.code), ['NO_STATUS']);
  assert.equal(r.placement.leaseResults.size, 1);
});
test('inactive leases and other-AY leases are ignored', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, inactive: true }), lease({ property: h.p.id, unit: h.uB.id, ay: 2027, start: '06/01/2027', end: '05/23/2028' })] }));
  assert.equal(r.summary.student.occupied, 0);
  assert.equal(r.placement.leaseResults.size, 0);
});
test('occupancy is a ratio of sums at every level, never an average of row percentages', () => {
  const big = house(); const small = house();
  // big house 5 beds fully leased, small house 5 beds: only 1 bed leased → 6/10 = 60%, not avg(100%, 20%) = 60%… make it asymmetric:
  const p3 = property({ bedrooms: 20 });
  const r = run(fixture({ properties: [...big.properties, ...small.properties, p3], units: [...big.units, ...small.units], leases: [lease({ property: big.p.id, type: 'WH' }), lease({ property: p3.id, type: 'WH' })] }));
  assert.equal(r.summary.student.beds, 30);
  assert.equal(r.summary.student.occupied, 25);
  assert.ok(Math.abs(r.summary.student.occPct - 25 / 30) < 1e-12); // average of property % would be (1+0+1)/3 = 66.7%
});
test('financial occupancy = Σ(occupied beds × min(term,12)) ÷ 12 ÷ beds', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', duration: 9, start: '08/15/2026', end: '05/15/2027' })] }));
  assert.equal(r.summary.student.occupied, 2);
  assert.ok(Math.abs(r.summary.student.finOccPct - (2 * 9) / 12 / 5) < 1e-12);
  assert.ok(Math.abs(r.summary.student.occPct - 2 / 5) < 1e-12);
});
test('rent/bed = monthly ÷ occupied beds; rent/person = monthly ÷ people; target variance from the AY target', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', monthly: 3300, tenantCount: 3 })], targets: [{ id: 1, unit: h.uA.id, property: h.p.id, ay: 4, beds: 3, target_per_bed: 1000, target_monthly: 3000 }] }));
  assert.equal(r.summary.student.rentPerBed, 1100);
  assert.equal(r.summary.student.rentPerPerson, 1100);
  assert.equal(r.summary.student.targetMonthly, 3000);
  assert.equal(r.summary.student.targetVariance, 300);
});
