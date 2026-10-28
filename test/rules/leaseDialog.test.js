import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDates, targetRentPerBed, prefill, buildLeaseChanges, overlappingLeases, nextFreeStart, datesOverlap } from '../../src/shared/rules/leaseDialog.js';
import { MARKETS, LEASE } from '../../src/shared/constants.js';

const cal = MARKETS.find((m) => m.id === 'binghamton').calendar;
const data = { ay: 2027, ayId: 2, property: { id: '10', name: '48 Leroy St', calendar: cal, units: [{ id: '1', name: 'Unit 1', beds: 4, targetMonthly: 3200 }, { id: '2', name: 'Unit 2', beds: 2, targetMonthly: 1800 }] }, unit: { id: '1', name: 'Unit 1', beds: 4, targetMonthly: 3200, bedrooms: [{ id: 'a', name: 'Bedroom 1', beds: 1, free: true }, { id: 'b', name: 'Bedroom 2', beds: 1, free: false }, { id: 'c', name: 'Bedroom 3', beds: 1, free: true }, { id: 'd', name: 'Bedroom 4', beds: 1, free: true }] }, priorTenantNames: ['Ann Prior', 'Bob Prior'] };

test('dates come from the market calendar for the AY; two-year ends on the same market date two years out', () => {
  assert.deepEqual(calendarDates(cal, 2027), { start: '2027-06-01', end: '2028-05-23' });
  assert.deepEqual(calendarDates(cal, 2027, true), { start: '2027-06-01', end: '2029-05-23' });
  assert.deepEqual(calendarDates(MARKETS.find((m) => m.id === 'charleston').calendar, 2027), { start: '2027-08-05', end: '2028-07-25' });
  assert.deepEqual(calendarDates(null, 2027), { start: null, end: null });
});
test('rent per bed: whole house = Σ unit targets ÷ Σ beds; unit/bedroom = unit target ÷ beds; no target ⇒ null, never zero', () => {
  assert.equal(targetRentPerBed('WH', data), 5000 / 6);
  assert.equal(targetRentPerBed('UNIT', data), 800);
  assert.equal(targetRentPerBed('BED', data), 800);
  assert.equal(targetRentPerBed('UNIT', { ...data, unit: { ...data.unit, targetMonthly: null } }), null);
});
test('term is calculated from the dates, rounded up, not user-entered', () => {
  const s = prefill({ type: 'UNIT', twoYear: false, groupType: 'NEW' }, data, new Set());
  assert.equal(s.termMonths, 12); assert.equal(s.monthly, 3200); assert.equal(s.total, 38400);
  const two = prefill({ type: 'UNIT', twoYear: true, groupType: 'NEW' }, data, new Set());
  assert.equal(two.termMonths, 24); assert.equal(two.end, '2029-05-23');
});
test('bedroom type defaults to all free bedrooms and creates one lease per selected bedroom', () => {
  const s = prefill({ type: 'BED', groupType: 'NEW' }, data, new Set());
  assert.deepEqual(s.bedroomIds, ['a', 'c', 'd']);
  const ch = buildLeaseChanges(s, data, { leaseType: { WH: '1', UNIT: '2', BED: '3' }, groupType: { NEW: '1' } }, LEASE);
  assert.equal(ch.length, 3); assert.equal(ch[0].fields[LEASE.UNIT], NaN || Number('a') || ch[0].fields[LEASE.UNIT]); assert.equal(ch[0].fields[LEASE.MONTHLY_RENT], 800); assert.equal(ch[0].fields.custrecord_serp_lease_type_test, 3);
  assert.ok(!('custrecord_serp_lease_status' in ch[0].fields), 'created lease carries no status');
});
test('expected names default to prior tenants only for Renewal, refill or clear live, and never overwrite a touched field', () => {
  let s = prefill({ type: 'UNIT', groupType: 'NEW' }, data, new Set()); assert.equal(s.expectedNames, '');
  s = prefill({ ...s, groupType: 'RENEWAL' }, data, new Set()); assert.equal(s.expectedNames, 'Ann Prior\nBob Prior');
  s = prefill({ ...s, groupType: 'NEW' }, data, new Set()); assert.equal(s.expectedNames, '');
  const touched = new Set(['expectedNames']);
  s = prefill({ ...s, expectedNames: 'Typed Name', groupType: 'RENEWAL' }, data, touched); assert.equal(s.expectedNames, 'Typed Name');
});
test('a touched date or rent is never auto-overwritten when the type or two-year toggle changes', () => {
  const touched = new Set(['end', 'rentPerBed']);
  const s = prefill({ type: 'WH', twoYear: true, end: '2028-06-30', rentPerBed: 900, groupType: 'NEW' }, data, touched);
  assert.equal(s.end, '2028-06-30'); assert.equal(s.rentPerBed, 900); assert.equal(s.start, '2027-06-01'); assert.equal(s.bedsCovered, 6); assert.equal(s.monthly, 5400);
});
test('whole house covers every unit at the property; the write has no unit link', () => {
  const s = prefill({ type: 'WH', groupType: 'NEW' }, data, new Set());
  const ch = buildLeaseChanges(s, data, { leaseType: { WH: '1', UNIT: '2', BED: '3' }, groupType: { NEW: '1' } }, LEASE);
  assert.equal(ch.length, 1); assert.equal(ch[0].fields[LEASE.UNIT], null); assert.equal(ch[0].fields[LEASE.TENANT_COUNT], 6); assert.equal(ch[0].fields.name, '48 Leroy St AY 27-28');
});

