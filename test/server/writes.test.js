import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWrites } from '../../src/server/writes.js';
import { createAuth } from '../../src/server/auth.js';
import { fakeRuntime, fakeSuiteQL, fakeRecordStore, fakeLog, fakeSchema } from './fakes.js';
import { UAS, LEASE, CUSTOMER, AUDIT } from '../../src/shared/constants.js';

function build({ employeeMarkets = 'Bethlehem', usage = 1000, auditMissing = false, store = {}, tenantLinks = { props: [], ays: [] }, marketOf = () => 'lehigh' } = {}) {
  const auditRows = [];
  const rs = fakeRecordStore(store);
  const sq = fakeSuiteQL([
    [/FROM employee WHERE id/, () => [{ markets: employeeMarkets }]],
    [new RegExp(`FROM ${AUDIT.TYPE} WHERE`), (m, params) => auditRows.filter((a) => a.changeId === params[0])],
    [/FROM map_customer_custentity_serp_ent_property/, () => tenantLinks.props],
    [/FROM map_customer_custentity_serp_academic_year/, () => tenantLinks.ays],
    [/FROM MAP_customrecord_serp_lease_record_custrecord_serp_tenants_ WHERE mapone/, (m, params) => (rs.store[LEASE.TYPE][params[0]][LEASE.TENANTS] || []).map((c) => ({ customer: c }))],
  ]);
  const runtime = fakeRuntime({ usage });
  const schema = fakeSchema(auditMissing ? new Set([`${AUDIT.TYPE}.${AUDIT.CHANGE_ID}`]) : new Set());
  const auth = createAuth({ runtime, sq, schema, log: fakeLog });
  // audit records written through record.create land in the fake store; expose them to the replay query
  const origCreate = rs.record.create;
  rs.record.create = (o) => { const r = origCreate(o); if (o.type === AUDIT.TYPE) { const vals = {}; const set = r.setValue; r.setValue = ({ fieldId, value }) => { vals[fieldId] = value; set({ fieldId, value }); }; const save = r.save; r.save = () => { const id = save(); auditRows.push({ changeId: vals[AUDIT.CHANGE_ID], rt: vals[AUDIT.RECORD_TYPE], rid: vals[AUDIT.RECORD_ID], after: vals[AUDIT.AFTER] }); return id; }; } return r; };
  const writes = createWrites({ record: rs.record, sq, runtime, log: fakeLog, schema, auth, marketOf, clock: () => '2026-10-24T12:00:00.000Z' });
  return { writes, scope: auth.resolve(), rs, auditRows, runtime };
}
const uasStore = () => ({ [UAS.TYPE]: { 11: { [UAS.STAGE]: null, [UAS.FOLLOWUP]: null, lastmodified: 'v0' } } });

