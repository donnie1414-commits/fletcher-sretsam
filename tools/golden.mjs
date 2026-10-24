#!/usr/bin/env node
/**
 * Golden tie-out: run the engine over a fixture for three academic years × both
 * bases and write/compare the totals at every level.
 *   node tools/golden.mjs                    → compare against test/golden/<fixture>.json (exit 1 on drift)
 *   node tools/golden.mjs --write "reason"   → (re)write the golden file, recording the reason
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadFixture, defaultFixtureDir } from '../src/shared/rules/fixture-io.js';
import { prepare, runEngine } from '../src/shared/rules/index.js';
import { round } from '../src/shared/rules/metrics.js';

export const GOLDEN_AYS = [2026, 2027, 2028];
export const GOLDEN_BASES = ['proforma', 'executed'];

export function computeGolden(fixture, flags = { requireOverlapForCollision: false }) {
  const prep = prepare(fixture);
  const inv = prep.inventory;
  const g = { inventory: { properties: inv.propertiesById.size, units: inv.unitsById.size, bedrooms: inv.bedroomsById.size, leaves: inv.leaves.length, pipelineRows: inv.unitNodes.length, beds: inv.leaves.reduce((s, l) => s + l.beds, 0), issues: countBy(inv.issues, (i) => i.code) }, flags, runs: {} };
  for (const ay of GOLDEN_AYS) for (const basis of GOLDEN_BASES) {
    const r = runEngine(fixture, { ay, basis, prepared: prep, withPrior: false, flags });
    const pick = (m) => { const x = round(m, 2); return { beds: x.beds, occupied: x.occupied, occPct: x.occPct, finOccPct: x.finOccPct, monthly: x.monthly, annual: x.annual, people: x.people, rentPerBed: x.rentPerBed, byType: x.byType, carriedBeds: x.carriedBeds, targetMonthly: x.targetMonthly }; };
    g.runs[`${ay}:${basis}`] = {
      student: pick(r.summary.student), str: pick(r.summary.str), commercial: { monthly: round(r.summary.commercial).monthly, annual: round(r.summary.commercial).annual },
      byFund: Object.fromEntries(r.summary.byFund.map((f) => [f.fund, pick(f.metrics)])),
      byMarket: Object.fromEntries(r.summary.byMarketTotal.map((m) => [m.marketId, pick(m.metrics)])),
      byFundMarket: Object.fromEntries(r.summary.byMarket.map((m) => [`${m.fund}:${m.marketId}`, { beds: m.metrics.beds, occupied: m.metrics.occupied }])),
      counted: r.placement.counted, placed: r.placement.placed, exceptions: countBy(r.exceptions, (e) => e.code), tenantDoubles: r.tenantDoubles.length,
      pipeline: pipelineBeds(r.inventory),
    };
  }
  return g;
}
/** Pipeline rows come from the same inventory as the KPI figures (§6.3 invariant): split their beds by segment. */
function pipelineBeds(inv) {
  const out = { rows: inv.unitNodes.length, bedsStudent: 0, bedsStr: 0, bedsCommercial: 0 };
  for (const u of inv.unitNodes) { const seg = inv.propertiesById.get(u.propertyId)?.segment; if (seg === 'STR') out.bedsStr += u.beds; else if (seg === 'COMMERCIAL') { out.bedsCommercial += u.beds; out.rows -= 1; } else out.bedsStudent += u.beds; }
  return out;
}
function countBy(arr, f) { const o = {}; for (const x of arr) { const k = f(x); o[k] = (o[k] || 0) + 1; } return Object.fromEntries(Object.entries(o).sort()); }

export function diffGolden(expected, actual, tol = 0.011) {
  const diffs = [];
  (function walk(e, a, p) {
    if (typeof e === 'number' || typeof a === 'number') { if (e == null || a == null || Math.abs(e - a) > tol) diffs.push(`${p}: expected ${e} got ${a}`); return; }
    if (e == null || a == null || typeof e !== 'object') { if (e !== a) diffs.push(`${p}: expected ${JSON.stringify(e)} got ${JSON.stringify(a)}`); return; }
    for (const k of new Set([...Object.keys(e), ...Object.keys(a)])) walk(e[k], a[k], p ? `${p}.${k}` : k);
  })(expected, actual, '');
  return diffs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = defaultFixtureDir();
  if (!dir) { console.error('no fixture found'); process.exit(2); }
  const fixture = loadFixture(dir);
  const name = path.basename(dir) === 'live' ? (fixture.manifest?.pulledAt || 'live').slice(0, 10) : path.basename(dir).replace(/^snapshot-/, '');
  const goldenPath = path.join('test/golden', `snapshot-${name}.json`);
  const actual = computeGolden(fixture);
  const wi = process.argv.indexOf('--write');
  if (wi > -1) {
    const reason = process.argv[wi + 1] || '(no reason given)';
    const prev = fs.existsSync(goldenPath) ? JSON.parse(fs.readFileSync(goldenPath, 'utf8')) : null;
    const history = (prev?.history || []).concat([{ at: new Date().toISOString(), reason }]);
    fs.mkdirSync('test/golden', { recursive: true });
    fs.writeFileSync(goldenPath, JSON.stringify({ fixture: path.basename(dir), history, ...actual }, null, 1));
    console.log(`wrote ${goldenPath} — ${reason}`);
  } else {
    if (!fs.existsSync(goldenPath)) { console.error(`no golden file ${goldenPath}; run with --write "reason"`); process.exit(2); }
    const { history, fixture: _f, ...expected } = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const diffs = diffGolden(expected, actual);
    if (diffs.length) { console.error(`GOLDEN DRIFT (${diffs.length}):\n  ` + diffs.slice(0, 40).join('\n  ')); process.exit(1); }
    console.log(`golden tie-out OK against ${goldenPath}`);
  }
}
