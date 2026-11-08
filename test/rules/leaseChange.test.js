import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChange, leaseState, totalFor, keyFromLabel, AMEND_STATUSES, canApply } from '../../src/shared/rules/leaseChange.js';

const L = (o = {}) => ({ id: '100', name: '12 Elm AY27/28', inactive: false, statusKey: 'EXECUTED', sentDate: '2026-10-01', start: '2027-06-01', end: '2028-05-31', monthlyRent: 3000, totalRent: 36000, tenantIds: ['1', '2', '3'], propertyId: '7', unitId: '70', ayFieldRaw: '4', typeKey: 'UNIT', provisions: '', version: null, ...o });
const ops = (p) => p.steps.map((s) => s.op);

test('state decides the path: draft edits, sent revises, signed amends, inactive is closed', () => {
  assert.equal(leaseState(L({ statusKey: 'NONE', sentDate: null })), 'DRAFT');
  assert.equal(leaseState(L({ statusKey: 'IN_PROCESS' })), 'SENT');
  assert.equal(leaseState(L({ statusKey: 'NONE', sentDate: '2026-10-01' })), 'SENT');
  assert.equal(leaseState(L()), 'EXECUTED');
  assert.equal(leaseState(L({ inactive: true })), 'CLOSED');
  const p = planChange({ scenario: 'RENEGOTIATE', lease: L({ inactive: true }), input: { newRent: 3100, effective: '2027-09-01' } });
  assert.equal(p.ok, false);
});

test('renegotiated signed lease: supersede — old ends the day before, new lease linked, needs approval', () => {
  const p = planChange({ scenario: 'RENEGOTIATE', lease: L(), input: { effective: '2027-09-01', newRent: 2700 } });
  assert.equal(p.ok, true); assert.equal(p.path, 'AMEND'); assert.equal(p.mechanism, 'SUPERSEDE'); assert.equal(p.needsApproval, true);
  assert.deepEqual(ops(p), ['updateLease', 'createLease']);
  assert.deepEqual(p.steps[0].fields, { end: '2027-08-31', endReason: 'SUPERSEDED' });
  const n = p.steps[1].fields;
  assert.equal(n.start, '2027-09-01'); assert.equal(n.end, '2028-05-31'); assert.equal(n.monthly, 2700); assert.equal(n.supersedes, '100'); assert.equal(n.version, 2); assert.equal(n.groupType, 'AMENDMENT');
  assert.equal(n.total, 24300); // 9 months × 2,700
  assert.equal(p.amendment.oldRent, 3000); assert.equal(p.amendment.newRent, 2700);
});

test('renegotiated before signing: revise in place, stage to Lease Revisions, resend reminder, no approval', () => {
  const p = planChange({ scenario: 'RENEGOTIATE', lease: L({ statusKey: 'IN_PROCESS' }), input: { newRent: 2900 } });
  assert.equal(p.path, 'REVISE'); assert.equal(p.mechanism, 'REVISE'); assert.equal(p.needsApproval, false);
  assert.deepEqual(ops(p), ['updateLease', 'stage', 'manual']);
  assert.equal(p.steps[0].fields.monthly, 2900); assert.equal(p.steps[0].fields.total, 34800);
});

test('draft lease: edit only, no stage, no resend', () => {
  const p = planChange({ scenario: 'ADD_AFTER_SENT', lease: L({ statusKey: 'NONE', sentDate: null }), input: { tenantsAdded: ['9'] } });
  assert.equal(p.path, 'EDIT'); assert.deepEqual(ops(p), ['tenantScope', 'updateLease']);
  assert.deepEqual(p.steps[1].fields.tenants, ['1', '2', '3', '9']); assert.equal(p.steps[1].fields.tenantCount, 4);
});

test('tenant replaced on a signed lease with the same terms: assignment on the same lease, outgoing tenant released', () => {
  const p = planChange({ scenario: 'REPLACE_TENANT', lease: L(), input: { effective: '2027-07-01', tenantsRemoved: ['2'], tenantsAdded: ['8'] } });
  assert.equal(p.mechanism, 'ASSIGN');
  assert.deepEqual(ops(p), ['tenantScope', 'updateLease', 'tenantStatus']);
  assert.deepEqual(p.steps[1].fields.tenants, ['1', '3', '8']);
  assert.deepEqual(p.steps[2].tenants, ['2']);
});

