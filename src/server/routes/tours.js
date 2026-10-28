/**
 * §5.6 Tours — NetSuite Events read back for the app. GET ?route=tours&view=mine|market|all&from=&to=&customer=&unit=&ay=
 * A tour row carries the lead/tenant (company), the unit → property → market (when the unit field exists), the organiser
 * (the agent whose calendar it is on) and the outcome. Scope: a tour is visible when its unit's market is in scope, or it
 * has no unit and the viewer organised it (a lead with no property yet), or the viewer is unscoped.
 */
import { TOUR, TOUR_OUTCOMES, CALENDAR_URL } from '../../shared/constants.js';
import { toISO, addDays } from '../../shared/rules/dates.js';
import { hhmm } from '../dao/tours.js';

export function outcomeKeyFor(lists) {
  const byId = {}; for (const v of lists[TOUR.OUTCOME_LIST] || []) { const k = TOUR_OUTCOMES.find((o) => o.label.toLowerCase() === String(v.name).trim().toLowerCase()); if (k) byId[String(v.id)] = k.key; }
  return byId;
}
export function outcomeIdFor(lists, key) { for (const [id, k] of Object.entries(outcomeKeyFor(lists))) if (k === key) return Number(id); return null; }
/** Normalise raw calendarevent rows into app rows, resolving unit/property/market from the inventory. */
export function tourRows(ctx, raw) {
  const inv = ctx.load().prepared.inventory;
  const outcomes = outcomeKeyFor(ctx.dao.portfolio.lists());
  const ays = ctx.ays();
  return raw.map((t) => {
    const resolve = (id) => { let u = inv.unitsById.get(String(id)) || null, b = null; if (!u) { b = inv.bedroomsById.get(String(id)) || null; if (b) u = inv.unitsById.get(b.unitId) || null; } return { unit: u, bedroom: b }; };
    const list = (v) => (v == null || v === '' ? [] : String(v).split(/[,\s]+/).filter(Boolean));
    const tag = TOUR.UNITS_TAG.exec(String(t.message || ''));
    const tagged = tag ? tag[1].split(',').filter(Boolean) : [];
    const fieldUnits = list(t.unit);
    const firstId = fieldUnits[0] || tagged[0] || null;
    const { unit, bedroom } = firstId ? resolve(firstId) : { unit: null, bedroom: null };
    const prop = unit ? inv.propertiesById.get(unit.propertyId) : null;
    const units = [...new Set([...fieldUnits, ...tagged])].map((id) => { const r = resolve(id); if (!r.unit) return null; const p = inv.propertiesById.get(r.unit.propertyId); return { id, unitId: r.unit.id, name: r.bedroom ? `${r.unit.name} · ${r.bedroom.name}` : r.unit.name, propertyId: r.unit.propertyId, property: p ? p.name : null, market: p ? p.marketId : null }; }).filter(Boolean);
    const notes = String(t.message || '').replace(TOUR.UNITS_TAG, '').trim();
    const start = hhmm(t.starttime), end = hhmm(t.endtime);
    const ayList = list(t.ay).map((id) => ays.find((a) => a.id === id)).filter(Boolean);
    const ay = ayList[0] || null;
    return {
      id: String(t.id), title: t.title || '', date: toISO(t.startdate), start, end, allDay: !start,
      organizerId: t.organizer != null ? String(t.organizer) : null, organizer: t.organizer_name || null, status: t.status || null, location: t.location || null, notes: notes || null, units,
      customerId: t.company != null ? String(t.company) : null, customer: t.company_name || null,
      unitId: unit ? unit.id : null, unit: unit ? unit.name : null, bedroom: bedroom ? bedroom.name : null, propertyId: prop ? prop.id : null, property: prop ? prop.name : null, market: prop ? prop.marketId : null,
      outcome: t.outcome != null ? (outcomes[String(t.outcome)] || null) : (t.status === TOUR.STATUS.CANCELLED ? 'CANCELLED' : null), ayId: ay ? ay.id : null, ay: ay ? ay.year : null, ayIds: ayList.map((a) => a.id), ays: ayList.map((a) => a.year),
      version: String(t.lastmodifieddate || ''),
    };
  });
}
export function visibleTour(ctx, row) {
  if (ctx.scope.all) return true;
  if (row.market) return ctx.inScope(row.market);
  return String(row.organizerId) === String(ctx.scope.userId) || !row.customerId;
}
export function routeTours(ctx) {
  const q = ctx.params;
  const view = q.view || 'market';
  const from = q.from ? toISO(q.from) : ctx.today;
  const to = q.to ? toISO(q.to) : addDays(from, 30);
  const filters = { from, to };
  if (view === 'mine') filters.organizerId = ctx.scope.userId;
  if (q.customer) filters.customerIds = String(q.customer).split(',').filter(Boolean);
  const unitIds = q.unit ? String(q.unit).split(',').filter(Boolean) : null, ayId = q.ayId ? String(q.ayId) : null;
  const rows = tourRows(ctx, ctx.dao.tours.list(filters)).filter((r) => visibleTour(ctx, r) && (!unitIds || r.units.some((u) => unitIds.includes(u.unitId) || unitIds.includes(u.id))) && (!ayId || !r.ayIds.length || r.ayIds.includes(ayId)));
  const have = ctx.dao.tours.fields();
  return {
    rows, from, to, view, me: String(ctx.scope.userId), calendarUrl: CALENDAR_URL,
    available: !ctx.dao.tours.unavailable, reason: ctx.dao.tours.unavailable || null,
    fields: have, outcomes: TOUR_OUTCOMES.map((o) => ({ key: o.key, label: o.label, id: outcomeIdFor(ctx.dao.portfolio.lists(), o.key) })),
    degraded: ctx.schema.degraded,
  };
}
