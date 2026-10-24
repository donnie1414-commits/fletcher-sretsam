/**
 * Summary extras (parity with the v2 Suitelet's Summary tab): KPI rows by market ▸ fund and fund ▸ market
 * with prior-year and "same date last year" pace, the lease-type table, vacancy counts, the ties check,
 * recent lease records, the short-term and commercial sections. Pure: takes an engine result.
 *
 *   summaryExtras(run, { keep, today, basis })
 *     keep(p)  — property-level predicate (scope ∩ selection); also called with { fund, marketId }
 */
import { LEASE_TYPES, LEASE_STATUSES, SEGMENTS, FUNDS } from '../constants.js';
import { emptyMetrics, addMetrics, finish, round } from './metrics.js';
import { ayStartDate, dayNum, addDays, daysBetween } from './dates.js';

const ratio = (a, b) => (b > 0 ? a / b : null);
const growth = (cur, prev) => (prev > 0 ? cur / prev - 1 : null);
const r2 = (v) => (v == null ? null : Number(Number(v).toFixed(2)));
export const fundLabel = (k) => (FUNDS[k] ? FUNDS[k].label : k === 'UNMAPPED' ? 'Unmapped fund' : k);
const mainSeg = (p) => !!p && (SEGMENTS[p.segment] || SEGMENTS.STUDENT).inOccupancy;

/** Date a lease is "counted" on for a basis (v2 rule): pro-forma = sent (fallback signed); executed = signed. */
export function leaseDateFor(lease, basis) { return basis === 'executed' ? lease.signedDate || null : lease.sentDate || lease.signedDate || null; }
export function propertyOf(run, r) { return run.inventory.propertiesById.get((r.scope && r.scope.propertyId) || r.lease.propertyId) || null; }
export function linkedName(run, r) {
  const s = r.scope || {};
  if (s.level === 'bedroom') { const b = run.inventory.bedroomsById.get(s.bedroomId); const u = b && run.inventory.unitsById.get(b.unitId); return b ? `${u ? u.name + ' › ' : ''}${b.name}` : ''; }
  if (s.level === 'unit') { const u = run.inventory.unitsById.get(s.unitId); return u ? u.name : ''; }
  if (r.lease.unitId) { const u = run.inventory.unitsById.get(r.lease.unitId) || run.inventory.bedroomsById.get(r.lease.unitId); return u ? u.name : `#${r.lease.unitId}`; }
  return '';
}
const typeLabel = (k) => (LEASE_TYPES[k] || {}).label || 'Unknown';
const statusLabel = (k) => (LEASE_STATUSES[k] || {}).label || '–';

/** Prior-year leases counted on or before the same point in last year's leasing cycle. */
export function paceCut(run, { today, basis }) {
  if (!run.prior || !today) return null;
  const shift = daysBetween(ayStartDate(run.ay - 1), ayStartDate(run.ay));
  const lyAsOf = addDays(today, -shift);
  const cut = dayNum(lyAsOf);
  const rows = [];
  for (const r of run.prior.placement.leaseResults.values()) {
    if (r.status !== 'placed') continue;
    const d = leaseDateFor(r.lease, basis);
    if (d && dayNum(d) <= cut) rows.push(r);
  }
  return { asOf: today, lyAsOf, shiftDays: shift, rows };
}
function paceFor(pace, run, pred) {
  if (!pace) return null;
  let occ = 0, trev = 0, leases = 0;
  for (const r of pace.rows) { const p = propertyOf(run.prior ? { inventory: run.inventory } : run, r); if (!mainSeg(p) || !pred(p, r)) continue; occ += r.coveredBeds; trev += r.year.revenue; leases += 1; }
  return { occ, trev: r2(trev), leases };
}

