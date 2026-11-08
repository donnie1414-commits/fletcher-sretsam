import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWrites } from '../../src/server/writes.js';
import { createAuth } from '../../src/server/auth.js';
import { createLeaseChange } from '../../src/server/leaseChange.js';
import { fakeRuntime, fakeSuiteQL, fakeRecordStore, fakeLog, fakeSchema } from './fakes.js';
import { LEASE, LEASE_CHAIN, AMEND, CUSTOMER, AUDIT } from '../../src/shared/constants.js';

const LISTS = {
  [AMEND.TYPE_LIST]: ['Revise', 'Supersede', 'Terminate', 'Cancel', 'Transfer', 'Assignment'],
  [AMEND.STATUS_LIST]: ['Draft', 'Pending approval', 'Approved', 'Sent for signature', 'Signed', 'Applied', 'Rejected', 'Withdrawn', 'Failed'],
  [AMEND.END_REASON_LIST]: ['Completed', 'Cancelled before start', 'Transferred', 'Released early', 'Superseded by amendment'],
  [LEASE_CHAIN.GROUP_TYPE_LIST]: ['New Group', 'Transfers', 'Renewal', 'Amendment'],
  customlist_serp_lease_type_list: ['Whole House', 'Unit', 'Bedroom'],
};
const rowsOf = (list) => LISTS[list].map((name, i) => ({ id: i + 1, name }));
const nameOf = (list, id) => (LISTS[list] || [])[Number(id) - 1] || null;

