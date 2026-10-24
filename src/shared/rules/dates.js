/**
 * Date helpers for the engine. All dates are ISO 'YYYY-MM-DD' strings or null.
 * Arithmetic is done on UTC day numbers so there is no DST and no `now()`.
 */
import { AY_BOUNDARY } from '../constants.js';

const MS_DAY = 86400000;

/** Accepts 'YYYY-MM-DD', 'M/D/YYYY', 'YYYY-MM-DDTHH:mm', Date; returns 'YYYY-MM-DD' or null. */
export function toISO(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}
function pad(n) { return String(n).padStart(2, '0'); }

export function parts(iso) {
  const d = toISO(iso);
  if (!d) return null;
  const [y, m, dd] = d.split('-').map(Number);
  return { y, m, d: dd };
}
/** Day number (days since epoch, UTC). */
export function dayNum(iso) {
  const p = parts(iso);
  return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / MS_DAY) : null;
}
export function fromDayNum(n) { return new Date(n * MS_DAY).toISOString().slice(0, 10); }
export function addDays(iso, n) { const d = dayNum(iso); return d == null ? null : fromDayNum(d + n); }
export function addYears(iso, n) { const p = parts(iso); return p ? toISO(`${p.y + n}-${pad(p.m)}-${pad(p.d)}`) : null; }
/** end - start in days (negative if inverted). */
export function daysBetween(a, b) { const x = dayNum(a), y = dayNum(b); return x == null || y == null ? null : y - x; }
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function compare(a, b) { return (dayNum(a) ?? -Infinity) - (dayNum(b) ?? -Infinity); }
export function min(a, b) { return compare(a, b) <= 0 ? a : b; }
export function max(a, b) { return compare(a, b) >= 0 ? a : b; }

/**
 * Lease term in calendar months from an inclusive date range, as a fraction.
 * Jun 1 → May 31 = 12.0 ; Aug 5 → Jul 25 ≈ 11.7 ; Jun 1 2026 → May 23 2028 ≈ 23.7.
 */
export function monthsBetweenFraction(start, end) {
  const a = parts(start), b = parts(end);
  if (!a || !b) return null;
  if (dayNum(end) < dayNum(start)) return -1;
  const whole = (b.y - a.y) * 12 + (b.m - a.m);
  const remainderDays = b.d + 1 - a.d; // inclusive end
  return whole + remainderDays / daysInMonth(b.y, b.m);
}
/** Always rounded UP (Amicus writes 11-month terms and treats them as 12). */
export function monthsBetweenCeil(start, end) {
  const f = monthsBetweenFraction(start, end);
  if (f == null || f < 0) return f;
  return Math.max(1, Math.ceil(f - 1e-9));
}

// ---------------------------------------------------------------------------
// Academic years. An AY is identified by its START year (number): 2027 ⇒ "AY 2027-2028".
// ---------------------------------------------------------------------------
export function ayStartDate(ayYear) { return `${ayYear}-${pad(AY_BOUNDARY.month)}-${pad(AY_BOUNDARY.day)}`; }
export function ayEndDate(ayYear) { return addDays(ayStartDate(ayYear + 1), -1); }
/** AY containing a date, by the AY_BOUNDARY (assumption A-1). */
export function ayForDate(iso) {
  const p = parts(iso);
  if (!p) return null;
  const afterBoundary = p.m > AY_BOUNDARY.month || (p.m === AY_BOUNDARY.month && p.d >= AY_BOUNDARY.day);
  return afterBoundary ? p.y : p.y - 1;
}
/** 'AY 2027-2028' | '2027-2028' | '27-28' | 'AY 27-28' | 2027 → 2027. */
export function ayYearFromLabel(label) {
  if (label == null || label === '') return null;
  if (typeof label === 'number') return label;
  const s = String(label);
  let m = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(s);
  if (m) return Number(m[1]);
  m = /\b(\d{2})\s*[-–/]\s*(\d{2})\b/.exec(s);
  if (m) return 2000 + Number(m[1]);
  m = /^\s*(\d{4})\s*$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}
export function ayLabel(ayYear) { return `AY ${ayYear}-${ayYear + 1}`; }
export function ayShort(ayYear) { return `${String(ayYear).slice(2)}-${String(ayYear + 1).slice(2)}`; }

// ---------------------------------------------------------------------------
// Weeks (Mon–Sun) — §6.2 Weekly
// ---------------------------------------------------------------------------
/** ISO weekday 1=Mon … 7=Sun */
export function isoWeekday(iso) { const n = dayNum(iso); return ((n + 3) % 7 + 7) % 7 + 1; }
export function weekStart(iso) { return addDays(iso, -(isoWeekday(iso) - 1)); }
export function weekEnd(iso) { return addDays(weekStart(iso), 6); }
export function monthStart(iso) { const p = parts(iso); return `${p.y}-${pad(p.m)}-01`; }
/**
 * Days to shift "last year" so Mon–Sun aligns with Mon–Sun: the gap between the
 * two AY start dates rounded to whole weeks (normally 364).
 */
export function lastYearShiftDays(ayYear) {
  const gap = daysBetween(ayStartDate(ayYear - 1), ayStartDate(ayYear));
  return Math.round(gap / 7) * 7;
}
export function inRange(iso, start, end) { // inclusive both ends
  const n = dayNum(iso);
  return n != null && n >= dayNum(start) && n <= dayNum(end);
}
