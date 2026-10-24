/**
 * The engine. Plain arrays in, plain objects out. No NetSuite, no DOM, no now().
 *
 * runEngine(fixture, { ay, basis, flags, today }) → { inventory, placement, rollup, exceptions, … }
 * fixture = { properties, units, leases, targets, academic_years, stage_rows, customers }
 */
import { DEFAULT_BASIS, FEATURE_FLAGS, leaseTypeKey, leaseStatusKey, foldStage } from '../constants.js';
import { buildInventory } from './inventory.js';
import { normalizeLease } from './lease.js';
import { placeLeases } from './placement.js';
import { rollup, applyTargets, compareMetrics } from './metrics.js';
import { ayYearFromLabel } from './dates.js';
import { leasingEvents, weeklyReport } from './weekly.js';

export { buildInventory, normalizeLease, placeLeases, rollup, weeklyReport, leasingEvents };

/** id → AY start year from the Academic Year list rows. */
export function ayLookup(academicYears = []) {
  const m = {};
  for (const a of academicYears) { const y = ayYearFromLabel(a.name); if (y != null && a.isinactive !== 'T') m[String(a.id)] = y; }
  return m;
}
/**
 * Build list-id → key maps from probed custom-list rows ({ listScriptId: [{id, name}] }).
 * Matching is by LABEL (constants.js), so a renumbered list never silently breaks a rule.
 * Unmatched values are reported so the probe write-up can surface them.
 */
export function lookupsFromLists(lists = {}) {
  const out = { leaseTypeIds: {}, leaseStatusIds: {}, stageIds: {}, unmatched: [] };
  for (const v of lists.customlist_serp_lease_type_list || []) { const k = leaseTypeKey(v.name, null); if (k) out.leaseTypeIds[String(v.id)] = k; else out.unmatched.push({ list: 'lease_type', ...v }); }
  for (const v of lists.customlist_serp_lease_status || []) { const k = leaseStatusKey(v.name, null); if (k && k !== 'OTHER') out.leaseStatusIds[String(v.id)] = k; else out.unmatched.push({ list: 'lease_status', ...v }); }
  for (const v of lists.customlist_ad_leasing_stage || []) { const k = foldStage(v.name, {}); if (k) out.stageIds[String(v.id)] = k; else out.unmatched.push({ list: 'leasing_stage', ...v }); }
  return out;
}

export function normalizeTargets(targets = [], ayYears = {}) {
  return targets.filter((t) => t.isinactive !== 'T').map((t) => ({ id: String(t.id), unitId: t.unit == null ? null : String(t.unit), propertyId: t.property == null ? null : String(t.property), ay: ayYears[String(t.ay)] ?? null, beds: t.beds ?? null, targetPerBed: t.target_per_bed ?? null, targetMonthly: t.target_monthly ?? null, prevYearPerBed: t.prev_year_per_bed ?? null }));
}

export function prepare(fixture, opts = {}) {
  const ayYears = ayLookup(fixture.academic_years);
  if (!opts.leaseTypeIds && fixture.lists) opts = { ...opts, ...lookupsFromLists(fixture.lists) };
  const inventory = buildInventory({ properties: fixture.properties, units: fixture.units }, opts);
  const leases = (fixture.leases || []).map((raw) => normalizeLease(raw, { ayYears, leaseTypeIds: opts.leaseTypeIds, leaseStatusIds: opts.leaseStatusIds }));
  const targets = normalizeTargets(fixture.targets, ayYears);
  return { inventory, leases, targets, ayYears };
}

export function runEngine(fixture, { ay, basis = DEFAULT_BASIS, flags = FEATURE_FLAGS, prepared = null, withPrior = true } = {}) {
  const prep = prepared || prepare(fixture);
  const run = (year) => {
    const placement = placeLeases({ inventory: prep.inventory, leases: prep.leases, ay: year, basis, flags });
    applyTargets(prep.inventory, placement.leafResults, prep.targets, year);
    const r = rollup(prep.inventory, placement);
    return { placement, ...r };
  };
  const cur = run(ay);
  const prior = withPrior ? run(ay - 1) : null;
  const comparison = prior ? {
    total: compareMetrics(cur.summary.student, prior.summary.student),
    byMarket: cur.summary.byMarketTotal.map((m) => ({ marketId: m.marketId, delta: compareMetrics(m.metrics, (prior.summary.byMarketTotal.find((x) => x.marketId === m.marketId) || {}).metrics) })),
  } : null;
  return { ay, basis, flags, inventory: prep.inventory, leases: prep.leases, targets: prep.targets, placement: cur.placement, tree: cur.tree, summary: cur.summary, exceptions: cur.placement.exceptions, tenantDoubles: cur.placement.tenantDoubles, prior: prior ? { summary: prior.summary, placement: prior.placement } : null, comparison };
}
