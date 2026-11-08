/**
 * ?route=leasechange — the hub's "Change lease" (docs/LEASE-CHANGES-BUILD.md).
 *   GET  &lease=ID                         → the lease, its state and path, the nine change types, tenants, amendments, setup readiness
 *   POST { action: 'plan',   leaseId, conditions[] (or scenario), input, otherLeaseId?, targetUnitId?|targetPropertyId? }  → preview, nothing written
 *   POST { action: 'submit', changeId, …same }                                                          → change now, or file an amendment
 *   POST { action: 'apply',  amendmentId }                                                               → apply a Signed amendment
 * Every lease involved must be in the user's markets; writes go through the allowlisted write module.
 */
import { CHANGE_SCENARIOS, leaseState, pathFor } from '../../shared/rules/leaseChange.js';
import { leaseScopeRow } from './leaseDialog.js';

export function routeLeaseChange(ctx, body) {
  const lc = ctx.leaseChange;
  const inv = ctx.load().prepared.inventory;
  const marketOfLease = (l) => { if (!l) return null; const pid = l.propertyId || (l.unitId && ((inv.unitsById.get(l.unitId) || {}).propertyId || (inv.unitsById.get((inv.bedroomsById.get(l.unitId) || {}).unitId) || {}).propertyId)); return ctx.marketOfProperty(pid); };
  const guard = (l) => (l && ctx.inScope(marketOfLease(l)) ? null : { error: 'outside your markets', meta: { status: 403 } });

  if (!body) {
    const lease = lc.loadLease(ctx.params.lease);
    if (!lease) return { error: `lease ${ctx.params.lease} not found`, meta: { status: 404 } };
    const g = guard(lease); if (g) return g;
    const state = leaseState(lease);
    const names = lease.tenantIds.length ? ctx.dao.people.byIds(lease.tenantIds).map((c) => ({ id: String(c.id), name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.companyname || `#${c.id}`, email: c.email || null })) : [];
    const p = inv.propertiesById.get(String(lease.propertyId)) || null;
    // Other leases at the same property and the properties in scope feed the "moving to" pickers.
    const siblings = ctx.load().prepared.leases.filter((l) => !l.inactive && String(l.id) !== String(lease.id) && ctx.inScope(marketOfLease(l))).map((l) => ({ ...leaseScopeRow(inv, l), propertyId: l.propertyId || ((inv.unitsById.get(l.unitId) || {}).propertyId) || null, propertyName: (inv.propertiesById.get(String(l.propertyId)) || {}).name || null, state: leaseState(l) })).slice(0, 4000);
    return {
      lease: { ...leaseScopeRow(inv, { ...lease, lastModified: lease.lastModified }), propertyId: lease.propertyId, propertyName: p ? p.name : null, tenants: names, total: lease.totalRent, sent: lease.sentDate, signed: lease.signedDate, endReason: lease.endReason, supersedes: lease.supersedes, version: lease.version },
      state, path: pathFor(state), scenarios: CHANGE_SCENARIOS,
      amendments: lc.list(lease.id), ready: { amendments: lc.amendReady(), lists: readiness(lc) }, applyOnApproval: !!lc.applyOnApproval,
      siblings, properties: ctx.propertyIdsInScope().map((id) => { const x = inv.propertiesById.get(id); return { id, name: x.name, units: x.units.map((u) => ({ id: u, name: (inv.unitsById.get(u) || {}).name })) }; }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  const action = String(body.action || '');
  if (action === 'apply') {
    const lease = body.leaseId ? lc.loadLease(body.leaseId) : null; if (lease) { const g = guard(lease); if (g) return g; }
    return lc.apply(ctx.scope, body.amendmentId);
  }
  if (action !== 'plan' && action !== 'submit') return { error: `unknown action ${action}`, meta: { status: 400 } };
  const lease = lc.loadLease(body.leaseId); if (!lease) return { error: `lease ${body.leaseId} not found`, meta: { status: 404 } };
  const g = guard(lease); if (g) return g;
  const other = body.otherLeaseId ? lc.loadLease(body.otherLeaseId) : null;
  if (other) { const g2 = guard(other); if (g2) return g2; }
  const target = resolveTarget(ctx, inv, body);
  if (target && !ctx.inScope(ctx.marketOfProperty(target.propertyId))) return { error: 'the target house is outside your markets', meta: { status: 403 } };
  if (action === 'submit' && !body.changeId) return { error: 'changeId is required', meta: { status: 400 } };
  return lc.submit(ctx.scope, { changeId: body.changeId, leaseId: lease.id, scenario: body.scenario, conditions: body.conditions || null, input: body.input || {}, otherLeaseId: other ? other.id : null, target, dryRun: action === 'plan' }, { lease, other });
}
/** Scenario 1's destination: a unit (or bedroom) id, or a whole property. */
function resolveTarget(ctx, inv, body) {
  if (body.targetUnitId) {
    const id = String(body.targetUnitId);
    const u = inv.unitsById.get(id); if (u) return { propertyId: String(u.propertyId), unitId: id, name: u.name, typeKey: 'UNIT' };
    const b = inv.bedroomsById.get(id); if (b) { const pu = inv.unitsById.get(b.unitId); return { propertyId: String(pu.propertyId), unitId: id, name: b.name, typeKey: 'BED' }; }
  }
  if (body.targetPropertyId) { const p = inv.propertiesById.get(String(body.targetPropertyId)); if (p) return { propertyId: String(p.id), unitId: null, name: p.name, typeKey: 'WH' }; }
  return null;
}
function readiness(lc) { const I = lc.ids(); return { amendTypes: !!I.type, amendStatuses: !!I.status, endReasons: !!I.endReason, groupAmendment: !!(I.group && I.group.AMENDMENT), releasedStatus: !!I.released }; }