test('one tenant released with a rent change: supersede with the remaining tenants', () => {
  const p = planChange({ scenario: 'RELEASE_ONE', lease: L(), input: { effective: '2027-10-01', tenantsRemoved: ['3'], newRent: 2000 } });
  assert.equal(p.mechanism, 'SUPERSEDE'); assert.deepEqual(p.steps[1].fields.tenants, ['1', '2']);
  assert.equal(p.steps.at(-1).op, 'tenantStatus');
});

test('entire group released: terminate after start, cancel before start', () => {
  const t = planChange({ scenario: 'RELEASE_ALL', lease: L(), input: { effective: '2027-12-01', fee: 500 } });
  assert.equal(t.mechanism, 'TERMINATE'); assert.deepEqual(t.steps[0].fields, { end: '2027-11-30', endReason: 'RELEASED' });
  const c = planChange({ scenario: 'RELEASE_ALL', lease: L(), input: { effective: '2027-05-01' } });
  assert.equal(c.mechanism, 'CANCEL'); assert.deepEqual(c.steps[0].fields, { inactive: true, endReason: 'CANCELLED' });
});

test('group moves house: tenants scoped to the new property, old lease transferred, new lease at the target', () => {
  const p = planChange({ scenario: 'MOVE_GROUP', lease: L(), input: { effective: '2027-08-15' }, target: { propertyId: '9', unitId: '90', name: '5 Oak Unit 1', typeKey: 'UNIT' } });
  assert.equal(p.mechanism, 'TRANSFER');
  assert.deepEqual(ops(p), ['tenantScope', 'updateLease', 'createLease']);
  assert.equal(p.steps[1].fields.endReason, 'TRANSFERRED'); assert.equal(p.steps[2].fields.property, '9'); assert.equal(p.steps[2].fields.groupType, 'TRANSFER');
});

test('one tenant moves to another lease: removed here, joins there', () => {
  const other = L({ id: '200', name: '14 Elm', tenantIds: ['5'], propertyId: '8', unitId: '80' });
  const p = planChange({ scenario: 'MOVE_TENANT', lease: L(), other, input: { effective: '2027-09-01', tenantsRemoved: ['1'] } });
  assert.equal(p.ok, true);
  const last = p.steps.filter((s) => s.leaseId === '200');
  assert.deepEqual(last[0].fields.tenants, ['5', '1']);
});

test('validation: tenant not on the lease, effective after the end, missing inputs', () => {
  assert.match(planChange({ scenario: 'RELEASE_ONE', lease: L(), input: { effective: '2027-09-01', tenantsRemoved: ['42'] } }).errors.join(), /not on this lease/);
  assert.match(planChange({ scenario: 'RENEGOTIATE', lease: L(), input: { effective: '2029-01-01', newRent: 1 } }).errors.join(), /after the lease ends/);
  assert.match(planChange({ scenario: 'RENEGOTIATE', lease: L(), input: { effective: '2027-09-01' } }).errors.join(), /new rent/);
  assert.match(planChange({ scenario: 'RELEASE_ONE', lease: L(), input: { effective: '2027-09-01', tenantsRemoved: ['1', '2', '3'] } }).errors.join(), /Entire group/);
});

test('helpers: totals pro rata, list labels to keys, apply gate', () => {
  assert.equal(totalFor(1000, '2027-06-01', '2028-05-31'), 12000);
  assert.equal(totalFor(1000, '2027-06-16', '2027-06-30'), 500);
  assert.equal(keyFromLabel('Pending Approval', AMEND_STATUSES), 'PENDING');
  assert.equal(keyFromLabel('sent for signature', AMEND_STATUSES), 'SENT');
  assert.equal(canApply('SIGNED'), true); assert.equal(canApply('APPROVED'), false); assert.equal(canApply('APPROVED', { applyOnApproval: true }), true);
});
