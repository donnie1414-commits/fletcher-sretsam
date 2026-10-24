/** §6.6 — issue groups sorted by severity, scoped to the user's markets. */
import { EXCEPTION_CODES, EXCEPTION_ORDER } from '../../shared/constants.js';
export function routeExceptions(ctx) {
  const r = ctx.run();
  const inv = r.inventory;
  const nameOf = (m, id) => (m.get(String(id)) || {}).name || null;
  const rows = r.exceptions.filter((e) => ctx.inScope((inv.propertiesById.get(String(e.propertyId)) || {}).marketId)).map((e) => ({ ...e, property: nameOf(inv.propertiesById, e.propertyId), unit: nameOf(inv.unitsById, e.unitId), bedroom: nameOf(inv.bedroomsById, e.bedroomId), market: (inv.propertiesById.get(String(e.propertyId)) || {}).marketId, meaning: EXCEPTION_CODES[e.code].meaning, action: EXCEPTION_CODES[e.code].action }));
  const groups = EXCEPTION_ORDER.map((code) => ({ code, ...EXCEPTION_CODES[code], rows: rows.filter((x) => x.code === code) })).filter((g) => g.rows.length);
  const doubles = r.tenantDoubles.filter((d) => d.leases.some((l) => ctx.inScope((inv.propertiesById.get(String(l.propertyId)) || {}).marketId))).map((d) => ({ ...d, leases: d.leases.map((l) => ({ ...l, property: nameOf(inv.propertiesById, l.propertyId), unit: nameOf(inv.unitsById, l.unitId), market: (inv.propertiesById.get(String(l.propertyId)) || {}).marketId })) }));
  return { ay: ctx.selectedAy(), basis: ctx.basis(), count: rows.filter((x) => x.excludes || x.code === 'TENANT_DOUBLE').length, total: rows.length, groups, tenantDoubles: doubles, overlapRule: ctx.flags.requireOverlapForCollision };
}