/** A KPI row from a metrics object (+ pace). Field names follow the v2 engine so the tables read the same. */
export function kpiRow(name, m, pace) {
  const occPct = ratio(m.occupied, m.beds);
  const wkOccPct = pace ? ratio(pace.occ, m.beds) : null;
  return {
    name, beds: m.beds, occ: m.occupied, vacant: m.beds - m.occupied, occPct, vacPct: ratio(m.beds - m.occupied, m.beds),
    finBeds: r2(m.bedMonths / 12), finPct: ratio(m.bedMonths / 12, m.beds),
    occWH: m.byType.WH, occUnit: m.byType.UNIT, occBed: m.byType.BED, people: m.people, leases: m.activeLeases, excluded: m.excludedLeases,
    mrev: r2(m.monthly), trev: r2(m.annual), rentBed: ratio(m.monthly, m.occupied), rentPerson: ratio(m.monthly, m.people),
    pOcc: m.pOccupied, pVacant: m.beds - m.pOccupied, pOccPct: ratio(m.pOccupied, m.beds), occDelta: occPct != null && m.beds ? occPct - m.pOccupied / m.beds : null,
    pFinPct: ratio(m.pBedMonths / 12, m.beds), pPeople: m.pPeople, pLeases: m.pActiveLeases, pMrev: r2(m.pMonthly), pTrev: r2(m.pAnnual),
    mrevYoY: growth(m.monthly, m.pMonthly), trevYoY: growth(m.annual, m.pAnnual), pRentBed: ratio(m.pMonthly, m.pOccupied),
    rentBedYoY: m.occupied > 0 && m.pOccupied > 0 ? growth(m.monthly / m.occupied, m.pMonthly / m.pOccupied) : null,
    ssBeds: m.ssBeds, ssCur: r2(m.ssCur), ssPrior: r2(m.ssPrior), ssYoY: growth(m.ssCur, m.ssPrior),
    tgt: r2(m.targetMonthly), tgtBeds: m.targetBeds, tgtBed: ratio(m.targetMonthly, m.targetBeds), tgtOcc: r2(m.targetOcc), tgtVacant: r2(m.targetMonthly - m.targetOcc), actVsTgt: m.targetOcc > 0 ? m.monthlyOnTarget / m.targetOcc - 1 : null,
    settle: r2(m.settleMonthly), prevRentBed: ratio(m.prevRentSum, m.prevRentBeds),
    lyWkOcc: pace ? pace.occ : null, lyWkOccPct: wkOccPct, lyWkDelta: pace && occPct != null && wkOccPct != null ? occPct - wkOccPct : null, lyWkLeases: pace ? pace.leases : null, lyWkTrev: pace ? pace.trev : null, trevPace: pace ? growth(m.annual, pace.trev) : null,
  };
}


/** Excluded leases grouped by reason, ranked by what they cost ("Excluded from the leasing numbers"). */
export function blockingByReason(run, { keep = () => true } = {}) {
  const byReason = new Map();
  for (const r of run.placement.leaseResults.values()) {
    if (r.status !== 'excluded') continue;
    const p = propertyOf(run, r); if (p && (!mainSeg(p) || !keep(p))) continue; if (!p && !keep({ fund: null, marketId: 'unknown' })) continue;
    const g = byReason.get(r.code) || { code: r.code, leases: 0, beds: 0, people: 0, mrev: 0, trev: 0, rows: [] };
    g.leases += 1; g.beds += r.coveredBeds || 0; g.people += r.lease.tenantCount; g.mrev += r.lease.monthlyRent; g.trev += r.year.revenue;
    g.rows.push({ id: r.lease.id, name: r.lease.name, market: p ? p.marketLabel : '', property: p ? p.name : '', propertyId: p ? p.id : null, linked: linkedName(run, r), type: typeLabel(r.lease.typeKey), status: r.lease.statusKey, start: r.lease.start, end: r.lease.end, beds: r.coveredBeds || 0, people: r.lease.tenantCount, mrev: r.lease.monthlyRent, trev: r2(r.year.revenue), partners: r.partners || [] });
    byReason.set(r.code, g);
  }
  const blocking = [...byReason.values()].map((g) => ({ ...g, mrev: r2(g.mrev), trev: r2(g.trev) })).sort((a, b) => b.trev - a.trev || b.leases - a.leases);
  const blockingTotal = blocking.reduce((t, g) => ({ leases: t.leases + g.leases, beds: t.beds + g.beds, people: t.people + g.people, mrev: r2(t.mrev + g.mrev), trev: r2(t.trev + g.trev) }), { leases: 0, beds: 0, people: 0, mrev: 0, trev: 0 });
  return { blocking, blockingTotal };
}