function build({ lease = {}, released = true, tenantProps = { 1: ['7'], 2: ['7'], 3: ['7'], 9: [] }, tenantAys = { 1: ['4'], 2: ['4'], 3: ['4'], 9: [] } } = {}) {
  const auditRows = [];
  const rs = fakeRecordStore({
    [LEASE.TYPE]: { 100: { name: '12 Elm AY27/28', isinactive: false, [LEASE.PROPERTY]: 7, [LEASE.UNIT]: 70, [LEASE.STATUS]: 1, [LEASE.AY]: 4, [LEASE.START]: '2027-06-01', [LEASE.END]: '2028-05-31', [LEASE.MONTHLY_RENT]: 3000, [LEASE_CHAIN.TOTAL]: 36000, [LEASE.TENANTS]: ['1', '2', '3'], sent: '2026-10-01', ...lease } },
    [CUSTOMER.TYPE]: { 1: {}, 2: {}, 3: {}, 9: {} },
  });
  const S = rs.store;
  const leaseRow = (id) => { const l = S[LEASE.TYPE][id]; if (!l) return []; return [{ id, name: l.name, isinactive: l.isinactive ? 'T' : 'F', property: l[LEASE.PROPERTY], unit: l[LEASE.UNIT], lease_type: 2, lease_type_name: 'Unit', status: l[LEASE.STATUS], status_name: l[LEASE.STATUS] === 1 ? 'Fully Executed' : l[LEASE.STATUS] === 2 ? 'In Process' : null, ay: l[LEASE.AY], start_date: l[LEASE.START] instanceof Date ? l[LEASE.START].toISOString().slice(0, 10) : l[LEASE.START], end_date: l[LEASE.END] instanceof Date ? l[LEASE.END].toISOString().slice(0, 10) : l[LEASE.END], monthly_rent: l[LEASE.MONTHLY_RENT], total_rent: l[LEASE_CHAIN.TOTAL], sent_date: l.sent || null, version: l[LEASE_CHAIN.VERSION] ?? null, supersedes: l[LEASE_CHAIN.SUPERSEDES] ?? null, provisions: '', end_reason_name: nameOf(AMEND.END_REASON_LIST, l[LEASE_CHAIN.END_REASON]), lastmodified: l.lastmodified }]; };
  const sq = fakeSuiteQL([
    [/FROM employee WHERE id/, () => [{ markets: 'Bethlehem' }]],
    [new RegExp(`FROM ${AUDIT.TYPE} WHERE`), (m, params) => auditRows.filter((a) => a.changeId === params[0])],
    [/WHERE ROWNUM <= 1/, () => []],
    [/FROM entitystatus/, () => (released ? [{ id: 25 }] : [])],
    [/SELECT id, name FROM (customlist\w+) WHERE isinactive/, (m) => rowsOf(m[1])],
    [new RegExp(`FROM ${LEASE.TYPE} WHERE id = \\?`), (m, p) => leaseRow(p[0])],
    [/FROM MAP_customrecord_serp_lease_record_custrecord_serp_tenants_ WHERE mapone = \?/, (m, p) => (S[LEASE.TYPE][p[0]][LEASE.TENANTS] || []).map((c) => ({ customer: c }))],
    [/FROM map_customer_custentity_serp_ent_property WHERE mapone = \?/, (m, p) => ((S[CUSTOMER.TYPE][p[0]] || {})[CUSTOMER.PROPERTY] || tenantProps[p[0]] || []).map((v) => ({ v }))],
    [/FROM map_customer_custentity_serp_academic_year WHERE mapone = \?/, (m, p) => ((S[CUSTOMER.TYPE][p[0]] || {})[CUSTOMER.AY] || tenantAys[p[0]] || []).map((v) => ({ v }))],
    [/FROM map_customer_custentity_serp_ent_property WHERE mapone IN \(([^)]*)\)/, (m) => m[1].split(',').flatMap((t) => ((S[CUSTOMER.TYPE][t] || {})[CUSTOMER.PROPERTY] || tenantProps[t] || []).map((p) => ({ customer: t, property: String(p) })))],
    [/FROM map_customer_custentity_serp_academic_year WHERE mapone IN \(([^)]*)\)/, (m) => m[1].split(',').flatMap((t) => ((S[CUSTOMER.TYPE][t] || {})[CUSTOMER.AY] || tenantAys[t] || []).map((a) => ({ customer: t, ay: String(a) })))],
    [new RegExp(`FROM ${AMEND.TYPE} WHERE id = \\?`), (m, p) => { const a = (S[AMEND.TYPE] || {})[p[0]]; return a ? [{ id: p[0], name: a.name, lease: a[AMEND.LEASE], status: a[AMEND.STATUS], status_name: nameOf(AMEND.STATUS_LIST, a[AMEND.STATUS]), plan: a[AMEND.PLAN], result_lease: a[AMEND.RESULT_LEASE] ?? null }] : []; }],
    [new RegExp(`FROM ${AMEND.TYPE} WHERE ${AMEND.LEASE}`), () => []],
    [/FROM customrecord_ad_unit_ay_status WHERE/, () => []],
  ]);
  const runtime = fakeRuntime({ usage: 5000 }); const schema = fakeSchema();
  const auth = createAuth({ runtime, sq, schema, log: fakeLog });
  const origCreate = rs.record.create;
  rs.record.create = (o) => { const r = origCreate(o); if (o.type === AUDIT.TYPE) { const vals = {}; const set = r.setValue; r.setValue = ({ fieldId, value }) => { vals[fieldId] = value; set({ fieldId, value }); }; const save = r.save; r.save = () => { const id = save(); auditRows.push({ changeId: vals[AUDIT.CHANGE_ID], rt: vals[AUDIT.RECORD_TYPE], rid: vals[AUDIT.RECORD_ID] }); return id; }; } return r; };
  const writes = createWrites({ record: rs.record, sq, runtime, log: fakeLog, schema, auth, marketOf: () => 'lehigh', clock: () => '2026-11-08T12:00:00.000Z' });
  const lc = createLeaseChange({ sq, writes, log: fakeLog, clock: () => '2026-11-08T12:00:00.000Z' });
  return { lc, writes, scope: auth.resolve(), S, rs };
}
const iso = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : v);

test('signed lease renegotiated: an amendment is filed for approval, nothing on the lease changes yet', () => {
  const { lc, scope, S } = build();
  const r = lc.submit(scope, { changeId: 'abc', leaseId: '100', scenario: 'RENEGOTIATE', input: { effective: '2027-09-01', newRent: 2700, reason: 'rent relief' } });
  assert.equal(r.ok, true, r.error); assert.equal(r.applied, false); assert.equal(r.status, 'PENDING');
  const a = S[AMEND.TYPE][r.amendmentId];
  assert.equal(nameOf(AMEND.STATUS_LIST, a[AMEND.STATUS]), 'Pending approval');
  assert.equal(nameOf(AMEND.TYPE_LIST, a[AMEND.KIND]), 'Supersede');
  assert.equal(a[AMEND.NEW_RENT], 2700); assert.equal(iso(a[AMEND.EFFECTIVE]), '2027-09-01');
  assert.equal(JSON.parse(a[AMEND.PLAN]).steps.length, 2);
  assert.equal(iso(S[LEASE.TYPE][100][LEASE.END]), '2028-05-31');
});

