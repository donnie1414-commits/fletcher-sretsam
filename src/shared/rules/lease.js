/**
 * §5.3 — Lease normalisation: type, status, term, two-year detection and apportionment.
 * Pure. Input is a raw DAO/snapshot row; output is the engine's lease shape.
 */
import { leaseTypeKey, leaseStatusKey, TWO_YEAR_MIN_MONTHS } from '../constants.js';
import { toISO, monthsBetweenFraction, monthsBetweenCeil, ayForDate, ayYearFromLabel, daysBetween } from './dates.js';

const S = (v) => (v == null ? null : String(v));
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parseIdList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Term in months (§5.3): duration field → total ÷ monthly → dates, always rounded up.
 * Returns { termMonths, termSource, dateMonths }.
 */
export function termMonths(l) {
  const dateMonths = l.start && l.end ? monthsBetweenCeil(l.start, l.end) : null;
  const dateFraction = l.start && l.end ? monthsBetweenFraction(l.start, l.end) : null;
  if (l.durationField != null && l.durationField > 0) return { termMonths: Math.ceil(l.durationField), termSource: 'duration', dateMonths, dateFraction };
  if (l.totalRent != null && l.monthlyRent > 0) return { termMonths: Math.max(1, Math.ceil(l.totalRent / l.monthlyRent - 1e-9)), termSource: 'rent', dateMonths, dateFraction };
  if (dateMonths != null && dateMonths > 0) return { termMonths: dateMonths, termSource: 'dates', dateMonths, dateFraction };
  return { termMonths: null, termSource: null, dateMonths, dateFraction };
}

/**
 * Normalise one lease. `lookups` carries the probed list-id → key maps; when
 * absent, labels are matched by text (the DAO supplies BUILTIN.DF text too).
 */
export function normalizeLease(raw, lookups = {}) {
  const typeKey = leaseTypeKey(raw.lease_type_name ?? raw.lease_type, lookups.leaseTypeIds)
    ?? leaseTypeKey(raw.lease_type, lookups.leaseTypeIds);
  const statusKey = raw.status == null && raw.status_name == null
    ? 'NONE'
    : (leaseStatusKey(raw.status_name ?? raw.status, lookups.leaseStatusIds));
  const l = {
    id: S(raw.id), name: raw.name || `Lease ${raw.id}`, inactive: raw.isinactive === 'T',
    propertyId: S(raw.property), unitId: S(raw.unit),
    typeKey, typeRaw: raw.lease_type ?? null,
    statusKey, statusRaw: raw.status ?? null,
    start: toISO(raw.start_date), end: toISO(raw.end_date),
    sentDate: toISO(raw.sent_date), signedDate: toISO(raw.signed_date), signedFlag: raw.signed_flag === 'T',
    monthlyRent: num(raw.monthly_rent) || 0, totalRent: num(raw.total_rent),
    durationField: num(raw.duration_months),
    tenantCount: num(raw.tenant_count) || 0, tenantIds: parseIdList(raw.tenants),
    ayFieldRaw: raw.ay ?? null,
    ayFieldYear: ayYearFromLabel(raw.ay_name) ?? (lookups.ayYears ? lookups.ayYears[S(raw.ay)] ?? null : null),
    groupType: raw.group_type ?? null, targetPerBed: num(raw.target_per_bed), targetMonthly: num(raw.target_monthly),
    rrUnitId: raw.rr_unit_id || null, created: toISO(raw.created), lastModified: toISO(raw.lastmodified),
  };
  if (l.tenantCount === 0 && l.tenantIds.length) l.tenantCount = l.tenantIds.length;

  const t = termMonths(l);
  Object.assign(l, t);
  l.badDates = !!(l.start && l.end && daysBetween(l.start, l.end) < 0);
  l.missingDates = !l.start || !l.end;

  // Two-year discriminator: from the DATES (§5.3). The duration field alone does
  // not make a lease two-year; a 24 in the field with 12 months of dates is TERM_MISMATCH.
  l.isTwoYear = !l.badDates && !l.missingDates && l.dateMonths >= TWO_YEAR_MIN_MONTHS;
  l.termMismatch = !l.badDates && !l.missingDates && l.durationField != null && l.durationField >= TWO_YEAR_MIN_MONTHS && l.dateMonths < TWO_YEAR_MIN_MONTHS;
  if (l.isTwoYear && (l.termMonths == null || l.termMonths < TWO_YEAR_MIN_MONTHS)) {
    // the field says one year but the dates say two: trust the dates for the term as well
    l.termMonths = l.dateMonths; l.termSource = 'dates';
  }

  // Academic years this lease counts in (assumption A-2):
  //  - one-year: the lease's own AY field (fallback: AY of the start date)
  //  - two-year: anchored on the start date; year 1 = AY of start, year 2 = next (carried)
  l.ayStartYear = l.start ? ayForDate(l.start) : null;
  l.years = [];
  if (l.isTwoYear) {
    const months1 = Math.min(12, l.termMonths);
    const months2 = Math.max(0, l.termMonths - months1);
    l.years.push({ ay: l.ayStartYear, months: months1, carried: false });
    if (months2 > 0) l.years.push({ ay: l.ayStartYear + 1, months: months2, carried: true });
  } else {
    const ay = l.ayFieldYear ?? l.ayStartYear;
    if (ay != null) l.years.push({ ay, months: l.termMonths ?? 0, carried: false });
  }
  for (const y of l.years) {
    y.monthlyRent = l.monthlyRent;
    y.revenue = l.monthlyRent * y.months; // §5.3 apportion: monthly_rent × months
  }
  return l;
}

export function yearEntry(lease, ay) { return lease.years.find((y) => y.ay === ay) || null; }
