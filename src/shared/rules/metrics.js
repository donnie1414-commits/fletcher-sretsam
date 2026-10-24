/**
 * §5.8 — metrics. Every ratio is a ratio of SUMS at every level. Pure.
 */
import { SEGMENTS } from '../constants.js';

export function emptyMetrics() {
  return { beds: 0, occupied: 0, vacant: 0, bedMonths: 0, monthly: 0, annual: 0, people: 0, leaves: 0, occupiedLeaves: 0,
    byType: { WH: 0, UNIT: 0, BED: 0 }, targetMonthly: 0, targetBeds: 0, carriedBeds: 0,
    occPct: null, finOccPct: null, rentPerBed: null, rentPerPerson: null, targetVariance: null };
}
export function addLeaf(m, lr, segmentMeta) {
  const beds = segmentMeta.beds ? lr.leaf.beds : 0;
  m.leaves += 1;
  m.beds += beds;
  m.occupied += segmentMeta.beds ? lr.occupied : 0;
  m.occupiedLeaves += lr.occupied ? 1 : 0;
  m.bedMonths += segmentMeta.beds ? lr.occupied * lr.months : 0;
  m.monthly += lr.monthly;
  m.annual += lr.annual;
  m.people += lr.people;
  if (lr.typeKey && segmentMeta.beds) m.byType[lr.typeKey] += lr.occupied;
  if (lr.carriedOnly && segmentMeta.beds) m.carriedBeds += lr.occupied;
  if (lr.targetMonthly != null) { m.targetMonthly += lr.targetMonthly; m.targetBeds += beds; }
  return m;
}
export function addMetrics(a, b) {
  for (const k of ['beds', 'occupied', 'bedMonths', 'monthly', 'annual', 'people', 'leaves', 'occupiedLeaves', 'targetMonthly', 'targetBeds', 'carriedBeds']) a[k] += b[k];
  for (const t of Object.keys(a.byType)) a.byType[t] += b.byType[t] || 0;
  return a;
}
export function finish(m) {
  m.vacant = m.beds - m.occupied;
  m.occPct = m.beds ? m.occupied / m.beds : null;
  m.finOccPct = m.beds ? m.bedMonths / 12 / m.beds : null;
  m.rentPerBed = m.occupied ? m.monthly / m.occupied : null;
  m.rentPerPerson = m.people ? m.monthly / m.people : null;
  m.targetVariance = m.targetMonthly ? m.monthly - m.targetMonthly : null;
  return m;
}
export function round(m, places = 2) {
  const out = { ...m, byType: { ...m.byType } };
  for (const k of Object.keys(out)) if (typeof out[k] === 'number') out[k] = Number(out[k].toFixed(places));
  return out;
}

/**
 * Attach per-unit AY targets to leaf results (target is per UNIT per AY; it is
 * spread to leaves by bed share so Σ over a unit's leaves equals the unit target).
 */
export function applyTargets(inventory, leafResults, targets, ay) {
  const byUnit = new Map();
  for (const t of targets) if (t.ay === ay && t.unitId) byUnit.set(String(t.unitId), t);
  for (const u of inventory.unitsById.values()) {
    const t = byUnit.get(u.id);
    if (!t) continue;
    const unitTarget = t.targetMonthly != null ? t.targetMonthly : (t.targetPerBed != null ? t.targetPerBed * u.beds : null);
    if (unitTarget == null || !u.beds) continue;
    for (const leaf of u.leaves) { const lr = leafResults.get(leaf.key); if (lr) { lr.targetMonthly = unitTarget * leaf.beds / u.beds; lr.targetPerBed = unitTarget / u.beds; } }
  }
}

/**
 * Roll leaf results up the hierarchy. Returns:
 *   { tree: [fund…], summary: { student, str, commercial, byFund, byMarket, byType } }
 * Student/non-student share the main denominator; STR and commercial are kept out (§5.8).
 */
