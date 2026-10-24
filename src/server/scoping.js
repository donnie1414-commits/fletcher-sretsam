/** Apply the resolver's scope and the user's fund/market selection to engine output. Ratios stay ratios of sums. */
import { emptyMetrics, addMetrics, finish, round } from '../shared/rules/metrics.js';

export function inScope(scope, marketId) { return scope.all || scope.markets.has(marketId); }

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
/** Prune the Fund ▸ Market tree to scope/selection and round metrics; flatten for the virtualized client. */
export function scopedTree(result, scope, { fund = null, marketId = null } = {}) {
  const out = [];
  const visit = (n, parentKey, depth) => {
    const row = { key: n.key, parent: parentKey, depth, kind: n.kind, id: n.id, name: n.name, metrics: compact(n.metrics), childCount: n.children.length };
    if (n.segment && n.segment !== 'STUDENT') row.segment = n.segment;
    if (n.leaf) row.leases = n.leaf.leases;
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
/** Only the displayed measures, rounded, nulls dropped: the Portfolio tree has ~6,000 nodes and ships as JSON. */
function compact(m) {
  const r = round(m); const out = {};
  for (const k of ['beds', 'occupied', 'vacant', 'occPct', 'finOccPct', 'monthly', 'annual', 'rentPerBed', 'rentPerPerson', 'people', 'targetMonthly']) if (r[k] != null && !(r[k] === 0 && k !== 'beds' && k !== 'occupied' && k !== 'vacant')) out[k] = r[k];
  return out;
}
export function propertyIdsInScope(inventory, scope) { const ids = []; for (const p of inventory.propertiesById.values()) if (inScope(scope, p.marketId)) ids.push(p.id); return ids; }