test('a pending amendment cannot be applied; once signed it supersedes the lease, and a second apply changes nothing', () => {
  const { lc, scope, S } = build();
  const r = lc.submit(scope, { changeId: 'abc', leaseId: '100', scenario: 'RENEGOTIATE', input: { effective: '2027-09-01', newRent: 2700 } });
  assert.equal(lc.apply(scope, r.amendmentId).ok, false);
  S[AMEND.TYPE][r.amendmentId][AMEND.STATUS] = 5; // Signed
  const ap = lc.apply(scope, r.amendmentId);
  assert.equal(ap.ok, true, ap.error);
  const old = S[LEASE.TYPE][100];
  assert.equal(iso(old[LEASE.END]), '2027-08-31'); assert.equal(nameOf(AMEND.END_REASON_LIST, old[LEASE_CHAIN.END_REASON]), 'Superseded by amendment');
  const nu = S[LEASE.TYPE][ap.resultLeaseId];
  assert.equal(iso(nu[LEASE.START]), '2027-09-01'); assert.equal(nu[LEASE.MONTHLY_RENT], 2700); assert.equal(nu[LEASE_CHAIN.SUPERSEDES], 100); assert.equal(nu[LEASE_CHAIN.VERSION], 2);
  assert.equal(nameOf(LEASE_CHAIN.GROUP_TYPE_LIST, nu[LEASE_CHAIN.GROUP_TYPE]), 'Amendment'); assert.equal(nu[LEASE.STATUS], 1);
  assert.deepEqual(nu[LEASE.TENANTS].map(String), ['1', '2', '3']);
  const a = S[AMEND.TYPE][r.amendmentId];
  assert.equal(nameOf(AMEND.STATUS_LIST, a[AMEND.STATUS]), 'Applied'); assert.equal(a[AMEND.RESULT_LEASE], Number(ap.resultLeaseId));
  const again = lc.apply(scope, r.amendmentId);
  assert.equal(again.already, true);
});

test('unsigned lease: tenant added after sending is revised in place, scoped first, stage to Lease Revisions, logged as Applied', () => {
  const { lc, scope, S } = build({ lease: { [LEASE.STATUS]: 2 } });
  S.customrecord_ad_unit_ay_status = {};
  const r = lc.submit(scope, { changeId: 'x1', leaseId: '100', scenario: 'ADD_AFTER_SENT', input: { tenantsAdded: ['9'] } });
  assert.equal(r.ok, true, r.error); assert.equal(r.applied, true);
  assert.deepEqual(S[CUSTOMER.TYPE][9][CUSTOMER.PROPERTY], [7]); assert.deepEqual(S[CUSTOMER.TYPE][9][CUSTOMER.AY], [4]);
  assert.deepEqual(S[LEASE.TYPE][100][LEASE.TENANTS].map(String), ['1', '2', '3', '9']); assert.equal(S[LEASE.TYPE][100][LEASE.TENANT_COUNT], 4);
  assert.match(r.todo.join(), /Void the sent PandaDoc documents/);
  assert.equal(nameOf(AMEND.STATUS_LIST, S[AMEND.TYPE][r.amendmentId][AMEND.STATUS]), 'Applied');
  const uas = Object.values(S.customrecord_ad_unit_ay_status)[0]; assert.equal(uas.custrecord_ad_uas_stage, 'LEASE_REVISIONS');
});

test('the generic write route cannot touch amendments or a lease rent', () => {
  const { writes, scope } = build();
  const r = writes.apply([{ changeId: 'w1', recordType: AMEND.TYPE, recordId: null, fields: { name: 'x' } }, { changeId: 'w2', recordType: LEASE.TYPE, recordId: 100, fields: { [LEASE.MONTHLY_RENT]: 1 } }], scope);
  assert.deepEqual(r.results.map((x) => x.code), ['DENIED_RECORD', 'DENIED_FIELD']);
});

test('whole group released on a signed lease: terminated with a reason; tenants marked Released when the status exists', () => {
  const { lc, scope, S } = build();
  const r = lc.submit(scope, { changeId: 'g1', leaseId: '100', scenario: 'RELEASE_ALL', input: { effective: '2027-12-01', fee: 500 } });
  S[AMEND.TYPE][r.amendmentId][AMEND.STATUS] = 5;
  const ap = lc.apply(scope, r.amendmentId); assert.equal(ap.ok, true, ap.error);
  assert.equal(iso(S[LEASE.TYPE][100][LEASE.END]), '2027-11-30'); assert.equal(nameOf(AMEND.END_REASON_LIST, S[LEASE.TYPE][100][LEASE_CHAIN.END_REASON]), 'Released early');
  assert.equal(S[CUSTOMER.TYPE][1].entitystatus, 25);
});