export function rollup(inventory, placement) {
  const segFor = (leaf) => { const p = inventory.propertiesById.get(leaf.propertyId); return (p && SEGMENTS[p.segment]) || SEGMENTS.STUDENT; };
  const inMain = (seg) => seg.inOccupancy;
  const leafM = (lr) => { const seg = segFor(lr.leaf); return { seg, m: finish(addLeaf(emptyMetrics(), lr, seg)) }; };

  const funds = new Map();
  const summary = { student: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics(), byFund: [], byMarket: [], unmapped: emptyMetrics() };
  const bucketOf = (seg) => (seg.key === 'STR' ? summary.str : seg.key === 'COMMERCIAL' ? summary.commercial : summary.student);

  for (const p of inventory.propertiesById.values()) {
    const fundKey = p.fund || 'UNMAPPED';
    if (!funds.has(fundKey)) funds.set(fundKey, node('fund', fundKey, fundKey));
    const f = funds.get(fundKey);
    if (!f.childMap.has(p.marketId)) f.childMap.set(p.marketId, node('market', p.marketId, p.marketLabel));
    const mk = f.childMap.get(p.marketId);
    const pn = node('property', p.id, p.name); pn.segment = p.segment; pn.parentPropertyId = p.parentId;
    const seg = SEGMENTS[p.segment] || SEGMENTS.STUDENT;
    const main = inMain(seg);
    for (const uid of p.units) {
      const u = inventory.unitsById.get(uid);
      const un = node('unit', u.id, u.name); un.segment = p.segment; un.rrUnitId = u.rrUnitId;
      for (const leaf of u.leaves) {
        const lr = placement.leafResults.get(leaf.key);
        const { m } = leafM(lr);
        if (leaf.kind === 'bedroom') { const bn = node('bedroom', leaf.id, leaf.name); bn.metrics = m; bn.leaf = summarizeLeaf(lr); un.children.push(bn); }
        else un.leaf = summarizeLeaf(lr);
        addMetrics(un.metrics, m);
      }
      finish(un.metrics); pn.children.push(un); addMetrics(pn.metrics, un.metrics);
    }
    if (p.ownLeaf) { const lr = placement.leafResults.get(p.ownLeaf.key); const { m } = leafM(lr); pn.leaf = summarizeLeaf(lr); addMetrics(pn.metrics, m); }
    finish(pn.metrics);
    mk.children.push(pn);
    if (main) { addMetrics(mk.metrics, pn.metrics); } else { addMetrics(seg.key === 'STR' ? mk.str : mk.commercial, pn.metrics); }
    addMetrics(bucketOf(seg), pn.metrics);
    if (!p.fund) addMetrics(summary.unmapped, pn.metrics);
  }
  const tree = [];
  for (const f of funds.values()) {
    for (const mk of f.childMap.values()) { finish(mk.metrics); finish(mk.str); finish(mk.commercial); f.children.push(mk); addMetrics(f.metrics, mk.metrics); addMetrics(f.str, mk.str); addMetrics(f.commercial, mk.commercial); summary.byMarket.push({ fund: f.id, marketId: mk.id, market: mk.name, metrics: mk.metrics, str: mk.str, commercial: mk.commercial }); }
    finish(f.metrics); finish(f.str); finish(f.commercial); delete f.childMap; tree.push(f);
    summary.byFund.push({ fund: f.id, metrics: f.metrics, str: f.str, commercial: f.commercial });
  }
  finish(summary.student); finish(summary.str); finish(summary.commercial); finish(summary.unmapped);
  // market totals across funds
  const mkTotals = new Map();
  for (const row of summary.byMarket) { if (!mkTotals.has(row.marketId)) mkTotals.set(row.marketId, { marketId: row.marketId, market: row.market, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() }); const t = mkTotals.get(row.marketId); addMetrics(t.metrics, row.metrics); addMetrics(t.str, row.str); addMetrics(t.commercial, row.commercial); }
  summary.byMarketTotal = [...mkTotals.values()].map((t) => ({ ...t, metrics: finish(t.metrics), str: finish(t.str), commercial: finish(t.commercial) }));
  return { tree, summary };
}
function node(kind, id, name) { return { key: `${kind[0]}:${id}`, kind, id, name, children: [], childMap: kind === 'fund' ? new Map() : undefined, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() }; }
function summarizeLeaf(lr) { return { occupied: lr.occupied, months: lr.months, monthly: lr.monthly, annual: lr.annual, people: lr.people, typeKey: lr.typeKey, leases: lr.placements.map((p) => p.leaseId), sequential: lr.sequential, carriedOnly: lr.carriedOnly }; }

/** Deltas for "versus last year" / "versus target" shown on the figures themselves (§6.2). */
export function compareMetrics(cur, prior) {
  const d = (k) => (cur[k] == null || !prior || prior[k] == null ? null : cur[k] - prior[k]);
  return { occupied: d('occupied'), occPct: d('occPct'), rentPerBed: d('rentPerBed'), monthly: d('monthly'), beds: d('beds'), people: d('people') };
}
