/**
 * §5.7.1 — overlap arithmetic. Intervals are half-open: [start, end).
 * A lease ending on the day another begins does NOT overlap.
 * NOTE: lease END dates are inclusive in NetSuite (last night of occupancy), so
 * the half-open end used here is end + 1 day. "Ends 5/31, next starts 6/1" ⇒ 0 overlap.
 */
import { dayNum } from './dates.js';
import { OVERLAP_TOLERANCE_DAYS } from '../constants.js';

/** Number of overlapping days between two inclusive-dated leases (0 if none). */
export function overlapDays(a, b) {
  const as = dayNum(a.start), ae = dayNum(a.end), bs = dayNum(b.start), be = dayNum(b.end);
  if ([as, ae, bs, be].some((x) => x == null)) return null; // undated: caller decides
  const aEnd = ae + 1, bEnd = be + 1; // half-open ends
  const lo = Math.max(as, bs), hi = Math.min(aEnd, bEnd);
  return Math.max(0, hi - lo);
}

/**
 * Classify a pair under the §5.7.1 rule.
 *   'none'   — sequential (gap or adjacent)
 *   'minor'  — overlap within tolerance: both leases placed, low-severity flag
 *   'collide'— real conflict
 *   'undated'— one side lacks dates (legacy behaviour applies)
 */
export function classifyPair(a, b, tolerance = OVERLAP_TOLERANCE_DAYS) {
  const d = overlapDays(a, b);
  if (d == null) return 'undated';
  if (d === 0) return 'none';
  if (d <= tolerance) return 'minor';
  return 'collide';
}

/**
 * Decide whether two leases on the same scope in the same AY collide.
 * requireOverlap=false reproduces today's rule (any two in one AY collide).
 */
export function collides(a, b, { requireOverlap, tolerance } = {}) {
  if (!requireOverlap) return 'collide';
  const c = classifyPair(a, b, tolerance);
  return c === 'undated' ? 'collide' : c;
}