export function summaryExtras(run, { keep = () => true, today = null, basis = run.basis } = {}) {
  const inv = run.inventory;
  const pace = paceCut(run, { today, basis });
  const cells = run.summary.byMarket.filter((c) => keep({ fund: c.fund, marketId: c.marketId }));
  const sum = (list) => finish(list.reduce((m, c) => addMetrics(m, c.metrics), emptyMetrics()));
  const total = sum(cells);
  const byFundKeys = [...new Set(cells.map((c) => c.fund))].sort();
  const byMarketKeys = [...new Set(cells.map((c) => c.marketId))].sort((a, b) => a.localeCompare(b));
  const mkName = (id) => (cells.find((c) => c.marketId === id) || {}).market || id;
  const row = (name, list, pred) => kpiRow(name, sum(list), paceFor(pace, run, pred));
  const kpi = {
    total: row('Total', cells, () => true),
    byFund: byFundKeys.map((f) => ({ key: f, row: row(fundLabel(f), cells.filter((c) => c.fund === f), (p) => p.fund === f),
      children: byMarketKeys.filter((m) => cells.some((c) => c.fund === f && c.marketId === m)).map((m) => row(mkName(m), cells.filter((c) => c.fund === f && c.marketId === m), (p) => p.fund === f && p.marketId === m)) })),
    byMarket: byMarketKeys.map((m) => ({ key: m, row: row(mkName(m), cells.filter((c) => c.marketId === m), (p) => p.marketId === m),
      children: byFundKeys.filter((f) => cells.some((c) => c.fund === f && c.marketId === m)).map((f) => row(fundLabel(f), cells.filter((c) => c.fund === f && c.marketId === m), (p) => p.fund === f && p.marketId === m)) })),
  };

  // lease-level sets in scope (main segment only; STR and commercial have their own blocks)
  const results = [...run.placement.leaseResults.values()].filter((r) => { const p = propertyOf(run, r); return p && mainSeg(p) && keep(p); });
  const placed = results.filter((r) => r.status === 'placed');
  const excluded = results.filter((r) => r.status === 'excluded');
  const priorPlaced = run.prior ? [...run.prior.placement.leaseResults.values()].filter((r) => r.status === 'placed' && (() => { const p = propertyOf(run, r); return p && mainSeg(p) && keep(p); })()) : [];

  const byLeaseType = ['WH', 'UNIT', 'BED'].map((type) => {
    const list = placed.filter((r) => r.lease.typeKey === type);
    const occ = list.reduce((s, r) => s + r.coveredBeds, 0);
    const fin = list.reduce((s, r) => s + (r.coveredBeds * Math.min(r.year.months, 12)) / 12, 0);
    const people = list.reduce((s, r) => s + r.lease.tenantCount, 0);
    const mrev = list.reduce((s, r) => s + r.lease.monthlyRent, 0);
    const trev = list.reduce((s, r) => s + r.year.revenue, 0);
    const plist = priorPlaced.filter((r) => r.lease.typeKey === type);
    const pOcc = plist.reduce((s, r) => s + r.coveredBeds, 0), pMrev = plist.reduce((s, r) => s + r.lease.monthlyRent, 0), pTrev = plist.reduce((s, r) => s + r.year.revenue, 0);
    const tp = paceFor(pace, run, (p, r) => r.lease.typeKey === type);
    const occPct = ratio(occ, total.beds), pOccPct = run.prior ? ratio(pOcc, total.beds) : null;
    return { key: type, name: typeLabel(type), occ, occShare: ratio(occ, total.occupied), occPct, finBeds: r2(fin), finPct: ratio(fin, total.beds), leases: list.length, people, mrev: r2(mrev), trev: r2(trev), rentBed: ratio(mrev, occ), rentPerson: ratio(mrev, people),
      excluded: excluded.filter((r) => r.lease.typeKey === type).length, pOcc: run.prior ? pOcc : null, pOccPct, occDelta: pOccPct != null && occPct != null ? occPct - pOccPct : null, pLeases: run.prior ? plist.length : null, pMrev: run.prior ? r2(pMrev) : null, mrevYoY: run.prior ? growth(mrev, pMrev) : null, pTrev: run.prior ? r2(pTrev) : null, trevYoY: run.prior ? growth(trev, pTrev) : null,
      lyWkOcc: tp ? tp.occ : null, lyWkOccPct: tp ? ratio(tp.occ, total.beds) : null, lyWkDelta: tp && occPct != null ? occPct - (ratio(tp.occ, total.beds) || 0) : null, lyWkTrev: tp ? tp.trev : null, trevPace: tp ? growth(trev, tp.trev) : null, pRentBed: run.prior ? ratio(pMrev, pOcc) : null };
  });

  // ties: the allocated totals must come back to the counted leases (people allow for sequential tenancies: one bed, one person at a time)
  const leasePeople = placed.reduce((s, r) => s + r.lease.tenantCount, 0);
  const leaseMrev = placed.reduce((s, r) => s + r.lease.monthlyRent, 0);
  const leaseTrev = placed.reduce((s, r) => s + r.year.revenue, 0);
  let stackedPeople = 0, stackedLeaves = 0;
  for (const lr of run.placement.leafResults.values()) {
    if (lr.placements.length < 2) continue;
    const p = inv.propertiesById.get(lr.leaf.propertyId); if (!p || !mainSeg(p) || !keep(p)) continue;
    stackedLeaves += 1; stackedPeople += lr.placements.reduce((s, x) => s + x.people, 0) - (lr.primary ? lr.primary.people : 0);
  }
  const ties = { people: leasePeople - stackedPeople === total.people, mrev: Math.abs(leaseMrev - total.monthly) < 0.05, trev: Math.abs(leaseTrev - total.annual) < 0.05, leasePeople, leaseMrev: r2(leaseMrev), leaseTrev: r2(leaseTrev), stackedPeople, stackedLeaves };

  // vacancy counts at unit level
  const vacancy = { fullUnits: 0, fullBeds: 0, partUnits: 0, partBeds: 0 };
  for (const u of inv.unitNodes) {
    const p = inv.propertiesById.get(u.propertyId); if (!p || !mainSeg(p) || !keep(p)) continue;
    const occ = u.leaves.reduce((s, l) => s + ((run.placement.leafResults.get(l.key) || {}).occupied || 0), 0);
    if (u.beds > 0 && occ === 0) { vacancy.fullUnits += 1; vacancy.fullBeds += u.beds; } else if (u.beds > occ) { vacancy.partUnits += 1; vacancy.partBeds += u.beds - occ; }
  }

  // recent lease records (all academic years, last 3 days)
  const recent = [];
  if (today) {
    const since = addDays(today, -3);
    for (const l of run.leases) {
      if (l.inactive || !l.created || dayNum(l.created) < dayNum(since)) continue;
      const p = inv.propertiesById.get(l.propertyId); if (!p || !keep(p)) continue;
      const linked = l.unitId ? (inv.unitsById.get(l.unitId) || inv.bedroomsById.get(l.unitId) || {}).name || `#${l.unitId}` : '';
      const ayYear = l.years.length ? l.years[0].ay : (l.ayFieldYear ?? null);
      recent.push({ id: l.id, name: l.name, ay: ayYear != null ? `AY ${ayYear}-${ayYear + 1}` : '', status: statusLabel(l.statusKey), fund: fundLabel(p.fund), market: p.marketLabel, property: p.name, propertyId: p.id, linked, type: typeLabel(l.typeKey), people: l.tenantCount, mrev: l.monthlyRent, sent: l.sentDate, signed: l.signedDate, created: l.created });
    }
    recent.sort((a, b) => String(b.created).localeCompare(String(a.created)) || Number(b.id) - Number(a.id));
  }

  // property nodes (for counts, STR and commercial tables)
  const propNodes = [];
  for (const f of run.tree) for (const mk of f.children) for (const pn of mk.children) { const p = inv.propertiesById.get(pn.id); if (p && keep(p)) propNodes.push({ pn, p }); }
  const emptyParent = ({ pn }) => pn.isParent && !pn.metrics.beds && !pn.metrics.activeLeases && !pn.metrics.excludedLeases;
  const propertyCount = propNodes.filter((x) => mainSeg(x.p) && !emptyParent(x)).length;
  const strNodes = propNodes.filter((x) => x.p.segment === 'STR' && !emptyParent(x));
  const strTotal = finish(strNodes.reduce((m, x) => addMetrics(m, x.pn.metrics), emptyMetrics()));
  const str = { properties: strNodes.length, leases: strTotal.activeLeases, excluded: strTotal.excludedLeases, total: kpiRow('Short-term rentals', strTotal, null),
    rows: strNodes.map((x) => ({ ...kpiRow(x.p.name, x.pn.metrics, null), id: x.p.id, market: x.p.marketLabel, fund: fundLabel(x.p.fund) })).sort((a, b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name, undefined, { numeric: true })) };
  const comNodes = propNodes.filter((x) => x.p.segment === 'COMMERCIAL');
  const comRows = comNodes.map(({ pn, p }) => {
    const mine = [...run.placement.leaseResults.values()].filter((r) => r.status === 'placed' && (r.scope.propertyId || r.lease.propertyId) === p.id);
    const monthly = mine.reduce((s, r) => s + r.lease.monthlyRent, 0);
    return { id: p.id, name: p.name, market: p.marketLabel, fund: fundLabel(p.fund), leases: mine.length, status: mine.length ? 'Leased' : 'Vacant', monthly: r2(monthly), annual: r2(monthly * 12),
      start: mine.reduce((d, r) => (r.lease.start && (!d || r.lease.start < d) ? r.lease.start : d), null), end: mine.reduce((d, r) => (r.lease.end && (!d || r.lease.end > d) ? r.lease.end : d), null) };
  }).sort((a, b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const comMonthly = comRows.reduce((s, r) => s + r.monthly, 0);
  const commercial = { properties: comRows.length, leased: comRows.filter((r) => r.leases).length, vacant: comRows.filter((r) => !r.leases).length, leases: comRows.reduce((s, r) => s + r.leases, 0), monthly: r2(comMonthly), annual: r2(comMonthly * 12), rows: comRows };

  const { blocking, blockingTotal } = blockingByReason(run, { keep });

  return { pace: pace ? { asOf: pace.asOf, lyAsOf: pace.lyAsOf, shiftDays: pace.shiftDays } : null, kpi, byLeaseType, ties, vacancy, recent, recentSince: today ? addDays(today, -3) : null, str, commercial, blocking, blockingTotal, propertyCount, marketCount: byMarketKeys.length, inScopeLeases: results.length, sameStore: run.sameStore || null };
}

/**
 * Velocity: counted leases by days from the AY start, for the selected AY and up to `maxPrior` earlier ones,
 * on both bases. Rows are compact arrays the client aggregates by filter:
 *   [ayIndex, daysFromAyStart, beds, monthlyRent, fund, marketId, leaseType]
 */
export function velocity(runsByAy, { ays, keep = () => true }) {
  const out = { ays: [], proforma: [], executed: [], beds: {} };
  ays.forEach((a, yi) => {
    out.ays.push({ year: a.year, id: a.id || null, label: a.label || `AY ${a.year}-${a.year + 1}`, start: a.start || ayStartDate(a.year), selected: yi === 0 });
    for (const basis of ['proforma', 'executed']) {
      const run = runsByAy[`${a.year}:${basis}`]; if (!run) continue;
      const start = dayNum(a.start || ayStartDate(a.year));
      for (const r of run.placement.leaseResults.values()) {
        if (r.status !== 'placed' || r.year.carried) continue;
        const p = propertyOf(run, r); if (!p || !mainSeg(p) || !keep(p)) continue;
        const d = leaseDateFor(r.lease, basis); if (!d) continue;
        out[basis].push([yi, dayNum(d) - start, r.coveredBeds, r2(r.lease.monthlyRent), p.fund, p.marketId, r.lease.typeKey]);
      }
    }
  });
  const first = runsByAy[`${ays[0].year}:proforma`] || runsByAy[`${ays[0].year}:executed`];
  if (first) for (const p of first.inventory.propertiesById.values()) { if (!mainSeg(p) || !keep(p)) continue; const k = `${p.fund}|${p.marketId}`; out.beds[k] = (out.beds[k] || 0) + p.beds; }
  return out;
}
export { round };
