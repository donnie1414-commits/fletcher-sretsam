/**
 * §5.8 — metrics. Every ratio is a ratio of SUMS at every level. Pure.
 *
 * A metrics object carries the current year, the prior year on the same leaves (p*), targets
 * (Academic Year Details), same-store rent (ss*) and lease counts, so one rollup serves Summary,
 * Leasing Details (every report type) and the pipeline band.
 */
import { SEGMENTS, LEASE_TYPES } from '../constants.js';

const SUM_KEYS = ['beds', 'occupied', 'bedMonths', 'monthly', 'annual', 'people', 'leaves', 'occupiedLeaves', 'targetMonthly', 'targetBeds', 'targetOcc', 'monthlyOnTarget', 'settleMonthly', 'prevRentSum', 'prevRentBeds', 'carriedBeds',
  'pOccupied', 'pBedMonths', 'pMonthly', 'pAnnual', 'pPeople', 'ssBeds', 'ssCur', 'ssPrior', 'activeLeases', 'excludedLeases', 'pActiveLeases'];

export function emptyMetrics() {
  const m = { byType: { WH: 0, UNIT: 0, BED: 0 }, occPct: null, finOccPct: null, rentPerBed: null, rentPerPerson: null, targetVariance: null };
  for (const k of SUM_KEYS) m[k] = 0;
  return m;
}
/** Add one leaf result (and, when given, the prior year's result on the same leaf). */
export function addLeaf(m, lr, segmentMeta, plr = null) {
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
  if (lr.targetMonthly != null) {
    m.targetMonthly += lr.targetMonthly; m.targetBeds += beds;
    if (lr.occupied) { m.targetOcc += lr.targetMonthly; m.monthlyOnTarget += lr.monthly; }
  }
  if (lr.settleMonthly != null) m.settleMonthly += lr.settleMonthly;
  if (lr.prevRentPerBed != null) { m.prevRentSum += lr.prevRentPerBed * beds; m.prevRentBeds += beds; }
  if (plr) {
    m.pOccupied += segmentMeta.beds ? plr.occupied : 0;
    m.pBedMonths += segmentMeta.beds ? plr.occupied * plr.months : 0;
    m.pMonthly += plr.monthly; m.pAnnual += plr.annual; m.pPeople += plr.people;
  }
  if (lr.sameStore && plr) { m.ssBeds += beds; m.ssCur += lr.monthly; m.ssPrior += plr.monthly; }
  return m;
}
export function addMetrics(a, b) {
  for (const k of SUM_KEYS) a[k] += b[k] || 0;
  for (const t of Object.keys(a.byType)) a.byType[t] += (b.byType && b.byType[t]) || 0;
  return a;
}
const ratio = (a, b) => (b > 0 ? a / b : null);
const growth = (cur, prev) => (prev > 0 ? cur / prev - 1 : null);
export function finish(m) {
  m.vacant = m.beds - m.occupied;
  m.occPct = ratio(m.occupied, m.beds);
  m.vacPct = ratio(m.vacant, m.beds);
  m.finBeds = m.bedMonths / 12;
  m.finOccPct = ratio(m.bedMonths / 12, m.beds);
  m.rentPerBed = ratio(m.monthly, m.occupied);
  m.rentPerPerson = ratio(m.monthly, m.people);
  m.targetVariance = m.targetMonthly ? m.monthly - m.targetMonthly : null;
  m.targetPerBed = ratio(m.targetMonthly, m.targetBeds);
  m.actVsTarget = m.targetOcc > 0 ? m.monthlyOnTarget / m.targetOcc - 1 : null;
  m.targetVacant = m.targetMonthly ? m.targetMonthly - m.targetOcc : null;
  m.prevRentPerBed = ratio(m.prevRentSum, m.prevRentBeds);
  // prior year on the same leaves
  m.pVacant = m.beds - m.pOccupied;
  m.pOccPct = ratio(m.pOccupied, m.beds);
  m.pFinOccPct = ratio(m.pBedMonths / 12, m.beds);
  m.pRentPerBed = ratio(m.pMonthly, m.pOccupied);
  m.occDelta = m.occPct != null && m.pOccPct != null ? m.occPct - m.pOccPct : null;
  m.mrevYoY = growth(m.monthly, m.pMonthly);
  m.trevYoY = growth(m.annual, m.pAnnual);
  m.rentBedYoY = m.occupied > 0 && m.pOccupied > 0 ? growth(m.monthly / m.occupied, m.pMonthly / m.pOccupied) : null;
  m.ssYoY = growth(m.ssCur, m.ssPrior);
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
 * Settle rent and prior-year rent per bed ride along (Leasing Details ▸ Targets).
 * Returns the data-quality notes the old report raised (orphan rows, duplicates).
 */
export function applyTargets(inventory, leafResults, targets, ay) {
  const byUnit = new Map();
  const issues = [];
  for (const t of targets.slice().sort((a, b) => Number(a.id) - Number(b.id))) {
    if (t.ay !== ay) continue;
    if (!t.unitId || !inventory.unitsById.has(String(t.unitId))) { issues.push({ code: 'TARGET_NO_UNIT', targetId: t.id, propertyId: t.propertyId, detail: `Academic Year Details #${t.id} has no active unit` }); continue; }
    if (byUnit.has(String(t.unitId))) issues.push({ code: 'TARGET_DUPLICATE', targetId: t.id, unitId: String(t.unitId), propertyId: t.propertyId, detail: `unit has more than one Academic Year Details row; #${t.id} used` });
    byUnit.set(String(t.unitId), t);
  }
  for (const u of inventory.unitsById.values()) {
    const t = byUnit.get(u.id);
    if (!t || !u.beds) continue;
    const unitTarget = t.targetMonthly != null ? t.targetMonthly : (t.targetPerBed != null ? t.targetPerBed * u.beds : null);
    const settle = t.settleMonthly != null ? t.settleMonthly : (t.settlePerBed != null ? t.settlePerBed * u.beds : null);
    for (const leaf of u.leaves) {
      const lr = leafResults.get(leaf.key); if (!lr) continue;
      const share = leaf.beds / u.beds;
      if (unitTarget != null) { lr.targetMonthly = unitTarget * share; lr.targetPerBed = unitTarget / u.beds; }
      if (settle != null) { lr.settleMonthly = settle * share; lr.settlePerBed = settle / u.beds; }
      if (t.prevYearPerBed != null) lr.prevRentPerBed = t.prevYearPerBed;
    }
  }
  return issues;
}

/** Lease counts per scope node from the placement: active (placed) and excluded, keyed by bedroom / unit / property. */
function leaseCounts(placement) {
  const by = { bedroom: new Map(), unit: new Map(), property: new Map() };
  const bump = (map, id, key) => { if (id == null) return; const o = map.get(id) || { active: 0, excluded: 0 }; o[key] += 1; map.set(id, o); };
  for (const r of placement.leaseResults.values()) {
    if (r.status !== 'placed' && r.status !== 'excluded') continue;
    const key = r.status === 'placed' ? 'active' : 'excluded';
    const s = r.scope;
    if (s.ok || s.level) { if (s.level === 'bedroom') bump(by.bedroom, s.bedroomId, key); else if (s.level === 'unit') bump(by.unit, s.unitId, key); else bump(by.property, s.propertyId, key); }
    else if (r.lease.propertyId) bump(by.property, r.lease.propertyId, key); // unattributed: counted on the lease's own property
  }
  return by;
}

/**
 * Roll leaf results up the hierarchy. Returns:
 *   { tree: [fund…], summary: { student, str, commercial, byFund, byMarket, byType } }
 * Student/non-student share the main denominator; STR and commercial are kept out (§5.8).
 * `prior` (a placement for AY-1 on the same inventory) fills the p* fields leaf by leaf.
 */
export function rollup(inventory, placement, prior = null) {
  const segFor = (leaf) => { const p = inventory.propertiesById.get(leaf.propertyId); return (p && SEGMENTS[p.segment]) || SEGMENTS.STUDENT; };
  const inMain = (seg) => seg.inOccupancy;
  const priorOf = (key) => (prior ? prior.leafResults.get(key) || null : null);
  const leafM = (lr) => { const seg = segFor(lr.leaf); return { seg, m: finish(addLeaf(emptyMetrics(), lr, seg, priorOf(lr.leaf.key))) }; };
  const counts = leaseCounts(placement);
  const pcounts = prior ? leaseCounts(prior) : null;
  const addCounts = (m, level, id) => { const c = counts[level].get(id); if (c) { m.activeLeases += c.active; m.excludedLeases += c.excluded; } const pc = pcounts && pcounts[level].get(id); if (pc) m.pActiveLeases += pc.active; };

  const funds = new Map();
  const summary = { student: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics(), byFund: [], byMarket: [], unmapped: emptyMetrics() };
  const bucketOf = (seg) => (seg.key === 'STR' ? summary.str : seg.key === 'COMMERCIAL' ? summary.commercial : summary.student);

  for (const p of inventory.propertiesById.values()) {
    const fundKey = p.fund || 'UNMAPPED';
    if (!funds.has(fundKey)) funds.set(fundKey, node('fund', fundKey, fundKey));
    const f = funds.get(fundKey);
    if (!f.childMap.has(p.marketId)) f.childMap.set(p.marketId, node('market', p.marketId, p.marketLabel));
    const mk = f.childMap.get(p.marketId);
    const pn = node('property', p.id, p.name); pn.segment = p.segment; pn.parentPropertyId = p.parentId; pn.isParent = p.children.length > 0;
    const seg = SEGMENTS[p.segment] || SEGMENTS.STUDENT;
    const main = inMain(seg);
    for (const uid of p.units) {
      const u = inventory.unitsById.get(uid);
      const un = node('unit', u.id, u.name); un.segment = p.segment; un.rrUnitId = u.rrUnitId;
      for (const leaf of u.leaves) {
        const lr = placement.leafResults.get(leaf.key);
        const { m } = leafM(lr);
        if (leaf.kind === 'bedroom') { addCounts(m, 'bedroom', leaf.id); finish(m); const bn = node('bedroom', leaf.id, leaf.name); bn.metrics = m; bn.leaf = summarizeLeaf(lr, priorOf(leaf.key)); un.children.push(bn); }
        else un.leaf = summarizeLeaf(lr, priorOf(leaf.key));
        addMetrics(un.metrics, m);
      }
      addCounts(un.metrics, 'unit', u.id);
      finish(un.metrics); pn.children.push(un); addMetrics(pn.metrics, un.metrics);
    }
    if (p.ownLeaf) { const lr = placement.leafResults.get(p.ownLeaf.key); const { m } = leafM(lr); pn.leaf = summarizeLeaf(lr, priorOf(p.ownLeaf.key)); addMetrics(pn.metrics, m); }
    addCounts(pn.metrics, 'property', p.id);
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
/** What Leasing Details prints for a leaf: occupied by, lease type label (Whole House / Unit / Bedroom / Mixed / Vacant), term. */
export function leafTypeLabel(lr) {
  if (!lr || !lr.occupied) return 'Vacant';
  const types = [...new Set(lr.placements.map((p) => p.typeKey).filter(Boolean))];
  if (types.length > 1) return 'Mixed';
  return (LEASE_TYPES[types[0]] || {}).label || 'Unknown';
}
function summarizeLeaf(lr, plr) {
  return { occupied: lr.occupied, months: lr.months, monthly: lr.monthly, annual: lr.annual, people: lr.people, typeKey: lr.typeKey, typeLabel: leafTypeLabel(lr), start: lr.start || null, end: lr.end || null,
    leases: lr.placements.map((p) => p.leaseId), sequential: lr.sequential, carriedOnly: lr.carriedOnly, settleMonthly: lr.settleMonthly ?? null, targetMonthly: lr.targetMonthly ?? null, prevRentPerBed: lr.prevRentPerBed ?? null,
    sameStore: !!lr.sameStore, ssWhy: lr.ssWhy || null, prior: plr ? { occupied: plr.occupied, monthly: plr.monthly, leases: plr.placements.map((p) => p.leaseId) } : null };
}

/** Deltas for "versus last year" / "versus target" shown on the figures themselves (§6.2). */
export function compareMetrics(cur, prior) {
  const d = (k) => (cur[k] == null || !prior || prior[k] == null ? null : cur[k] - prior[k]);
  return { occupied: d('occupied'), occPct: d('occPct'), rentPerBed: d('rentPerBed'), monthly: d('monthly'), beds: d('beds'), people: d('people'), finOccPct: d('finOccPct'), annual: d('annual') };
}
