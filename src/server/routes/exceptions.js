/** §6.6 — issue groups sorted by severity, scoped to the user's markets, plus the v2 advisory lists (lease dates, tenant records, property/unit records) and the blocking-exclusions card. */
import { EXCEPTION_CODES, EXCEPTION_ORDER } from '../../shared/constants.js';
import { blockingByReason } from '../../shared/rules/summary.js';
import { recordQuality, leaseQuality, tenantQuality } from '../../shared/rules/quality.js';
import { ayEndDate } from '../../shared/rules/dates.js';
export function routeExceptions(ctx, _body, { full = true } = {}) {
  const r = ctx.run();
  const inv = r.inventory;
  const sel = ctx.selection(), keep = ctx.keep(sel);
  const nameOf = (m, id) => (m.get(String(id)) || {}).name || null;
  const propIn = (id) => { const p = inv.propertiesById.get(String(id)); return p ? keep(p) : ctx.scope.all; };
  const rows = r.exceptions.filter((e) => propIn(e.propertyId)).map((e) => ({ ...e, property: nameOf(inv.propertiesById, e.propertyId), unit: nameOf(inv.unitsById, e.unitId), bedroom: nameOf(inv.bedroomsById, e.bedroomId), market: (inv.propertiesById.get(String(e.propertyId)) || {}).marketId, meaning: EXCEPTION_CODES[e.code].meaning, action: EXCEPTION_CODES[e.code].action }));
  const groups = EXCEPTION_ORDER.map((code) => ({ code, ...EXCEPTION_CODES[code], rows: rows.filter((x) => x.code === code) })).filter((g) => g.rows.length);
  const doubles = r.tenantDoubles.filter((d) => d.leases.some((l) => propIn(l.propertyId))).map((d) => ({ ...d, leases: d.leases.map((l) => ({ ...l, property: nameOf(inv.propertiesById, l.propertyId), unit: nameOf(inv.unitsById, l.unitId), market: (inv.propertiesById.get(String(l.propertyId)) || {}).marketId })) }));
  const out = { ay: ctx.selectedAy(), basis: ctx.basis(), selection: sel, count: rows.filter((x) => x.excludes || x.code === 'TENANT_DOUBLE').length, total: rows.length, groups, tenantDoubles: doubles, overlapRule: ctx.flags.requireOverlapForCollision };
  if (!full) return out;
  const { blocking, blockingTotal } = blockingByReason(r, { keep });
  const records = recordQuality(r, { keep });
  const leases = leaseQuality(r, { keep, today: ctx.today, ayEnd: ayEndDate(ctx.selectedAy()) });
  // tenant records for the counted leases in scope, fetched by id (names, email, active flag)
  const tenantIds = new Set();
  for (const x of r.placement.leaseResults.values()) { if (x.year.carried || x.status === 'skipped' || x.lease.statusKey === 'NONE') continue; const p = inv.propertiesById.get(x.scope.propertyId || x.lease.propertyId); if (p && keep(p)) for (const t of x.lease.tenantIds) tenantIds.add(t); }
  const customersById = new Map();
  if (tenantIds.size) for (const c of ctx.dao.people.byIds([...tenantIds])) customersById.set(String(c.id), { id: String(c.id), name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.entityid, email: c.email || null, isinactive: c.isinactive });
  const tenants = tenantQuality(r, { keep, customersById });
  return { ...out, blocking: blocking.map((g) => ({ ...g, label: EXCEPTION_CODES[g.code].label, meaning: EXCEPTION_CODES[g.code].meaning, fix: EXCEPTION_CODES[g.code].action })), blockingTotal, records, leaseQuality: leases, tenantQuality: tenants, advisoryCount: records.length + leases.length + tenants.length };
}