test('overlap: same beds and touching dates collide; a property-wide lease collides with everything; bedrooms only with themselves', () => {
  const ex = [
    { id: 'u', name: 'Unit 1 lease', start: '2027-06-01', end: '2028-05-23', level: 'unit', unitId: '1', bedroomId: null },
    { id: 'b', name: 'Bedroom A', start: '2027-06-01', end: '2027-12-31', level: 'bedroom', unitId: '2', bedroomId: '2a' },
    { id: 'p', name: 'Whole house', start: '2028-06-01', end: '2029-05-23', level: 'property', unitId: null, bedroomId: null },
    { id: 'x', name: 'archived', start: '2027-06-01', end: '2028-05-23', level: 'unit', unitId: '1', bedroomId: null, inactive: true },
  ];
  assert.equal(datesOverlap('2028-05-23', '2028-08-01', '2027-06-01', '2028-05-23'), true, 'sharing one day is an overlap');
  assert.deepEqual(overlappingLeases('2028-01-01', '2028-05-01', ex, { level: 'unit', unitId: '1', bedroomIds: [] }).map((l) => l.id), ['u']);
  assert.deepEqual(overlappingLeases('2028-05-24', '2028-05-31', ex, { level: 'unit', unitId: '1', bedroomIds: [] }).map((l) => l.id), [], 'the day after the end is free');
  assert.deepEqual(overlappingLeases('2028-06-01', '2028-08-01', ex, { level: 'unit', unitId: '1', bedroomIds: [] }).map((l) => l.id), ['p'], 'a whole-house lease blocks every unit');
  assert.deepEqual(overlappingLeases('2027-09-01', '2027-10-01', ex, { level: 'bedroom', unitId: '2', bedroomIds: ['2b'] }).map((l) => l.id), [], 'another bedroom in the unit is free');
  assert.deepEqual(overlappingLeases('2027-09-01', '2027-10-01', ex, { level: 'bedroom', unitId: '2', bedroomIds: ['2a'] }).map((l) => l.id), ['b']);
  assert.deepEqual(overlappingLeases('2027-09-01', '2027-10-01', ex, { level: 'unit', unitId: '2', bedroomIds: [] }).map((l) => l.id), ['b'], 'a unit lease collides with a bedroom lease in it');
  assert.equal(nextFreeStart('2027-06-01', '2028-05-23', ex, { level: 'unit', unitId: '1', bedroomIds: [] }), '2028-05-24');
});
