/**
 * Lease changes after a lease is drafted (docs/LEASE-CHANGES-BUILD.md). One "Change lease" request, four mechanisms,
 * one rule: the lease's state decides the path.
 *
 *   DRAFT    (no status, never sent)   → EDIT     change the lease in place, nothing else
 *   SENT     (In Process / sent date)  → REVISE   change in place, stage → Lease Revisions, void + resend the documents,
 *                                                  logged as an amendment row (no approval)
 *   EXECUTED (Fully Executed)          → AMEND    an amendment row awaiting approval and a signed addendum; applied later
 *                                                  by SUPERSEDE, TERMINATE, TRANSFER or ASSIGN — the signed record is never
 *                                                  overwritten for parties or money
 *
 * Pure: no NetSuite. planChange() returns the amendment fields and an ordered list of steps; the server executor
 * (src/server/leaseChange.js) turns steps into allowlisted writes, in the Suitelet or the Workflow Action Script alike.
 *
 * Dates are ISO 'YYYY-MM-DD'. The EFFECTIVE date is the first day the new arrangement applies; whatever ends, ends the
 * day before it.
 */
import { addDays, compare, monthsBetweenFraction, monthsBetweenCeil } from './dates.js';

export { CHANGE_STATES, CHANGE_PATHS, MECHANISMS, AMEND_TYPES, AMEND_STATUSES, END_REASONS, keyFromLabel, CHANGE_SCENARIOS, scenarioByKey, canApply } from './leaseChangeMeta.js';
import { CHANGE_STATES, CHANGE_PATHS, MECHANISMS, scenarioByKey } from './leaseChangeMeta.js';

/** Where a lease stands. `lease` is a normalized lease (shared/rules/lease.js). */
export function leaseState(lease) {
  if (!lease || lease.inactive) return CHANGE_STATES.CLOSED;
  if (lease.statusKey === 'EXECUTED') return CHANGE_STATES.EXECUTED;
  if (lease.statusKey === 'IN_PROCESS' || lease.sentDate) return CHANGE_STATES.SENT;
  return CHANGE_STATES.DRAFT;
}
export function pathFor(state) { return state === CHANGE_STATES.EXECUTED ? CHANGE_PATHS.AMEND : state === CHANGE_STATES.SENT ? CHANGE_PATHS.REVISE : state === CHANGE_STATES.DRAFT ? CHANGE_PATHS.EDIT : null; }

const ids = (a) => [...new Set((a || []).map(String).filter(Boolean))];
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
/** Monthly × the period's months to the cent (partial months pro rata by days of that month — rent-schedule decision 2). */
export function totalFor(monthly, start, end) { const f = monthsBetweenFraction(start, end); return monthly == null || f == null || f <= 0 ? null : Math.round(monthly * f * 100) / 100; }

/**
 * planChange({ scenario, lease, input, other, target, today }) → plan
 *   lease   normalized lease being changed
 *   input   { effective, newRent, otherNewRent, newStart, newEnd, provisions, fee, reason, tenantsAdded[], tenantsRemoved[] }
 *   other   normalized second lease (scenario 2), or null
 *   target  { propertyId, unitId|null, ayId, name, typeKey } for a move (scenario 1), resolved by the caller
 *
 * plan = { ok, errors[], warnings[], state, path, mechanism, needsApproval, amendment{…}, steps[…] }
 * Step ops: updateLease · createLease · tenantScope · tenantStatus · stage · manual. Fields are LOGICAL keys
 * (start, end, monthly, total, months, tenants, tenantCount, provisions, endReason, supersedes, version, inactive,
 * groupType, statusFrom, unit, property, ay, typeKey, name); the executor maps them to NetSuite ids.
 */
