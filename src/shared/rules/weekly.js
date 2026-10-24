/**
 * §6.2 Weekly — this-week / this-month / AY-to-date, this year vs last year.
 * Last year is shifted by the AY-start gap rounded to whole weeks (364 days) so
 * Mon–Sun aligns with Mon–Sun; a partial period compares the same elapsed days.
 * Two-year carried years are NOT leasing events (§5.3). Pure; `today` is a parameter.
 */
import { addDays, weekStart, monthStart, ayStartDate, lastYearShiftDays, inRange, dayNum, fromDayNum } from './dates.js';

/** Leasing events for an AY from a placement result: one per placed lease, not carried. */
export function leasingEvents(placement, inventory) {
  const out = [];
  for (const r of placement.leaseResults.values()) {
    if (r.status !== 'placed' || r.year.carried) continue;
    const p = inventory.propertiesById.get(r.scope.propertyId);
    out.push({ leaseId: r.lease.id, marketId: p ? p.marketId : 'unknown', fund: p ? p.fund : null, beds: r.coveredBeds,
      sent: r.lease.sentDate, signed: r.lease.signedDate || (r.lease.statusKey === 'EXECUTED' ? null : null), executed: r.lease.statusKey === 'EXECUTED',
      annual: r.year.revenue, monthly: r.lease.monthlyRent });
  }
  return out;
}

function tally(events, start, end, marketId) {
  const t = { bedsLeased: 0, leasesSent: 0, revenueLeased: 0, leasesSigned: 0 };
  for (const e of events) {
    if (marketId && e.marketId !== marketId) continue;
    if (e.signed && inRange(e.signed, start, end)) { t.bedsLeased += e.beds; t.revenueLeased += e.annual; t.leasesSigned += 1; }
    if (e.sent && inRange(e.sent, start, end)) t.leasesSent += 1;
  }
  return t;
}
const delta = (a, b) => ({ bedsLeased: a.bedsLeased - b.bedsLeased, leasesSent: a.leasesSent - b.leasesSent, revenueLeased: a.revenueLeased - b.revenueLeased, leasesSigned: a.leasesSigned - b.leasesSigned });

/**
 * weeklyReport({ ay, today, eventsThis, eventsLast, bedsThis, bedsLast, weekOf })
 *   eventsThis/eventsLast from leasingEvents() for AY and AY-1
 *   bedsThis/bedsLast: total beds in the denominator (for pre-lease %)
 *   weekOf: optional ISO date to pick a week other than today's
 */
export function weeklyReport({ ay, today, eventsThis, eventsLast, bedsThis, bedsLast, weekOf = null, marketIds = [] }) {
  const shift = lastYearShiftDays(ay);
  const anchor = weekOf || today;
  const wkStart = weekStart(anchor);
  const wkEnd = weekOf ? addDays(wkStart, 6) : today; // partial week: elapsed days only
  const periods = {
    week:  { start: wkStart, end: wkEnd },
    month: { start: monthStart(anchor), end: weekOf ? min(addDays(wkStart, 6), today) : today },
    ay:    { start: addDays(ayStartDate(ay), -365), end: today }, // leasing season runs ~12 months ahead of the AY start
  };
  const panels = {};
  for (const [k, p] of Object.entries(periods)) {
    const cur = tally(eventsThis, p.start, p.end);
    const lastStart = addDays(p.start, -shift), lastEnd = addDays(p.end, -shift);
    const last = tally(eventsLast, lastStart, lastEnd);
    panels[k] = { start: p.start, end: p.end, lastStart, lastEnd, thisYear: cur, lastYear: last, change: delta(cur, last), elapsedDays: dayNum(p.end) - dayNum(p.start) + 1 };
  }
  // pre-lease % on the year panel: signed beds to date ÷ beds, vs last year at the aligned point
  const seasonStart = periods.ay.start;
  const signedToDate = tally(eventsThis, seasonStart, today).bedsLeased;
  const signedToDateLast = tally(eventsLast, addDays(seasonStart, -shift), addDays(today, -shift)).bedsLeased;
  panels.ay.preleasePct = bedsThis ? signedToDate / bedsThis : null;
  panels.ay.preleasePctLast = bedsLast ? signedToDateLast / bedsLast : null;

  // not-yet-dated reconciliation (§6.2): counted leases that land in no week
  const undated = { noSigned: 0, noSignedBeds: 0, noSent: 0 };
  for (const e of eventsThis) { if (!e.signed) { undated.noSigned += 1; undated.noSignedBeds += e.beds; } if (!e.sent) undated.noSent += 1; }

  // by-market table for the selected week
  const byMarket = marketIds.map((m) => { const cur = tally(eventsThis, periods.week.start, periods.week.end, m); const last = tally(eventsLast, panels.week.lastStart, panels.week.lastEnd, m); return { marketId: m, thisYear: cur, lastYear: last, change: delta(cur, last) }; });

  // pace: cumulative beds signed per week from season start to today, this year vs aligned last year
  const pace = [];
  let cumThis = 0, cumLast = 0;
  for (let ws = weekStart(seasonStart); dayNum(ws) <= dayNum(today); ws = addDays(ws, 7)) {
    const we = min(addDays(ws, 6), today); // the current week is clipped to today on BOTH sides so the last point equals AY-to-date
    cumThis += tally(eventsThis, ws, we).bedsLeased;
    cumLast += tally(eventsLast, addDays(ws, -shift), addDays(we, -shift)).bedsLeased;
    pace.push({ weekStart: ws, thisYear: cumThis, lastYear: cumLast });
  }
  return { ay, today, shiftDays: shift, panels, undated, byMarket, pace };
}
function min(a, b) { return dayNum(a) <= dayNum(b) ? a : b; }
export { fromDayNum };
