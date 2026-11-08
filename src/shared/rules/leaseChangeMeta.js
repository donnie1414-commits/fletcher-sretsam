/**
 * Lease-change vocabulary shared by the hub's browser code and the server: the nine change types, the amendment lists
 * and the apply gate. Kept apart from leaseChange.js (the planner) so the client bundle carries only what the dialog shows.
 */
export const CHANGE_STATES = Object.freeze({ DRAFT: 'DRAFT', SENT: 'SENT', EXECUTED: 'EXECUTED', CLOSED: 'CLOSED' });
export const CHANGE_PATHS = Object.freeze({ EDIT: 'EDIT', REVISE: 'REVISE', AMEND: 'AMEND' });
/** Mechanisms. The amendment-type list in NetSuite carries one value per key (labels in AMEND_TYPES). */
export const MECHANISMS = Object.freeze({ REVISE: 'REVISE', SUPERSEDE: 'SUPERSEDE', TERMINATE: 'TERMINATE', CANCEL: 'CANCEL', TRANSFER: 'TRANSFER', ASSIGN: 'ASSIGN' });
export const AMEND_TYPES = Object.freeze([
  { key: 'REVISE', label: 'Revise' }, { key: 'SUPERSEDE', label: 'Supersede' }, { key: 'TERMINATE', label: 'Terminate' },
  { key: 'CANCEL', label: 'Cancel' }, { key: 'TRANSFER', label: 'Transfer' }, { key: 'ASSIGN', label: 'Assignment' },
]);
export const AMEND_STATUSES = Object.freeze([
  { key: 'DRAFT', label: 'Draft' }, { key: 'PENDING', label: 'Pending approval' }, { key: 'APPROVED', label: 'Approved' },
  { key: 'SENT', label: 'Sent for signature' }, { key: 'SIGNED', label: 'Signed' }, { key: 'APPLIED', label: 'Applied' },
  { key: 'REJECTED', label: 'Rejected' }, { key: 'WITHDRAWN', label: 'Withdrawn' }, { key: 'FAILED', label: 'Failed' },
]);
export const END_REASONS = Object.freeze([
  { key: 'COMPLETED', label: 'Completed' }, { key: 'CANCELLED', label: 'Cancelled before start' }, { key: 'TRANSFERRED', label: 'Transferred' },
  { key: 'RELEASED', label: 'Released early' }, { key: 'SUPERSEDED', label: 'Superseded by amendment' },
]);
/** A list value's key from its name, tolerant of case and punctuation ("Pending Approval", "pending-approval"). */
export function keyFromLabel(name, table) {
  const n = String(name || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const hit = table.find((t) => t.label.toLowerCase().replace(/[^a-z]+/g, ' ').trim() === n || t.key.toLowerCase().replace(/_/g, ' ') === n);
  return hit ? hit.key : null;
}

/** The nine scenarios from the plan. `inputs` lists what the dialog asks for; `?` marks optional. */
export const CHANGE_SCENARIOS = Object.freeze([
  { key: 'MOVE_GROUP', n: 1, label: 'Group moves to a different house', inputs: ['effective', 'target', 'newRent?'], doc: 'Termination of the old lease and a new lease' },
  { key: 'MOVE_TENANT', n: 2, label: 'One tenant moves to another lease', inputs: ['effective', 'tenantsRemoved', 'otherLease', 'newRent?', 'otherNewRent?'], doc: 'An addendum on each lease' },
  { key: 'REPLACE_TENANT', n: 3, label: 'Tenant replaced by a different tenant', inputs: ['effective', 'tenantsRemoved', 'tenantsAdded', 'newRent?'], doc: 'Assignment / substitution addendum' },
  { key: 'RENEGOTIATE', n: 4, label: 'Lease terms renegotiated', inputs: ['effective', 'newRent?', 'newStart?', 'newEnd?', 'provisions?'], doc: 'Amendment' },
  { key: 'RELEASE_ONE', n: 5, label: 'One tenant released; terms change for the rest', inputs: ['effective', 'tenantsRemoved', 'newRent?'], doc: 'Release and amendment' },
  { key: 'RELEASE_ALL', n: 6, label: 'Entire group released', inputs: ['effective', 'fee?'], doc: 'Termination agreement' },
  { key: 'ADD_TENANTS', n: 7, label: 'Tenants added, with provisions that change the terms', inputs: ['effective', 'tenantsAdded', 'newRent?', 'provisions?'], doc: 'Addendum built from the provisions library' },
  { key: 'ADJUST', n: 8, label: 'Mid-term adjustment, keeping history', inputs: ['effective', 'newRent?', 'provisions?'], doc: 'Amendment' },
  { key: 'ADD_AFTER_SENT', n: 9, label: 'Tenant added after the lease was sent', inputs: ['tenantsAdded', 'newRent?'], doc: 'Addendum' },
]);
export const scenarioByKey = (k) => CHANGE_SCENARIOS.find((s) => s.key === k) || null;

/** Which amendment statuses may be applied. Signed always; Approved only when the deployment allows applying on approval. */
export function canApply(statusKey, { applyOnApproval = false } = {}) { return statusKey === 'SIGNED' || (applyOnApproval && statusKey === 'APPROVED'); }
