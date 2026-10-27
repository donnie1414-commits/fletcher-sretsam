/** §6.5 — Tenants and Leads: two segments of the same customer rows (LEAD-DISCOVERY §5). */
import { CUSTOMER, LEAD, LEAD_STATUS_LABELS, CALENDAR_URL } from '../../shared/constants.js';
import { toISO, addDays } from '../../shared/rules/dates.js';
import { tourRows, visibleTour } from './tours.js';
import { applyLeadView } from '../../shared/rules/views.js';

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
      properties: propIds.map((p) => ({ id: p, name: (inv.propertiesById.get(p) || {}).name || p, market: (inv.propertiesById.get(p) || {}).marketId || null })), academicYears: ayIds.map((a) => ({ id: a, label: (ctx.ays().find((x) => x.id === a) || {}).label || a })),
      leases: leasesByCust.get(String(t.id)) || [], ready: readyToAttach(t, leaseCtx), created: toISO(t.datecreated), version: String(t.lastmodifieddate || ''),
      desiredLocation: t.desired_location, school: t.school, duplicate: t.duplicate === 'T' || (t.email && dupEmails.has(String(t.email).toLowerCase())),
    };
  });
  return { total: result.total, page: result.page, pageSize: result.pageSize, rows, statuses: ctx.dao.people.statusList().filter((s) => s.entitytype === 'CUSTOMER'), degraded: ctx.schema.degraded };
}
/**
 * The lead set: LEAD-stage records (New, In Contact, Tour Scheduled, Tour Completed, Received Lease Form, Spam, Dead Lead)
 * plus current tenants at Tenant-Inquiring, in scope, not yet on a lease for the selected year. Loaded whole because the
 * views and the tour join need the full set; paged in JS.
 */
export function loadLeads(ctx) {
  const inv = ctx.load().prepared.inventory;
  const lists = ctx.dao.portfolio.lists();
  const sourceName = new Map((lists.customlist_serp_hear_us_list || []).map((v) => [String(v.id), v.name]));
  const schoolName = new Map((lists.customlist_serp_schools || []).map((v) => [String(v.id), v.name]));
  const filters = { leadSet: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() };
  const page = ctx.dao.people.tenants({ filters, sort: 'created', page: 0, pageSize: 2000 });
  const custIds = page.rows.map((r) => r.id);
  const onLease = new Set(custIds.length ? ctx.dao.people.leaseLinks(custIds).map((l) => String(l.customer)) : []);
  const candidates = page.rows.filter((t) => !onLease.has(String(t.id)));
  const dupEmails = new Set(ctx.dao.people.duplicates().map((d) => d.email));
  const tours = candidates.length ? tourRows(ctx, ctx.dao.tours.list({ customerIds: candidates.map((t) => t.id), from: addDays(ctx.today, -365) })).filter((r) => visibleTour(ctx, r)) : [];
  const toursByCust = new Map(); for (const t of tours) { if (!t.customerId) continue; if (!toursByCust.has(t.customerId)) toursByCust.set(t.customerId, []); toursByCust.get(t.customerId).push(t); }
  const newSince = addDays(ctx.today, -LEAD.NEW_DAYS);
  return candidates.map((t) => {
    const propIds = ids(t.property), ayIds = ids(t.ay), unitIds = ids(t.units);
    const mine = (toursByCust.get(String(t.id)) || []).filter((x) => x.outcome !== 'CANCELLED');
    const unitsOfInterest = unitIds.map((u) => { const unit = inv.unitsById.get(u); const bed = !unit ? inv.bedroomsById.get(u) : null; const parent = bed ? inv.unitsById.get(bed.unitId) : unit; return parent ? { id: u, name: bed ? `${parent.name} · ${bed.name}` : parent.name, unitId: parent.id, propertyId: parent.propertyId, property: (inv.propertiesById.get(parent.propertyId) || {}).name || null } : { id: u, name: `#${u}`, unitId: null, propertyId: null, property: null }; });
    const upcoming = mine.filter((x) => x.date >= ctx.today).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const past = mine.filter((x) => x.date < ctx.today).sort((a, b) => (b.date + (b.start || '')).localeCompare(a.date + (a.start || '')));
    const created = toISO(t.datecreated);
    return {
      id: String(t.id), name: [t.firstname, t.lastname].filter(Boolean).join(' ') || t.entityid, firstName: t.firstname || '', lastName: t.lastname || '', email: t.email, phone: t.phone || t.mobilephone,
      status: LEAD_STATUS_LABELS[Number(t.entitystatus)] || t.status_name, statusId: Number(t.entitystatus), stage: t.stage, created, isNew: !!created && created >= newSince && Number(t.entitystatus) === LEAD.STATUS_NEW,
      unitsOfInterest,
      school: t.school != null ? (schoolName.get(String(t.school)) || String(t.school)) : null, schoolId: t.school != null ? String(t.school) : null,
      desiredLocation: t.desired_location || null, groupSize: t.group_size != null ? Number(t.group_size) : null, houseMates: t.house_mates || null, notes: t.notes || null,
      source: t.hear_us != null ? (sourceName.get(String(t.hear_us)) || null) : null, sourceId: t.hear_us != null ? String(t.hear_us) : null,
      agentId: t.agent != null ? String(t.agent) : null, agent: t.agent_name || null,
      properties: propIds.map((p) => ({ id: p, name: (inv.propertiesById.get(p) || {}).name || p, market: (inv.propertiesById.get(p) || {}).marketId || null })),
      academicYears: ayIds.map((a) => ({ id: a, label: (ctx.ays().find((x) => x.id === a) || {}).label || a })),
      duplicate: t.duplicate === 'T' || (t.email && dupEmails.has(String(t.email).toLowerCase())),
      nextTour: upcoming[0] || null, lastTour: past[0] || null, tourCount: mine.length, version: String(t.lastmodifieddate || ''),
    };
  });
}
export function routeLeads(ctx) {
  const q = ctx.params;
  return { ...applyLeadView(loadLeads(ctx), q), toursAvailable: !ctx.dao.tours.unavailable, calendarUrl: CALENDAR_URL, me: String(ctx.scope.userId), degraded: ctx.schema.degraded };
}
