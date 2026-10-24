import { weeklyReport } from '../../shared/rules/weekly.js';
import { summaryExtras, velocity } from '../../shared/rules/summary.js';
import { compareMetrics } from '../../shared/rules/metrics.js';
import { toISO, ayEndDate } from '../../shared/rules/dates.js';

export function routeSummary(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const run = ctx.run(ay, basis);
  const cur = ctx.scopedSummary(run, sel);
  const prior = run.prior ? ctx.scopedSummary({ summary: run.prior.summary }, sel) : null;
  const extras = summaryExtras(run, { keep: ctx.keep(sel), today: ctx.today, basis });
  return {
    ay, basis, selection: sel, today: ctx.today, currentAy: ctx.currentAy(),
    headline: { beds: cur.student.beds, occupied: cur.student.occupied, occPct: cur.student.occPct, preleasePct: ay > ctx.currentAy() ? cur.student.occPct : null, monthly: cur.student.monthly },
    student: cur.student, str: cur.str, commercial: cur.commercial, byFund: cur.byFund, byMarket: cur.byMarket,
    prior: prior ? { student: prior.student, byMarket: prior.byMarket } : null,
    deltas: { total: compareMetrics(cur.student, prior ? prior.student : null), byMarket: cur.byMarket.map((m) => ({ marketId: m.marketId, delta: compareMetrics(m.metrics, prior ? (prior.byMarket.find((x) => x.marketId === m.marketId) || {}).metrics : null) })) },
    ...extras,
    degraded: ctx.schema.degraded,
  };
}
export function routePortfolio(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const run = ctx.run(ay, basis);
  const extras = summaryExtras(run, { keep: ctx.keep(sel), today: ctx.today, basis });
  return { ay, basis, priorAy: run.prior ? run.prior.ay : null, nodes: ctx.scopedTree(run, sel), vacancy: extras.vacancy, total: extras.kpi.total, propertyCount: extras.propertyCount, sameStore: extras.sameStore, degraded: ctx.schema.degraded };
}
export function routeWeekly(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const run = ctx.run(ay, basis);
  const inact = ctx.dao.portfolio.inactivations();
  const ayLabels = Object.fromEntries(ctx.ays().map((a) => [a.id, a.label]));
  const report = weeklyReport({ ay, basis, today: ctx.today, weekOf: toISO(ctx.params.week) || null, cur: run, prior: run.prior, keep: ctx.keep(sel), groupBy: ctx.params.groupBy === 'fund' || (sel.marketId && ctx.params.groupBy !== 'market') ? 'fund' : 'market', inactivations: inact.rows, ayLabels });
  return { ay, basis, selection: sel, priorAy: run.prior ? run.prior.ay : null, ayEnd: ayEndDate(ay), inactivationsAvailable: inact.available, ...report, degraded: ctx.schema.degraded };
}
/** Leasing velocity: counted leases by days from the AY start for the selected AY and up to 3 prior ones, both bases. */
export function routeVelocity(ctx) {
  const ay = ctx.selectedAy(), sel = ctx.selection();
  const known = ctx.ays();
  const ays = [ay, ay - 1, ay - 2, ay - 3].map((y) => known.find((a) => a.year === y)).filter(Boolean);
  const runs = {};
  for (const a of ays) for (const basis of ['proforma', 'executed']) runs[`${a.year}:${basis}`] = ctx.run(a.year, basis, false);
  return { ay, selection: sel, ...velocity(runs, { ays, keep: ctx.keep(sel) }) };
}
