/**
 * §6.4 — pure prefill rules for the lease dialog. The dialog's state machine: every field the user
 * has touched is in `touched` and is never auto-overwritten; everything else is recomputed from the
 * inputs by `prefill()` on each change. One rule, not per-field special cases.
 */
import { addYears, toISO, monthsBetweenCeil, addDays, compare } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
/** Market calendar dates for an AY: start in the AY's first calendar year, end in the next (or two years out). */
export function calendarDates(calendar, ay, twoYear = false) {
  if (!calendar) return { start: null, end: null };
  const start = `${ay}-${pad(calendar.start[0])}-${pad(calendar.start[1])}`;
  const endYear = ay + (twoYear ? 2 : 1);
  const end = `${endYear}-${pad(calendar.end[0])}-${pad(calendar.end[1])}`;
  return { start, end };
}
/** Rent per bed from AY targets: whole house = Σ unit targets ÷ Σ beds; unit or bedroom = unit target ÷ beds. null when no target. */
export function targetRentPerBed(type, { property, unit }) {
  if (type === 'WH') {
    const withTarget = property.units.filter((u) => u.targetMonthly != null && u.beds > 0);
    if (!withTarget.length) return null;
    const beds = withTarget.reduce((s, u) => s + u.beds, 0);
    return beds ? withTarget.reduce((s, u) => s + u.targetMonthly, 0) / beds : null;
  }
  if (unit.targetMonthly == null || !unit.beds) return null;
  return unit.targetMonthly / unit.beds;
}
export function termMonths(start, end) { if (!start || !end) return null; const m = monthsBetweenCeil(toISO(start), toISO(end)); return m == null || m < 0 ? null : m; }
export function bedsCovered(type, data, bedroomIds) {
  if (type === 'WH') return data.property.units.reduce((s, u) => s + u.beds, 0);
  if (type === 'UNIT') return data.unit.beds;
  return data.unit.bedrooms.filter((b) => bedroomIds.includes(b.id)).reduce((s, b) => s + b.beds, 0);
}
/**
 * prefill(state, data, touched) → new state with untouched fields recomputed.
 * state: { type, twoYear, start, end, rentPerBed, groupType, expectedNames, bedroomIds, water, gas, provisions, notes }
 */
export function prefill(state, data, touched) {
  const s = { ...state };
  const set = (k, v) => { if (!touched.has(k)) s[k] = v; };
  const dates = calendarDates(data.property.calendar, data.ay, s.twoYear);
  set('start', dates.start); set('end', dates.end);
  set('rentPerBed', targetRentPerBed(s.type, data));
  if (s.type === 'BED' && !touched.has('bedroomIds')) s.bedroomIds = data.unit.bedrooms.filter((b) => b.free).map((b) => b.id);
  set('expectedNames', s.groupType === 'RENEWAL' ? (data.priorTenantNames || []).join('\n') : '');
  s.termMonths = termMonths(s.start, s.end);
  s.bedsCovered = bedsCovered(s.type, data, s.bedroomIds || []);
  s.monthly = s.rentPerBed != null ? s.rentPerBed * (s.type === 'BED' ? 1 : s.bedsCovered) : null; // per lease: a bedroom lease is one bed
  s.total = s.monthly != null && s.termMonths ? s.monthly * s.termMonths : null;
  s.calendarMissing = !data.property.calendar;
  return s;
}
/** The writes the dialog produces: one lease per selected bedroom, else one lease. Field ids are the lease record's. */
export function buildLeaseChanges(s, data, ids, F) {
  const base = {
    [F.PROPERTY]: Number(data.property.id), [F.AY]: Number(data.ayId), 'custrecord_serp_lease_type_test': Number(ids.leaseType[s.type]),
    [F.START]: s.start, [F.END]: s.end, 'custrecord_serp_lease_duration_options': s.termMonths,
    'custrecord_serp_group_type': ids.groupType[s.groupType] ? Number(ids.groupType[s.groupType]) : null,
    'custrecord_rent_target_per_bed': s.rentPerBed != null ? Math.round(s.rentPerBed * 100) / 100 : null,
    'custrecord_serp_watersewer_included': !!s.water, 'custrecord_serp_gaselectric_included': !!s.gas,
    'custrecord_serp_additional_provisions': [s.provisions, s.notes].filter(Boolean).join('\n\n') || null,
    // created with NO status (§5.3)
  };
  const ayLabel = `AY ${String(data.ay).slice(2)}-${String(data.ay + 1).slice(2)}`;
  const mk = (name, unitLink, monthly, tenantCount) => ({ recordType: 'customrecord_serp_lease_record', recordId: null, fields: { ...base, name, [F.UNIT]: unitLink == null ? null : Number(unitLink), [F.MONTHLY_RENT]: monthly, 'custrecord_serp_rent_actual_total': monthly != null && s.termMonths ? monthly * s.termMonths : null, [F.TENANT_COUNT]: tenantCount } });
  const names = (s.expectedNames || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (s.type === 'BED') return (s.bedroomIds || []).map((bid) => { const b = data.unit.bedrooms.find((x) => x.id === bid); return mk(`${data.unit.name} ${b ? b.name : bid} ${ayLabel}`, bid, s.rentPerBed != null ? s.rentPerBed * (b ? b.beds : 1) : null, 1); });
  if (s.type === 'WH') return [mk(`${data.property.name} ${ayLabel}`, null, s.monthly, names.length || s.bedsCovered)];
  return [mk(`${data.unit.name} ${ayLabel}`, data.unit.id, s.monthly, names.length || s.bedsCovered)];
}

/** What a new lease would cover, for the overlap check: the property, one unit, or some bedrooms of one unit. */
export function leaseScope(state, data) {
  if (state.type === 'WH') return { level: 'property', unitId: null, bedroomIds: [] };
  if (state.type === 'BED') return { level: 'bedroom', unitId: data.unit.id, bedroomIds: (state.bedroomIds || []).map(String) };
  return { level: 'unit', unitId: data.unit.id, bedroomIds: [] };
}
/** Two inclusive date ranges touch when neither ends before the other starts. */
export function datesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return compare(aStart, bEnd) <= 0 && compare(bStart, aEnd) <= 0;
}
/**
 * The existing leases a new lease would collide with: same dates AND the same beds. A property-wide lease collides with
 * everything at the property; a unit lease with that unit's leases and its bedrooms'; a bedroom lease with the property,
 * its unit, and the same bedroom. `existing` rows carry { id, name, start, end, level, unitId, bedroomId, statusKey }.
 */
export function overlappingLeases(start, end, existing, scope) {
  return (existing || []).filter((l) => {
    if (l.inactive) return false;
    if (!datesOverlap(start, end, l.start, l.end)) return false;
    if (scope.level === 'property' || l.level === 'property') return true;
    if (String(l.unitId) !== String(scope.unitId)) return false;
    if (scope.level === 'unit' || l.level === 'unit') return true;
    return scope.bedroomIds.includes(String(l.bedroomId));
  });
}
/** The first day after the latest existing lease that would collide at these beds, on or after `from`. */
export function nextFreeStart(from, end, existing, scope) {
  let start = from;
  for (let i = 0; i < 12; i++) {
    const hits = overlappingLeases(start, end, existing, scope);
    if (!hits.length) return start;
    const latest = hits.reduce((m, l) => (compare(l.end, m) > 0 ? l.end : m), hits[0].end);
    start = addDays(latest, 1);
  }
  return start;
}
