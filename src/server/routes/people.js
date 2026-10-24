/** §6.5 — Tenants segment (unblocked); Leads segment waits for the §5.5.0 review. */
import { CUSTOMER } from '../../shared/constants.js';
import { toISO } from '../../shared/rules/dates.js';

function ids(v) { return v == null || v === '' ? [] : String(v).split(/[,\s]+/).filter(Boolean); }
export function readyToAttach(t, { leaseProperty = null, leaseAy = null } = {}) {
  const props = ids(t.property), ays = ids(t.ay);
  const reasons = [];
  if (!props.length) reasons.push('no property set');
  if (!ays.length) reasons.push('no academic year set');
  if (leaseProperty && props.length && !props.includes(String(leaseProperty))) reasons.push(`property does not include the lease's property`);
  if (leaseAy && ays.length && !ays.includes(String(leaseAy))) reasons.push(`academic year does not include the lease's year`);
  return { ready: reasons.length === 0, reasons };
}
export function routeTenants(ctx) {
  const q = ctx.params;
  const inv = ctx.load().prepared.inventory;
  const filters = {
    q: q.q || null, stage: 'CUSTOMER',
    statusIds: ids(q.status), propertyIds: ids(q.property), ayIds: ids(q.ayId),
    missingProperty: q.view === 'needs-attention' || q.missingProperty === '1', missingAy: q.missingAy === '1',
    scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope(),
  };
  if (q.view === 'needs-attention') { filters.missingProperty = false; filters.missingAy = false; filters.needsAttention = true; }
  // "needs attention" = missing property OR missing AY: two queries are cheaper than an OR across two NOT EXISTS; do it as a union in JS when small
  const pageSize = Math.min(500, Math.max(25, Number(q.pageSize) || 100)), page = Math.max(0, Number(q.page) || 0);
  let result;
  if (filters.needsAttention) {
    const a = ctx.dao.people.tenants({ filters: { ...filters, missingProperty: true }, sort: q.sort, page: 0, pageSize: 1000 });
    const b = ctx.dao.people.tenants({ filters: { ...filters, missingAy: true }, sort: q.sort, page: 0, pageSize: 1000 });
    const seen = new Set(); const rows = []; for (const r of a.rows.concat(b.rows)) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
    result = { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length, page, pageSize };
  } else result = ctx.dao.people.tenants({ filters, sort: q.sort, page, pageSize });
  const custIds = result.rows.map((r) => r.id);
  const leaseLinks = custIds.length ? ctx.dao.people.leaseLinks(custIds) : [];
  const leasesByCust = new Map(); for (const l of leaseLinks) { if (!leasesByCust.has(String(l.customer))) leasesByCust.set(String(l.customer), []); leasesByCust.get(String(l.customer)).push(String(l.lease)); }
  const dupEmails = new Set(ctx.dao.people.duplicates().map((d) => d.email));
  const leaseCtx = { leaseProperty: q.leaseProperty || null, leaseAy: q.leaseAy || null };
  const rows = result.rows.map((t) => {
    const propIds = ids(t.property), ayIds = ids(t.ay);
    return {
      id: String(t.id), name: [t.firstname, t.lastname].filter(Boolean).join(' ') || t.entityid, email: t.email, phone: t.phone || t.mobilephone, status: t.status_name, statusId: t.entitystatus,
      properties: propIds.map((p) => ({ id: p, name: (inv.propertiesById.get(p) || {}).name || p })), academicYears: ayIds.map((a) => ({ id: a, label: (ctx.ays().find((x) => x.id === a) || {}).label || a })),
      leases: leasesByCust.get(String(t.id)) || [], ready: readyToAttach(t, leaseCtx), created: toISO(t.datecreated), version: String(t.lastmodifieddate || ''),
      desiredLocation: t.desired_location, school: t.school, duplicate: t.duplicate === 'T' || (t.email && dupEmails.has(String(t.email).toLowerCase())),
    };
  });
  return { total: result.total, page: result.page, pageSize: result.pageSize, rows, statuses: ctx.dao.people.statusList().filter((s) => s.entitytype === 'CUSTOMER'), degraded: ctx.schema.degraded };
}
export function routeLeads(ctx) {
  return { error: 'Leads workspace is not designed yet: the §5.5.0 lead discovery write-up (docs/LEAD-DISCOVERY.md) is awaiting review.', status: 501, meta: { status: 501 } };
}
