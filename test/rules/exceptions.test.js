import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, run, codesOf, codesFor, property, unit, nextId } from '../helpers.js';
import { EXCEPTION_CODES, EXCEPTION_ORDER } from '../../src/shared/constants.js';

test('every exception code carries a label, a meaning and an action', () => {
  for (const e of Object.values(EXCEPTION_CODES)) { assert.ok(e.label && e.meaning && e.action, e.code); assert.ok(e.severity >= 1); }
  assert.equal(EXCEPTION_ORDER[0], 'MULTI_BED'); // severity 1 first, alphabetical within
});
test('WH_MULTI: two property-wide whole-house leases exclude both', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, type: 'WH' }), lease({ property: h.p.id, type: 'WH' })] }));
  assert.deepEqual(codesOf(r.placement), ['WH_MULTI', 'WH_MULTI']);
  assert.equal(r.summary.student.occupied, 0);
});
test('WH_PLUS on the whole-house lease, PROP_HAS_WH on the unit/bedroom leases', () => {
  const h = house();
  const wh = lease({ property: h.p.id, type: 'WH' }), un = lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT' }), bd = lease({ property: h.p.id, unit: h.bB[0].id, type: 'BED' });
  const r = run(fixture({ ...h, leases: [wh, un, bd] }));
  assert.deepEqual(codesFor(r.placement, wh.id), ['WH_PLUS']);
  assert.deepEqual(codesFor(r.placement, un.id), ['PROP_HAS_WH']);
  assert.deepEqual(codesFor(r.placement, bd.id), ['PROP_HAS_WH']);
  assert.equal(r.summary.student.occupied, 0);
  const e = r.placement.exceptions.find((x) => x.code === 'WH_PLUS');
  assert.deepEqual(e.partners.sort(), [un.id, bd.id].map(String).sort());
});
test('MULTI_UNIT: two unit-level leases on one unit (a WH linked to the unit counts as unit-level)', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT' }), lease({ property: h.p.id, unit: h.uA.id, type: 'WH' })] }));
  assert.deepEqual(codesOf(r.placement), ['MULTI_UNIT', 'MULTI_UNIT']);
});
test('UNIT_PLUS_BED on the unit lease, UNIT_HAS on the bedroom lease; the other unit is untouched', () => {
  const h = house();
  const un = lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT' }), bd = lease({ property: h.p.id, unit: h.bA[0].id, type: 'BED' }), other = lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT' });
  const r = run(fixture({ ...h, leases: [un, bd, other] }));
  assert.deepEqual(codesFor(r.placement, un.id), ['UNIT_PLUS_BED']);
  assert.deepEqual(codesFor(r.placement, bd.id), ['UNIT_HAS']);
  assert.deepEqual(codesFor(r.placement, other.id), []);
  assert.equal(r.summary.student.occupied, 2);
});
test('MULTI_BED: two leases on one bedroom', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.bA[0].id, type: 'BED' }), lease({ property: h.p.id, unit: h.bA[0].id, type: 'BED' })] }));
  assert.deepEqual(codesOf(r.placement), ['MULTI_BED', 'MULTI_BED']);
});
test('UNIT_ON_BED and BED_ON_UNIT are excluded for their own reason and do not knock out the other leases in the unit', () => {
  const h = house();
  const wrongUnit = lease({ property: h.p.id, unit: h.bA[0].id, type: 'UNIT' });
  const wrongBed = lease({ property: h.p.id, unit: h.uB.id, type: 'BED' });
  const goodBed = lease({ property: h.p.id, unit: h.bA[1].id, type: 'BED' });
  const goodUnitB = lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT' });
  const r = run(fixture({ ...h, leases: [wrongUnit, wrongBed, goodBed, goodUnitB] }));
  assert.deepEqual(codesFor(r.placement, wrongUnit.id), ['UNIT_ON_BED']);
  assert.deepEqual(codesFor(r.placement, wrongBed.id), ['BED_ON_UNIT']);
  assert.deepEqual(codesFor(r.placement, goodBed.id), []);
  assert.deepEqual(codesFor(r.placement, goodUnitB.id), []);
  assert.equal(r.summary.student.occupied, 3);
});
test('whole-house lease linked to a bedroom is a wrong-level link', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.bA[0].id, type: 'WH' })] }));
  assert.deepEqual(codesOf(r.placement), ['UNIT_ON_BED']);
});
test('NOT_LINKED: unit or bedroom lease with no link, or a link to a missing/inactive record', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, type: 'UNIT' }), lease({ property: h.p.id, type: 'BED' }), lease({ property: h.p.id, unit: 999999, type: 'UNIT' })] }));
  assert.deepEqual(codesOf(r.placement), ['NOT_LINKED', 'NOT_LINKED', 'NOT_LINKED']);
});
test('ZERO_BEDS: linked record has 0 beds', () => {
  const p = property(); const u = unit(p.id, { beds: 0 });
  const r = run(fixture({ properties: [p], units: [u], leases: [lease({ property: p.id, unit: u.id, type: 'UNIT' })] }));
  assert.deepEqual(codesOf(r.placement), ['ZERO_BEDS']);
});
test('NO_PROP when the property is missing and cannot be inferred; inferred from the unit when it can', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: 424242, type: 'WH' }), lease({ property: 424242, unit: h.uA.id, type: 'UNIT' })] }));
  assert.deepEqual(codesOf(r.placement), ['NO_PROP']);
  assert.equal(r.summary.student.occupied, 3);
});
test('UNKNOWN_TYPE and BAD_DATES; first failing rule wins (type before dates before link)', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: null }), lease({ property: h.p.id, unit: h.uA.id, start: '05/23/2027', end: '06/01/2026' }), lease({ property: h.p.id, type: null, start: '05/23/2027', end: '06/01/2026' })] }));
  assert.deepEqual(codesOf(r.placement), ['BAD_DATES', 'UNKNOWN_TYPE', 'UNKNOWN_TYPE']);
});
test('TERM_MISMATCH flags a 24-month duration field over 12 months of dates, and the lease still counts (by the dates)', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', duration: 24, start: '06/01/2026', end: '05/23/2027' })] }));
  assert.deepEqual(codesOf(r.placement), ['TERM_MISMATCH']);
  assert.equal(r.summary.student.occupied, 3);
  assert.equal(r.placement.exceptions[0].excludes, false);
});
test('TENANT_DOUBLE flags the same tenant on two leases in one AY on both leases without excluding either', () => {
  const h = house();
  const a = lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', tenants: ['77', '78'] }), b = lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', tenants: ['77'] });
  const r = run(fixture({ ...h, leases: [a, b] }));
  assert.deepEqual(codesOf(r.placement), ['TENANT_DOUBLE', 'TENANT_DOUBLE']);
  assert.equal(r.summary.student.occupied, 5);
  assert.equal(r.placement.tenantDoubles.length, 1);
  assert.equal(r.placement.tenantDoubles[0].tenantId, '77');
  assert.equal(r.placement.tenantDoubles[0].leases.length, 2);
});
test('exceptions carry the records involved for the fix-in-place drawer', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.bA[0].id, type: 'UNIT', id: 555, name: 'X' })] }));
  const e = r.placement.exceptions[0];
  assert.equal(e.leaseId, '555'); assert.equal(e.propertyId, String(h.p.id)); assert.equal(e.linkId, String(h.bA[0].id)); assert.ok(e.label); assert.equal(e.ay, 2026);
});
