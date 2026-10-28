import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWrites, sameVersion } from '../../src/server/writes.js';
import { createAuth } from '../../src/server/auth.js';
import { fakeRuntime, fakeSuiteQL, fakeRecordStore, fakeLog, fakeSchema } from './fakes.js';
import { UAS, LEASE, CUSTOMER, AUDIT, TOUR, LEAD } from '../../src/shared/constants.js';

function build({ employeeMarkets = 'Bethlehem', usage = 1000, auditMissing = false, store = {}, tenantLinks = { props: [], ays: [] }, marketOf = () => 'lehigh', tourFields = null, existingEmails = {}, outcomeIdFor = (k) => ({ SCHEDULED: 1, COMPLETED: 2, NO_SHOW: 3, CANCELLED: 4, LEASED: 5 })[k] || null, notify = null, overlapsFor = null } = {}) {
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
  rs.record.create = (o) => { const r = origCreate(o); if (o.type === AUDIT.TYPE) { const vals = {}; const set = r.setValue; r.setValue = ({ fieldId, value }) => { vals[fieldId] = value; set({ fieldId, value }); }; const save = r.save; r.save = () => { const id = save(); auditRows.push({ changeId: vals[AUDIT.CHANGE_ID], rt: vals[AUDIT.RECORD_TYPE], rid: vals[AUDIT.RECORD_ID], after: vals[AUDIT.AFTER], when: vals[AUDIT.WHEN] }); return id; }; } return r; };
  const writes = createWrites({ record: rs.record, sq, runtime, log: fakeLog, schema, auth, marketOf, clock: () => '2026-10-24T12:00:00.000Z', tourFields, outcomeIdFor, defaultSubsidiaryId: () => 1, findByEmail: (e) => existingEmails[String(e).toLowerCase()] || [], stageOf: (id) => { const c = (rs.store[CUSTOMER.TYPE] || {})[id]; return c ? { stage: c.stage, entitystatus: c.entitystatus } : null; }, notify, overlapsFor });
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
  assert.equal(auditRows.length, 1); assert.equal(auditRows[0].changeId, 'c2'); assert.ok(auditRows[0].when instanceof Date, 'the audit timestamp is a Date (a Date/Time field rejects ISO text)');
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

test('version check: the SuiteQL stamp the row was read with matches the same stamp read back, in any of NetSuite’s spellings', () => {
  assert.equal(sameVersion('10/20/2026', '10/20/2026'), true);
  assert.equal(sameVersion('10/20/2026 1:34 am', '2026-10-20'), true, 'date-only versus date-time on the same day');
  assert.equal(sameVersion('10/20/2026 1:34 am', '10/20/2026 1:35 am'), false);
  assert.equal(sameVersion('10/20/2026', '10/21/2026'), false);
  assert.equal(sameVersion(new Date(2026, 9, 20, 13, 34), '2026-10-20T13:34'), true);
  assert.equal(sameVersion(null, 'v0'), true, 'no stamp on record ⇒ nothing to compare');
});

test('lead create: a Lead record at Lead-New in the Lead Form subsidiary, owned by the creator; identity fields are creation-only; duplicates by email are refused with the existing id', () => {
  const { writes, scope, rs } = build({ existingEmails: { 'dup@example.com': [{ id: 777, firstname: 'Dee', lastname: 'Dup' }] } });
  const r = writes.apply([
    { changeId: 'l1', recordType: CUSTOMER.TYPE, fields: { firstname: 'Ann', lastname: 'Lee', email: 'ann@example.com', custentity_serp_schools: 2, [CUSTOMER.PROPERTY]: [10], custentity_desired_location: '411 Webster' } },
    { changeId: 'l2', recordType: CUSTOMER.TYPE, fields: { firstname: 'Dee', email: 'dup@example.com' } },
    { changeId: 'l3', recordType: CUSTOMER.TYPE, fields: { custentity_desired_location: 'no name no email' } },
    { changeId: 'l4', recordType: CUSTOMER.TYPE, recordId: 777, fields: { firstname: 'Rename' } },
  ], scope);
  assert.equal(r.results[0].ok, true); const row = rs.store.lead[r.results[0].recordId]; assert.ok(row, 'created through the Lead record type');
  assert.equal(row.entitystatus, LEAD.STATUS_NEW); assert.equal(row.isperson, 'T', 'isperson is a radio field: T, never a boolean'); assert.equal(row.subsidiary, 1); assert.equal(row.salesrep, 42); assert.deepEqual(row[CUSTOMER.PROPERTY], [10]);
  assert.equal(r.results[1].code, 'DUPLICATE'); assert.equal(r.results[1].existingId, '777');
  assert.equal(r.results[2].code, 'BAD_CHANGE');
  assert.equal(r.results[3].code, 'DENIED_FIELD');
});
test('tour create: an Event on the organiser calendar with defaults; times become Dates on the tour date; a lead created in the same batch is linked through $prev', () => {
  const { writes, scope, rs } = build();
  const r = writes.apply([
    { changeId: 't0', recordType: CUSTOMER.TYPE, fields: { firstname: 'Walk', lastname: 'In', email: 'walk@example.com' } },
    { changeId: 't1', recordType: TOUR.TYPE, fields: { title: 'Tour · Walk In', startdate: '2026-11-03', starttime: '10:30', company: '$prev', [TOUR.UNIT]: [55, 56], [TOUR.AY]: [2, 3] } },
    { changeId: 't2', recordType: TOUR.TYPE, fields: { starttime: '10:30' } },
  ], scope);
  assert.equal(r.results[1].ok, true); const ev = rs.store[TOUR.TYPE][r.results[1].recordId];
  assert.equal(ev.company, Number(r.results[0].recordId));
  assert.equal(r.results[1].leadStatus, undefined, 'a lead created in the same batch lives in the lead store, which the status step does not see in this fake'); assert.equal(ev.organizer, 42); assert.equal(ev.status, 'CONFIRMED'); assert.equal(ev.accesslevel, 'PUBLIC'); assert.equal(ev.timedevent, true);
  assert.ok(ev.startdate instanceof Date && ev.startdate.getDate() === 3); assert.ok(ev.starttime instanceof Date && ev.starttime.getHours() === 10 && ev.starttime.getMinutes() === 30 && ev.starttime.getDate() === 3, 'start time carries the tour date');
  assert.ok(ev.endtime instanceof Date && ev.endtime.getHours() === 11 && ev.endtime.getMinutes() === 0, 'end = start + 30 min by default');
  assert.equal(r.results[2].code, 'BAD_CHANGE');
});
test('tour: missing custom fields are dropped and reported, the outcome key maps to the list id, Cancelled also cancels the event', () => {
  const { writes, scope, rs } = build({ tourFields: () => ({ unit: false, outcome: true, ay: false }), store: { [TOUR.TYPE]: { 500: { title: 'Tour', startdate: new Date(2026, 10, 3), status: 'CONFIRMED', lastmodified: 'v0' } } } });
  const r = writes.apply([
    { changeId: 'u1', recordType: TOUR.TYPE, fields: { startdate: '2026-11-03', [TOUR.UNIT]: 55, [TOUR.AY]: 2, [TOUR.OUTCOME]: 'SCHEDULED' } },
    { changeId: 'u2', recordType: TOUR.TYPE, recordId: 500, fields: { [TOUR.OUTCOME]: 'CANCELLED' } },
    { changeId: 'u3', recordType: TOUR.TYPE, recordId: 500, fields: { [TOUR.OUTCOME]: 'BOGUS' } },
  ], scope);
  assert.equal(r.results[0].ok, true); assert.deepEqual(r.results[0].dropped, [TOUR.UNIT, TOUR.AY]); const ev = rs.store[TOUR.TYPE][r.results[0].recordId]; assert.equal(ev[TOUR.UNIT], undefined); assert.equal(ev[TOUR.OUTCOME], 1);
  assert.equal(r.results[1].ok, true); assert.equal(rs.store[TOUR.TYPE][500][TOUR.OUTCOME], 4); assert.equal(rs.store[TOUR.TYPE][500].status, 'CANCELLED');
  assert.equal(r.results[2].code, 'BAD_CHANGE');
});

test('a tour moves a LEAD-stage record to Tour Scheduled, a Completed outcome to Tour Completed; tenants are left alone; an un-flagged Sales Rep is dropped rather than failing the lead', () => {
  const store = { [CUSTOMER.TYPE]: { 900: { stage: 'LEAD', entitystatus: 6, lastmodifieddate: 'v0' }, 901: { stage: 'CUSTOMER', entitystatus: 13, lastmodifieddate: 'v0' } }, [TOUR.TYPE]: { 500: { startdate: new Date(2026, 10, 3), company: 900, status: 'CONFIRMED', lastmodified: 'v0' } } };
  const { writes, scope, rs } = build({ store });
  const r = writes.apply([
    { changeId: 'a1', recordType: TOUR.TYPE, fields: { startdate: '2026-11-03', starttime: '10:00', company: 900 } },
    { changeId: 'a2', recordType: TOUR.TYPE, fields: { startdate: '2026-11-03', starttime: '11:00', company: 901 } },
    { changeId: 'a3', recordType: TOUR.TYPE, recordId: 500, fields: { [TOUR.OUTCOME]: 'COMPLETED' } },
  ], scope);
  assert.equal(r.results[0].leadStatus, LEAD.STATUS_TOUR_SCHEDULED);
  assert.equal(r.results[1].leadStatus, undefined); assert.equal(rs.store[CUSTOMER.TYPE][901].entitystatus, 13);
  assert.equal(r.results[2].leadStatus, LEAD.STATUS_TOUR_COMPLETED); assert.equal(rs.store[CUSTOMER.TYPE][900].entitystatus, 22);
  // Sales Rep not flagged on the employee: NetSuite rejects the reference; the lead is saved without it and the drop is reported
  const origCreate = rs.record.create; let attempts = 0;
  rs.record.create = (o) => { const rec = origCreate(o); if (o.type === 'lead') { const save = rec.save; rec.save = () => { attempts += 1; if (attempts === 1) throw new Error('Invalid salesrep reference key 42.'); return save(); }; } return rec; };
  const r2 = writes.apply([{ changeId: 'a4', recordType: CUSTOMER.TYPE, fields: { firstname: 'No', lastname: 'Rep', email: 'norep@example.com' } }], scope);
  assert.equal(r2.results[0].ok, true); assert.deepEqual(r2.results[0].dropped, ['salesrep']); assert.equal(rs.store.lead[r2.results[0].recordId].salesrep, undefined);
});
test('@mentions on a new note notify the mentioned employees (not the author)', () => {
  const calls = [];
  const { writes, scope } = build({ notify: (a) => { calls.push(a); return a.mentions.length; } });
  const r = writes.apply([{ changeId: 'n1', recordType: 'customrecord_ad_uas_note', fields: { name: '1 Ashe St Unit - A — 2026-10-27', custrecord_ad_note_status: 11, custrecord_ad_note_text: 'hi @Pat', custrecord_ad_note_date: '2026-10-27', custrecord_ad_note_mentions: [7, 8] } }], scope);
  assert.equal(r.results[0].ok, true); assert.equal(r.results[0].notified, 2); assert.deepEqual(calls[0].mentions, [7, 8]);
});

test('tour: a single-select unit or AY field refuses the list; the first value is kept and the save reports it', () => {
  const { writes, scope, rs } = build();
  const origCreate = rs.record.create;
  rs.record.create = (o) => { const rec = origCreate(o); if (o.type === TOUR.TYPE) { const vals = {}; const set = rec.setValue; rec.setValue = (a) => { vals[a.fieldId] = a.value; set(a); }; const save = rec.save; rec.save = () => { if (Array.isArray(vals[TOUR.AY])) throw new Error(`You have entered an Invalid Field Value 2,3 for the following field: ${TOUR.AY}`); return save(); }; } return rec; };
  const r = writes.apply([{ changeId: 's1', recordType: TOUR.TYPE, fields: { startdate: '2026-11-03', [TOUR.UNIT]: [55, 56], [TOUR.AY]: [2, 3] } }], scope);
  assert.equal(r.results[0].ok, true); assert.equal(r.results[0].singleValued, true); const ev = rs.store[TOUR.TYPE][r.results[0].recordId]; assert.equal(ev[TOUR.AY], 2); assert.deepEqual(ev[TOUR.UNIT], [55, 56], 'only the field NetSuite named is collapsed');
});

test('a new lease whose dates overlap an existing one on the same beds is refused with the overlaps; ending the other lease first in the same batch clears the way', () => {
  const store = { [LEASE.TYPE]: { 300: { [LEASE.PROPERTY]: 10, [LEASE.UNIT]: 55, [LEASE.START]: new Date(2027, 5, 1), [LEASE.END]: new Date(2028, 4, 23), [LEASE.TENANTS]: [], lastmodified: 'v0' } } };
  let live = null; // the fake store the writes actually mutate (build() deep-copies the seed)
  const overlapsFor = (fields) => { const l = live[LEASE.TYPE][300]; const end = l[LEASE.END] instanceof Date ? l[LEASE.END].toISOString().slice(0, 10) : String(l[LEASE.END]).slice(0, 10); const start = String(fields[LEASE.START]); return l.isinactive || start > end ? [] : [{ id: '300', name: 'Unit 55 AY 27-28', start: '2027-06-01', end }]; };
  const { writes, scope, rs } = build({ store, overlapsFor }); live = rs.store;
  const r = writes.apply([
    { changeId: 'o1', recordType: LEASE.TYPE, fields: { name: 'new', [LEASE.PROPERTY]: 10, [LEASE.UNIT]: 55, [LEASE.START]: '2028-01-01', [LEASE.END]: '2028-07-31', 'custrecord_serp_lease_type_test': 2 } },
    { changeId: 'o2', recordType: LEASE.TYPE, recordId: 300, version: 'v0', fields: { [LEASE.END]: '2027-12-31' } },
    { changeId: 'o3', recordType: LEASE.TYPE, fields: { name: 'new', [LEASE.PROPERTY]: 10, [LEASE.UNIT]: 55, [LEASE.START]: '2028-01-01', [LEASE.END]: '2028-07-31', 'custrecord_serp_lease_type_test': 2 } },
  ], scope);
  assert.equal(r.results[0].code, 'LEASE_OVERLAP'); assert.equal(r.results[0].overlaps[0].id, '300');
  assert.equal(r.results[1].ok, true);
  assert.equal(r.results[2].ok, true); assert.equal(r.results[2].created, true);
  assert.equal(Object.keys(rs.store[LEASE.TYPE]).length, 2);
});