test('allowlist: unknown record types and fields are denied; nothing is written', () => {
  const { writes, scope, rs } = build({ store: uasStore() });
  const r = writes.apply([{ changeId: 'c1', recordType: 'customer', recordId: 1, fields: { companyname: 'x' } }, { changeId: 'c2', recordType: 'employee', recordId: 1, fields: { email: 'x' } }, { changeId: 'c3', recordType: UAS.TYPE, recordId: 11, fields: { custrecord_ad_uas_unit: 5 } }], scope);
  assert.deepEqual(r.results.map((x) => x.code), ['DENIED_FIELD', 'DENIED_RECORD', 'DENIED_FIELD']);
  assert.equal(rs.saves.length, 0);
});
test('lease-driven stages are rejected server-side; a human stage is written with manual source, stage date and audit', () => {
  const { writes, scope, rs, auditRows } = build({ store: uasStore() });
  const r = writes.apply([{ changeId: 'c1', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.STAGE]: 'Fully Executed' } }, { changeId: 'c2', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.STAGE]: 'Renewal Offered' } }], scope);
  assert.equal(r.results[0].code, 'STAGE_LEASE_DRIVEN');
  assert.equal(r.results[1].ok, true);
  const row = rs.store[UAS.TYPE][11];
  assert.equal(row[UAS.STAGE], 'Renewal Offered'); assert.equal(row[UAS.MANUAL_STAGE], 'Renewal Offered'); assert.equal(row[UAS.STAGE_SOURCE], 1); assert.ok(row[UAS.STAGE_DATE] instanceof Date && row[UAS.STAGE_DATE].getDate() === 24 && row[UAS.STAGE_DATE].getMonth() === 9, 'stage date is a Date object (NetSuite rejects date strings)');
  assert.equal(auditRows.length, 1); assert.equal(auditRows[0].changeId, 'c2');
});
test('idempotent replay: the same change id returns the stored result and writes nothing twice', () => {
  const { writes, scope, rs } = build({ store: uasStore() });
  writes.apply([{ changeId: 'same', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.FOLLOWUP]: '2026-11-01' } }], scope);
  const n = rs.saves.length;
  const r = writes.apply([{ changeId: 'same', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.FOLLOWUP]: '2026-12-01' } }], scope);
  assert.equal(r.results[0].replayed, true); assert.equal(rs.saves.length, n);
});
test('stale version is rejected with the current values; partial batch keeps going row by row', () => {
  const { writes, scope } = build({ store: uasStore() });
  const r = writes.apply([{ changeId: 'a', recordType: UAS.TYPE, recordId: 11, version: 'v0', fields: { [UAS.FOLLOWUP]: '2026-11-01' } }, { changeId: 'b', recordType: UAS.TYPE, recordId: 11, version: 'v0', fields: { [UAS.FOLLOWUP]: '2026-11-02' } }, { changeId: 'c', recordType: UAS.TYPE, recordId: 404, fields: { [UAS.FOLLOWUP]: '2026-11-02' } }], scope);
  assert.equal(r.results[0].ok, true); assert.equal(r.results[1].code, 'STALE'); assert.equal(r.results[1].version, 'v1'); assert.equal(r.results[2].code, 'ERROR');
});
test('governance ceiling: changes past the reserve are deferred, not attempted', () => {
  const { writes, scope, runtime } = build({ store: uasStore(), usage: 150 });
  runtime.spend(60); // 90 left < reserve of 100
  const r = writes.apply([{ changeId: 'x', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.FOLLOWUP]: '2026-11-01' } }], scope);
  assert.deepEqual(r.deferred, ['x']); assert.equal(r.results.length, 0);
});
test('market gate: a scoped user cannot write a record in another market, even by POSTing its id', () => {
  const { writes, scope } = build({ store: uasStore(), employeeMarkets: 'Troy', marketOf: () => 'lehigh' });
  const r = writes.apply([{ changeId: 'm', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.FOLLOWUP]: '2026-11-01' } }], scope);
  assert.equal(r.results[0].code, 'DENIED_MARKET');
});
test('audit record missing: writes still happen and are logged, result says log-only', () => {
  const { writes, scope } = build({ store: uasStore(), auditMissing: true });
  const r = writes.apply([{ changeId: 'l', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.FOLLOWUP]: '2026-11-01' } }], scope);
  assert.equal(r.results[0].ok, true); assert.equal(r.results[0].audit, 'log-only');
});
test('tenant pre-screen: one mismatching id rejects the whole multiselect before anything is written', () => {
  const store = { [LEASE.TYPE]: { 7: { [LEASE.PROPERTY]: 100, [LEASE.AY]: 2, [LEASE.TENANTS]: ['1', '2'], lastmodified: 'v0' } } };
  const { writes, scope, rs } = build({ store, tenantLinks: { props: [{ customer: 1, property: 100 }, { customer: 2, property: 100 }, { customer: 3, property: 999 }], ays: [{ customer: 1, ay: 2 }, { customer: 2, ay: 2 }, { customer: 3, ay: 2 }] } });
  const r = writes.apply([{ changeId: 't', recordType: LEASE.TYPE, recordId: 7, fields: { [LEASE.TENANTS]: ['1', '2', '3'] } }], scope);
  assert.equal(r.results[0].code, 'TENANT_FILTER'); assert.deepEqual(r.results[0].bad, [{ tenantId: '3', missingProperty: true, missingAy: false }]); assert.equal(rs.saves.length, 0);
});
test('capture-and-restore: changing a lease\'s Academic Year wipes Tenants in NetSuite; the write layer puts them back and verifies', () => {
  const store = { [LEASE.TYPE]: { 7: { [LEASE.PROPERTY]: 100, [LEASE.AY]: 2, [LEASE.TENANTS]: ['1', '2'], lastmodified: 'v0' } } };
  const { writes, scope, rs } = build({ store, tenantLinks: { props: [{ customer: 1, property: 100 }, { customer: 2, property: 100 }], ays: [{ customer: 1, ay: 2 }, { customer: 2, ay: 2 }, { customer: 1, ay: 3 }, { customer: 2, ay: 3 }] } });
  const r = writes.apply([{ changeId: 'ay', recordType: LEASE.TYPE, recordId: 7, fields: { [LEASE.AY]: 3 } }], scope);
  assert.equal(r.results[0].ok, true, JSON.stringify(r.results[0]));
  assert.deepEqual(r.results[0].tenants.dropped, ['1', '2']); assert.equal(r.results[0].tenants.restoredOk, true);
  assert.deepEqual(rs.store[LEASE.TYPE][7][LEASE.TENANTS].map(String).sort(), ['1', '2']);
  assert.equal(rs.saves.length, 2 + 1); // lease save, restore save, audit
});
test('capture-and-restore refuses the AY change up front when a tenant would fail the new filter', () => {
  const store = { [LEASE.TYPE]: { 7: { [LEASE.PROPERTY]: 100, [LEASE.AY]: 2, [LEASE.TENANTS]: ['1', '2'], lastmodified: 'v0' } } };
  const { writes, scope, rs } = build({ store, tenantLinks: { props: [{ customer: 1, property: 100 }, { customer: 2, property: 100 }], ays: [{ customer: 1, ay: 2 }, { customer: 2, ay: 2 }, { customer: 1, ay: 3 }] } });
  const r = writes.apply([{ changeId: 'ay2', recordType: LEASE.TYPE, recordId: 7, fields: { [LEASE.AY]: 3 } }], scope);
  assert.equal(r.results[0].code, 'TENANT_FILTER'); assert.deepEqual(r.results[0].bad, [{ tenantId: '2', missingProperty: false, missingAy: true }]); assert.equal(rs.saves.length, 0);
});
test('lease creation from the dialog is allowed; creation-only fields cannot be set on an existing lease', () => {
  const store = { [LEASE.TYPE]: { 7: { [LEASE.PROPERTY]: 100, [LEASE.AY]: 2, [LEASE.TENANTS]: [], lastmodified: 'v0' } } };
  const { writes, scope } = build({ store });
  const r = writes.apply([
    { changeId: 'new', recordType: LEASE.TYPE, recordId: null, fields: { name: 'X', [LEASE.PROPERTY]: 100, [LEASE.AY]: 2, custrecord_serp_lease_type_test: 2, [LEASE.MONTHLY_RENT]: 1000 } },
    { changeId: 'upd', recordType: LEASE.TYPE, recordId: 7, fields: { [LEASE.MONTHLY_RENT]: 1 } },
    { changeId: 'del', recordType: LEASE.TYPE, recordId: 7, fields: { isinactive: true } },
  ], scope);
  assert.equal(r.results[0].created, true); assert.equal(r.results[1].code, 'DENIED_FIELD'); assert.equal(r.results[2].ok, true);
});