export function planChange({ scenario, lease, input = {}, other = null, target = null }) {
  const sc = scenarioByKey(scenario);
  const errors = [], warnings = [];
  const state = leaseState(lease);
  const path = pathFor(state);
  const out = (extra) => ({ ok: errors.length === 0, errors, warnings, state, path, scenario: sc ? sc.key : scenario, scenarioLabel: sc ? sc.label : null, ...extra });
  if (!sc) { errors.push(`unknown change type ${scenario}`); return out({ mechanism: null, steps: [], amendment: null, needsApproval: false }); }
  if (state === CHANGE_STATES.CLOSED) { errors.push('this lease is inactive; nothing can be changed on it'); return out({ mechanism: null, steps: [], amendment: null, needsApproval: false }); }

  const added = ids(input.tenantsAdded), removed = ids(input.tenantsRemoved);
  const current = ids(lease.tenantIds);
  const newRent = num(input.newRent);
  const rentChanges = newRent != null && newRent !== num(lease.monthlyRent);
  const datesChange = (input.newStart && input.newStart !== lease.start) || (input.newEnd && input.newEnd !== lease.end);
  const termsChange = rentChanges || datesChange || !!(input.provisions && String(input.provisions).trim());
  let eff = input.effective || null;
  if (sc.key === 'ADD_AFTER_SENT' && !eff) eff = lease.start;

  // ---- input checks shared by every path
  for (const t of removed) if (!current.includes(t)) errors.push(`tenant ${t} is not on this lease`);
  for (const t of added) if (current.includes(t)) errors.push(`tenant ${t} is already on this lease`);
  if (['REPLACE_TENANT', 'RELEASE_ONE', 'MOVE_TENANT'].includes(sc.key) && !removed.length) errors.push('pick the tenant(s) leaving the lease');
  if (['REPLACE_TENANT', 'ADD_TENANTS', 'ADD_AFTER_SENT'].includes(sc.key) && !added.length) errors.push('pick the tenant(s) joining the lease');
  if (sc.key === 'RELEASE_ONE' && removed.length >= current.length) errors.push('every tenant would leave; use "Entire group released" instead');
  if (['RENEGOTIATE', 'ADJUST'].includes(sc.key) && !termsChange) errors.push('enter the new rent, dates or provisions');
  if (sc.key === 'MOVE_GROUP' && !target) errors.push('pick the house or unit the group is moving to');
  if (sc.key === 'MOVE_GROUP' && target && String(target.unitId || '') === String(lease.unitId || '') && String(target.propertyId) === String(lease.propertyId)) errors.push('the group is already on that unit');
  if (sc.key === 'MOVE_TENANT' && !other) errors.push('pick the lease the tenant is moving to');
  if (sc.key === 'MOVE_TENANT' && other && String(other.id) === String(lease.id)) errors.push('the tenant is moving to a different lease, not this one');
  if (input.newStart && input.newEnd && compare(input.newStart, input.newEnd) > 0) errors.push('the new start is after the new end');
  const needsEffective = path === CHANGE_PATHS.AMEND && sc.key !== 'ADD_AFTER_SENT';
  if (needsEffective && !eff) errors.push('enter the effective date');
  if (eff && lease.end && compare(eff, lease.end) > 0) errors.push(`the effective date ${eff} is after the lease ends (${lease.end})`);
  if (state === CHANGE_STATES.EXECUTED && sc.key === 'ADD_AFTER_SENT') warnings.push('this lease is already signed: the tenant joins by addendum');
  if (sc.key === 'ADJUST' && path !== CHANGE_PATHS.AMEND) warnings.push('the lease is not signed yet: the adjustment is made on the lease itself');

  const newTenants = ids([...current.filter((t) => !removed.includes(t)), ...added]);
  const before = { leaseId: String(lease.id), name: lease.name, start: lease.start, end: lease.end, monthly: lease.monthlyRent, total: lease.totalRent, tenants: current, unitId: lease.unitId, propertyId: lease.propertyId, status: lease.statusKey, version: lease.version ?? null };
  const amendment = {
    leaseId: String(lease.id), scenario: sc.key, effective: eff, reason: input.reason || '', tenantsAdded: added, tenantsRemoved: removed,
    oldRent: num(lease.monthlyRent), newRent: rentChanges ? newRent : null, fee: num(input.fee), provisions: input.provisions || '', before,
    otherLeaseId: other ? String(other.id) : null, targetUnitId: target ? (target.unitId || null) : null, targetPropertyId: target ? String(target.propertyId) : null,
  };
  const steps = [];
  if (errors.length) return out({ mechanism: null, steps, amendment, needsApproval: false });

  // ---------------- before signing: change the lease itself ----------------
  if (path !== CHANGE_PATHS.AMEND) {
    let mechanism = MECHANISMS.REVISE;
    if (sc.key === 'RELEASE_ALL') {
      mechanism = MECHANISMS.CANCEL;
      steps.push({ op: 'updateLease', leaseId: String(lease.id), fields: { inactive: true, endReason: 'CANCELLED' }, why: 'cancel the unsigned lease (inactivated, never deleted)' });
      steps.push({ op: 'tenantStatus', tenants: current, status: 'RELEASED', why: 'the group is released' });
    } else {
      const f = {};
      if (sc.key === 'MOVE_GROUP') { f.property = target.propertyId; f.unit = target.unitId || null; if (target.typeKey) f.typeKey = target.typeKey; steps.push({ op: 'tenantScope', tenants: newTenants, propertyId: target.propertyId, ayId: lease.ayFieldRaw ?? null, why: 'the tenants need the new property before the lease can point at it' }); }
      if (input.newStart) f.start = input.newStart; if (input.newEnd) f.end = input.newEnd;
      if (rentChanges) f.monthly = newRent;
      if (rentChanges || datesChange) f.total = totalFor(rentChanges ? newRent : num(lease.monthlyRent), f.start || lease.start, f.end || lease.end);
      if (added.length || removed.length) { if (added.length) steps.push({ op: 'tenantScope', tenants: added, propertyId: f.property || lease.propertyId, ayId: lease.ayFieldRaw ?? null, why: 'new tenants need the lease property and AY first' }); f.tenants = newTenants; f.tenantCount = newTenants.length; }
      if (input.provisions) f.provisions = appendProvision(lease.provisions, input.provisions, eff);
      steps.push({ op: 'updateLease', leaseId: String(lease.id), fields: f, why: 'revise the lease in place' });
      if (removed.length) steps.push({ op: 'tenantStatus', tenants: removed, status: 'RELEASED', why: 'released from the lease before signing' });
      if (sc.key === 'MOVE_TENANT') steps.push(...planOtherLease(other, { added: removed, newRent: num(input.otherNewRent), eff }, warnings));
      if (path === CHANGE_PATHS.REVISE) {
        steps.push({ op: 'stage', leaseId: String(lease.id), stage: 'LEASE_REVISIONS', why: 'the board shows the lease is being revised' });
        steps.push({ op: 'manual', text: 'Void the sent PandaDoc documents for this lease, then press Send Contract on the lease to send the revised version.', why: 'documents already sent carry the old terms' });
      }
    }
    return out({ mechanism, steps, amendment: { ...amendment, mechanism }, needsApproval: false });
  }

  // ---------------- signed: amend, never overwrite ----------------
  const endDay = addDays(eff, -1);
  const notStarted = lease.start && compare(eff, lease.start) <= 0;
  const nextVersion = (Number(lease.version) || 1) + 1;
  const endOld = (reason) => notStarted
    ? { op: 'updateLease', leaseId: String(lease.id), fields: { inactive: true, endReason: reason === 'RELEASED' ? 'CANCELLED' : reason }, why: 'the lease had not started: inactivated, never deleted' }
    : { op: 'updateLease', leaseId: String(lease.id), fields: { end: endDay, endReason: reason }, why: `the signed lease ends the day before ${eff}` };
  const newLease = (over) => {
    const start = notStarted ? lease.start : eff;
    const end = input.newEnd || lease.end;
    const monthly = rentChanges ? newRent : num(lease.monthlyRent);
    return { op: 'createLease', ref: 'new', from: String(lease.id), fields: { name: `${lease.name} · v${nextVersion}`, property: lease.propertyId, unit: lease.unitId || null, typeKey: lease.typeKey || null, ay: lease.ayFieldRaw ?? null, start: input.newStart && notStarted ? input.newStart : start, end, monthly, total: totalFor(monthly, input.newStart && notStarted ? input.newStart : start, end), months: monthsBetweenCeil(input.newStart && notStarted ? input.newStart : start, end), tenants: newTenants, tenantCount: newTenants.length, provisions: input.provisions ? appendProvision(lease.provisions, input.provisions, eff) : (lease.provisions || ''), statusFrom: String(lease.id), groupType: 'AMENDMENT', supersedes: String(lease.id), version: nextVersion, ...over }, why: 'the new terms run from the effective date, linked to the lease they replace' };
  };

  let mechanism;
  if (sc.key === 'RELEASE_ALL') {
    mechanism = notStarted ? MECHANISMS.CANCEL : MECHANISMS.TERMINATE;
    steps.push(endOld(notStarted ? 'CANCELLED' : 'RELEASED'));
    steps.push({ op: 'tenantStatus', tenants: current, status: 'RELEASED', why: 'the whole group is released' });
    if (amendment.fee) warnings.push(`termination fee ${amendment.fee}: accounting is notified by the approval workflow`);
  } else if (sc.key === 'MOVE_GROUP') {
    mechanism = MECHANISMS.TRANSFER;
    steps.push({ op: 'tenantScope', tenants: newTenants, propertyId: target.propertyId, ayId: lease.ayFieldRaw ?? null, why: 'the tenants need the new property before the new lease can list them' });
    steps.push(endOld('TRANSFERRED'));
    const monthly = rentChanges ? newRent : num(lease.monthlyRent);
    const start = notStarted ? lease.start : eff;
    steps.push(newLease({ name: `${target.name || 'Transfer'} · transfer from ${lease.name}`, property: target.propertyId, unit: target.unitId || null, typeKey: target.typeKey || lease.typeKey || null, monthly, total: totalFor(monthly, start, lease.end), groupType: 'TRANSFER' }));
  } else {
    // Roster-only changes on the same terms stay on the signed lease as an assignment; anything touching money or dates supersedes.
    const rosterOnly = !termsChange && ['REPLACE_TENANT', 'RELEASE_ONE', 'ADD_TENANTS', 'ADD_AFTER_SENT', 'MOVE_TENANT'].includes(sc.key);
    mechanism = rosterOnly ? MECHANISMS.ASSIGN : MECHANISMS.SUPERSEDE;
    if (added.length) steps.push({ op: 'tenantScope', tenants: added, propertyId: lease.propertyId, ayId: lease.ayFieldRaw ?? null, why: 'new tenants need the lease property and AY first' });
    if (rosterOnly) steps.push({ op: 'updateLease', leaseId: String(lease.id), fields: { tenants: newTenants, tenantCount: newTenants.length, version: nextVersion }, why: 'same terms: the roster changes on the signed lease, the amendment keeps who left and who joined' });
    else { steps.push(endOld('SUPERSEDED')); steps.push(newLease({})); }
  }
  if (removed.length && sc.key !== 'MOVE_TENANT') steps.push({ op: 'tenantStatus', tenants: removed, status: 'RELEASED', why: 'released from the lease' });
  if (sc.key === 'MOVE_TENANT') steps.push(...planOtherLease(other, { added: removed, newRent: num(input.otherNewRent), eff }, warnings));
  return out({ mechanism, steps, amendment: { ...amendment, mechanism }, needsApproval: true });
}

