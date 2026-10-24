import { leasingEvents, weeklyReport } from '../../shared/rules/weekly.js';
import { compareMetrics, round } from '../../shared/rules/metrics.js';
import { toISO } from '../../shared/rules/dates.js';

export function routeSummary(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const cur = ctx.scopedSummary(ctx.run(ay, basis), sel);
  const prior = ctx.scopedSummary(ctx.run(ay - 1, basis), sel);
  return {
    ay, basis, selection: sel,
    headline: { beds: cur.student.beds, occupied: cur.student.occupied, occPct: cur.student.occPct, preleasePct: ay > ctx.currentAy() ? cur.student.occPct : null, monthly: cur.student.monthly },
    student: cur.student, str: cur.str, commercial: cur.commercial, byFund: cur.byFund, byMarket: cur.byMarket,
    prior: { student: prior.student, byMarket: prior.byMarket },
    deltas: { total: compareMetrics(cur.student, prior.student), byMarket: cur.byMarket.map((m) => ({ marketId: m.marketId, delta: compareMetrics(m.metrics, (prior.byMarket.find((x) => x.marketId === m.marketId) || {}).metrics) })) },
    degraded: ctx.schema.degraded,
  };
}
export function routePortfolio(ctx) {
  const r = ctx.run();
  return { ay: ctx.selectedAy(), basis: ctx.basis(), nodes: ctx.scopedTree(r, ctx.selection()), degraded: ctx.schema.degraded };
}
export function routeWeekly(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const cur = ctx.run(ay, basis), last = ctx.run(ay - 1, basis);
  const keep = (e) => ctx.inScope(e.marketId) && (!sel.fund || e.fund === sel.fund) && (!sel.marketId || e.marketId === sel.marketId);
  const eventsThis = leasingEvents(cur.placement, cur.inventory).filter(keep);
  const eventsLast = leasingEvents(last.placement, last.inventory).filter(keep);
  const bedsThis = ctx.scopedSummary(cur, sel).student.beds, bedsLast = ctx.scopedSummary(last, sel).student.beds;
  const marketIds = [...new Set(eventsThis.concat(eventsLast).map((e) => e.marketId))].sort();
  const report = weeklyReport({ ay, today: ctx.today, weekOf: toISO(ctx.params.week) || null, eventsThis, eventsLast, bedsThis, bedsLast, marketIds });
  return { ay, basis, selection: sel, ...report, degraded: ctx.schema.degraded };
}