test('stages are written as list value ids from the probe; "No stage set" clears the field; follow-up dates become Date objects', () => {
  const { writes: base, scope, rs } = build({ store: uasStore() });
  void base;
  const writes = createWrites({ record: rs.record, sq: fakeSuiteQL([[/./, () => []]]), runtime: fakeRuntime({ roleId: 3 }), log: fakeLog, schema: fakeSchema(), auth: createAuth({ runtime: fakeRuntime({ roleId: 3 }), sq: fakeSuiteQL([[/./, () => []]]), schema: fakeSchema(), log: fakeLog }), marketOf: () => 'lehigh', clock: () => '2026-10-24T12:00:00.000Z', stageIdFor: (k) => ({ RENEWAL_OFFERED: 7, READY_FOR_LEASE: 3 })[k] || null });
  const r = writes.apply([
    { changeId: 's1', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.STAGE]: 'Renewal Offered', [UAS.FOLLOWUP]: '2026-11-01' } },
    { changeId: 's2', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.STAGE]: 'In Negotiations' } },
    { changeId: 's3', recordType: UAS.TYPE, recordId: 11, fields: { [UAS.STAGE]: 'No stage set' } },
  ], scope);
  assert.equal(r.results[0].ok, true);
  const row = rs.store[UAS.TYPE][11];
  assert.equal(r.results[1].code, 'STAGE_NO_LIST_VALUE', 'a stage with no list value yet is refused with a message, not sent to NetSuite as text');
  assert.equal(r.results[2].ok, true); assert.equal(row[UAS.STAGE], ''); assert.equal(row[UAS.MANUAL_STAGE], ''); assert.equal(row[UAS.STAGE_DATE], '');
  assert.ok(rs.saves[0].fields[UAS.FOLLOWUP] instanceof Date && rs.saves[0].fields[UAS.FOLLOWUP].getDate() === 1);
  assert.equal(rs.saves[0].fields[UAS.STAGE], 7);
});