/** Scenario 2's second lease: the moving tenant joins it, by revision before signing or by assignment / supersede after. */
function planOtherLease(other, { added, newRent, eff }, warnings) {
  if (!other) return [];
  const st = leaseState(other);
  if (st === CHANGE_STATES.CLOSED) { warnings.push(`${other.name} is inactive; the tenant cannot join it`); return []; }
  const cur = ids(other.tenantIds); const tenants = ids([...cur, ...added]);
  const rentChanges = newRent != null && newRent !== num(other.monthlyRent);
  const steps = [{ op: 'tenantScope', tenants: added, propertyId: other.propertyId, ayId: other.ayFieldRaw ?? null, why: `the moving tenant needs ${other.name}'s property and AY` }];
  if (st !== CHANGE_STATES.EXECUTED || !rentChanges) {
    const f = { tenants, tenantCount: tenants.length };
    if (rentChanges && st !== CHANGE_STATES.EXECUTED) { f.monthly = newRent; f.total = totalFor(newRent, other.start, other.end); }
    if (st === CHANGE_STATES.EXECUTED) f.version = (Number(other.version) || 1) + 1;
    steps.push({ op: 'updateLease', leaseId: String(other.id), fields: f, why: st === CHANGE_STATES.EXECUTED ? 'same terms on the signed lease: the tenant joins by assignment' : 'the tenant joins the unsigned lease' });
    if (st === CHANGE_STATES.SENT) steps.push({ op: 'stage', leaseId: String(other.id), stage: 'LEASE_REVISIONS', why: 'the second lease is being revised too' });
    return steps;
  }
  const notStarted = other.start && compare(eff, other.start) <= 0; const v = (Number(other.version) || 1) + 1; const start = notStarted ? other.start : eff;
  steps.push(notStarted ? { op: 'updateLease', leaseId: String(other.id), fields: { inactive: true, endReason: 'SUPERSEDED' }, why: 'replaced before it started' } : { op: 'updateLease', leaseId: String(other.id), fields: { end: addDays(eff, -1), endReason: 'SUPERSEDED' }, why: `ends the day before ${eff}` });
  steps.push({ op: 'createLease', ref: 'new2', from: String(other.id), fields: { name: `${other.name} · v${v}`, property: other.propertyId, unit: other.unitId || null, typeKey: other.typeKey || null, ay: other.ayFieldRaw ?? null, start, end: other.end, monthly: newRent, total: totalFor(newRent, start, other.end), months: monthsBetweenCeil(start, other.end), tenants, tenantCount: tenants.length, provisions: other.provisions || '', statusFrom: String(other.id), groupType: 'AMENDMENT', supersedes: String(other.id), version: v }, why: 'the second lease is superseded with the tenant added' });
  return steps;
}
function appendProvision(existing, text, eff) { const line = `${eff ? `[from ${eff}] ` : ''}${String(text).trim()}`; return existing ? `${existing}\n${line}` : line; }

