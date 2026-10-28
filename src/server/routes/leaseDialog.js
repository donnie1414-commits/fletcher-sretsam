/** §6.4 — everything the lease dialog needs for one unit and AY, in one call. Prefill rules live in shared/rules/leaseDialog.js. */
import { MARKETS } from '../../shared/constants.js';
export function routeLeaseDialog(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis();
  const unitId = String(ctx.params.unit || '');
  const r = ctx.run(ay, basis);
  const inv = r.inventory;
  const u = inv.unitsById.get(unitId);
  if (!u) return { error: `unit ${unitId} not found`, meta: { status: 404 } };
  const p = inv.propertiesById.get(u.propertyId);
  if (!p || !ctx.inScope(p.marketId)) return { error: 'outside your markets', meta: { status: 403 } };
  const targetFor = (unit) => { const t = r.targets.find((x) => x.ay === ay && x.unitId === unit.id); return t ? (t.targetMonthly ?? (t.targetPerBed != null ? t.targetPerBed * unit.beds : null)) : null; };
  const leafFree = (leaf) => !(r.placement.leafResults.get(leaf.key) || { occupied: 0 }).occupied;
  const prior = ctx.run(ay - 1, basis);
  const priorLeaseIds = [...new Set(u.leaves.flatMap((l) => (prior.placement.leafResults.get(l.key) || { placements: [] }).placements.map((pl) => pl.leaseId)))];
  const priorTenantIds = [...new Set(priorLeaseIds.flatMap((id) => (prior.placement.leaseResults.get(id) || { lease: { tenantIds: [] } }).lease.tenantIds))];
  const names = priorTenantIds.length ? ctx.dao.people.byIds(priorTenantIds).map((c) => [c.firstname, c.lastname].filter(Boolean).join(' ')).filter(Boolean) : [];
  const market = MARKETS.find((m) => m.id === p.marketId) || null;
  const lookups = ctx.load().lookups;
  // Every active lease touching this property, any year, so the dialog can keep new dates clear of them (and offer to end or archive).
  const existing = ctx.load().prepared.leases.filter((l) => !l.inactive && (l.propertyId === p.id || (l.unitId && (inv.unitsById.get(l.unitId) || {}).propertyId === p.id) || (l.unitId && inv.bedroomsById.get(l.unitId) && (inv.unitsById.get(inv.bedroomsById.get(l.unitId).unitId) || {}).propertyId === p.id)))
    .map((l) => leaseScopeRow(inv, l)).filter((l) => l.level === 'property' || l.unitId === u.id).sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  return {
    existing,
    ay, ayId: ctx.ayIdFor(ay), ayNextId: ctx.ayIdFor(ay + 1), basis,
    property: { id: p.id, name: p.name, marketId: p.marketId, calendar: market ? market.calendar : null, units: p.units.map((id) => { const x = inv.unitsById.get(id); return { id: x.id, name: x.name, beds: x.beds, targetMonthly: targetFor(x) }; }) },
    unit: { id: u.id, name: u.name, beds: u.beds, targetMonthly: targetFor(u), bedrooms: u.bedrooms.map((b) => ({ id: b.id, name: b.name, beds: b.beds, free: leafFree(b) })) },
    priorTenantNames: names,
    ids: { leaseType: invert(lookups.leaseTypeIds), groupType: groupTypeIds(ctx) },
  };
}
function invert(m) { const o = {}; for (const [id, key] of Object.entries(m || {})) o[key] = id; return o; }
function groupTypeIds(ctx) { const list = (ctx.dao.portfolio.lists().customlist_lease_group_type || []); const o = {}; for (const v of list) { const n = String(v.name).toLowerCase(); o[n.startsWith('new') ? 'NEW' : n.startsWith('transfer') ? 'TRANSFER' : n.startsWith('renew') ? 'RENEWAL' : n] = String(v.id); } return o; }

/** A normalized lease as the dialog sees it: where it sits (property / unit / bedroom) plus dates, status and version. */
export function leaseScopeRow(inv, l) {
  let level = 'property', unitId = null, bedroomId = null, unitName = null, bedroomName = null;
  if (l.unitId && inv.unitsById.has(l.unitId)) { level = 'unit'; unitId = l.unitId; unitName = inv.unitsById.get(l.unitId).name; }
  else if (l.unitId && inv.bedroomsById.has(l.unitId)) { const b = inv.bedroomsById.get(l.unitId); level = 'bedroom'; unitId = b.unitId; bedroomId = l.unitId; unitName = (inv.unitsById.get(b.unitId) || {}).name || null; bedroomName = b.name; }
  return { id: l.id, name: l.name, start: l.start, end: l.end, statusKey: l.statusKey, typeKey: l.typeKey, level, unitId, bedroomId, unitName, bedroomName, inactive: !!l.inactive, version: l.lastModified || null, monthly: l.monthlyRent };
}
