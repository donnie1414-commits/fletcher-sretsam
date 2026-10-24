/** Apply the resolver's scope and the user's fund/market selection to engine output. Ratios stay ratios of sums. */
import { emptyMetrics, addMetrics, finish, round } from '../shared/rules/metrics.js';

export function inScope(scope, marketId) { return scope.all || scope.markets.has(marketId); }
/** Property-level predicate used by the rule modules: scope ∩ selection. Also accepts { fund, marketId } cells. */
export function keepFor(scope, { fund = null, marketId = null } = {}) { return (p) => !!p && inScope(scope, p.marketId) && (!fund || p.fund === fund) && (!marketId || p.marketId === marketId); }

/** Summary restricted to {fund?, marketIds?} ∩ scope. */
export function scopedSummary(result, scope, { fund = null, marketId = null } = {}) {
  const rows = result.summary.byMarket.filter((r) => inScope(scope, r.marketId) && (!fund || r.fund === fund) && (!marketId || r.marketId === marketId));
  const sum = (key) => finish(rows.reduce((m, r) => addMetrics(m, r[key]), emptyMetrics()));
  const byMarket = new Map();
  for (const r of rows) { if (!byMarket.has(r.marketId)) byMarket.set(r.marketId, { marketId: r.marketId, market: r.market, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() }); const t = byMarket.get(r.marketId); addMetrics(t.metrics, r.metrics); addMetrics(t.str, r.str); addMetrics(t.commercial, r.commercial); }
  const byFund = new Map();
  for (const r of rows) { if (!byFund.has(r.fund)) byFund.set(r.fund, { fund: r.fund, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() }); const t = byFund.get(r.fund); addMetrics(t.metrics, r.metrics); addMetrics(t.str, r.str); addMetrics(t.commercial, r.commercial); }
  const fin = (t) => ({ ...t, metrics: round(finish(t.metrics)), str: round(finish(t.str)), commercial: round(finish(t.commercial)) });
  return { student: round(sum('metrics')), str: round(sum('str')), commercial: round(sum('commercial')), byMarket: [...byMarket.values()].map(fin), byFund: [...byFund.values()].map(fin) };
}
/** Prune the Fund ▸ Market tree to scope/selection and round metrics; flatten for the virtualized client. Empty parent properties are dropped (their children carry the units). */
export function scopedTree(result, scope, { fund = null, marketId = null } = {}) {
  const out = [];
  const visit = (n, parentKey, depth) => {
    if (n.kind === 'property' && n.isParent && !n.metrics.beds && !n.metrics.activeLeases && !n.metrics.excludedLeases) return;
    const row = { key: n.key, parent: parentKey, depth, kind: n.kind, id: n.id, name: n.name, metrics: compact(n.metrics), childCount: n.children.length };
    if (n.segment && n.segment !== 'STUDENT') row.segment = n.segment;
    if (n.leaf) row.leaf = compactLeaf(n.leaf);
    if ((n.kind === 'fund' || n.kind === 'market') && (n.str.beds || n.commercial.monthly)) { row.str = compact(n.str); row.commercial = compact(n.commercial); }
    out.push(row);
    for (const c of n.children) visit(c, n.key, depth + 1);
  };
  for (const f of result.tree) {
    if (fund && f.id !== fund) continue;
    const markets = f.children.filter((m) => inScope(scope, m.id) && (!marketId || m.id === marketId));
    if (!markets.length) continue;
    visit({ ...f, children: markets }, null, 0);
  }
  return out;
}
const KEEP_ZERO = new Set(['beds', 'occupied', 'vacant']);
const KEYS = ['beds', 'occupied', 'vacant', 'occPct', 'finOccPct', 'monthly', 'annual', 'rentPerBed', 'rentPerPerson', 'people', 'activeLeases', 'excludedLeases',
  'pOccupied', 'pOccPct', 'occDelta', 'pMonthly', 'mrevYoY', 'pRentBed', 'ssBeds', 'ssCur', 'ssPrior', 'ssYoY', 'targetMonthly', 'targetPerBed', 'actVsTarget', 'targetVacant', 'settleMonthly', 'prevRentPerBed'];
/** Only the displayed measures, rounded, nulls and zeros dropped: the Portfolio tree has ~6,000 nodes and ships as JSON. */
function compact(m) {
  const r = round(m); const out = {};
  for (const k of KEYS) if (r[k] != null && !(r[k] === 0 && !KEEP_ZERO.has(k))) out[k] = r[k];
  if (r.byType) { if (r.byType.WH) out.occWH = r.byType.WH; if (r.byType.UNIT) out.occUnit = r.byType.UNIT; if (r.byType.BED) out.occBed = r.byType.BED; }
  return out;
}
function compactLeaf(l) {
  const out = { type: l.typeLabel, leases: l.leases };
  if (l.start) out.start = l.start; if (l.end) out.end = l.end; if (l.months) out.months = l.months;
  if (l.sequential) out.sequential = true; if (l.carriedOnly) out.carried = true; if (l.sameStore) out.ss = true; else if (l.ssWhy) out.ssWhy = l.ssWhy;
  if (l.prior && l.prior.occupied) out.prior = { monthly: Number(l.prior.monthly.toFixed(2)), leases: l.prior.leases };
  return out;
}
export function propertyIdsInScope(inventory, scope) { const ids = []; for (const p of inventory.propertiesById.values()) if (inScope(scope, p.marketId)) ids.push(p.id); return ids; }
