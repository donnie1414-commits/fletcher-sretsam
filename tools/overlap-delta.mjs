#!/usr/bin/env node
/**
 * §5.7.1 / §8.4 — before/after delta of the overlap rule, by market and AY, both bases.
 * Writes docs/OVERLAP-DELTA.md and prints it. Nothing here changes the default flag.
 */
import fs from 'node:fs';
import { loadFixture, defaultFixtureDir } from '../src/shared/rules/fixture-io.js';
import { prepare, runEngine } from '../src/shared/rules/index.js';

const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : defaultFixtureDir();
const fixture = loadFixture(dir);
const prep = prepare(fixture);
const pct = (x) => (x == null ? '–' : (x * 100).toFixed(1) + '%');
const money = (x) => '$' + Math.round(x).toLocaleString('en-US');
const sign = (x, f = (v) => v) => (x > 0 ? '+' : '') + f(x);
const lines = [];
lines.push(`# Overlap rule (§5.7.1) — before / after delta`, '', `Fixture: \`${dir}\` pulled ${fixture.manifest?.pulledAt || 'unknown'}. Tolerance: 7 days. Generated ${new Date().toISOString().slice(0, 10)}.`, '',
  'Before = today\'s rule (any two leases on one scope in one AY collide, both excluded). After = collisions require date overlap; overlaps ≤ 7 days are tolerated as turnover and both leases count once; sequential leases sum revenue and cap months at 12.', '');
const totals = [];
for (const ay of [2026, 2027, 2028]) for (const basis of ['proforma', 'executed']) {
  const before = runEngine(fixture, { ay, basis, prepared: prep, withPrior: false, flags: { requireOverlapForCollision: false } });
  const after = runEngine(fixture, { ay, basis, prepared: prep, withPrior: false, flags: { requireOverlapForCollision: true } });
  const b = before.summary.student, a = after.summary.student;
  lines.push(`## AY ${ay}-${ay + 1} · ${basis === 'proforma' ? 'Pro-forma' : 'Fully Executed'}`, '');
  lines.push('| Market | Beds | Occupied before | after | Δ beds | Occ % before | after | Monthly before | after | Δ monthly | Annual Δ |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const bm = new Map(before.summary.byMarketTotal.map((m) => [m.marketId, m])), am = new Map(after.summary.byMarketTotal.map((m) => [m.marketId, m]));
  for (const id of [...bm.keys()].sort()) { const x = bm.get(id).metrics, y = am.get(id).metrics; if (x.occupied === y.occupied && Math.abs(x.monthly - y.monthly) < 0.5) continue; lines.push(`| ${bm.get(id).market} | ${x.beds} | ${x.occupied} | ${y.occupied} | ${sign(y.occupied - x.occupied)} | ${pct(x.occPct)} | ${pct(y.occPct)} | ${money(x.monthly)} | ${money(y.monthly)} | ${sign(y.monthly - x.monthly, money)} | ${sign(y.annual - x.annual, money)} |`); }
  lines.push(`| **Portfolio** | ${b.beds} | ${b.occupied} | ${a.occupied} | ${sign(a.occupied - b.occupied)} | ${pct(b.occPct)} | ${pct(a.occPct)} | ${money(b.monthly)} | ${money(a.monthly)} | ${sign(a.monthly - b.monthly, money)} | ${sign(a.annual - b.annual, money)} |`, '');
  const cnt = (r) => { const o = {}; for (const e of r.exceptions) o[e.code] = (o[e.code] || 0) + 1; return o; };
  const cb = cnt(before), ca = cnt(after);
  const codes = [...new Set([...Object.keys(cb), ...Object.keys(ca)])].sort();
  lines.push('| Exception | before | after |', '|---|---:|---:|');
  for (const c of codes) lines.push(`| ${c} | ${cb[c] || 0} | ${ca[c] || 0} |`);
  lines.push(`| tenants flagged double-booked | ${before.tenantDoubles.length} | ${after.tenantDoubles.length} |`, '');
  // which leases changed status
  const changed = [];
  for (const [id, rb] of before.placement.leaseResults) { const ra = after.placement.leaseResults.get(id); if (rb.status !== ra.status || rb.code !== ra.code) changed.push({ id, name: rb.lease.name, before: rb.code || rb.status, after: ra.code || ra.status, start: rb.lease.start, end: rb.lease.end, beds: rb.coveredBeds, monthly: rb.lease.monthlyRent, flagsAfter: ra.flags.join('+') }); }
  if (changed.length) { lines.push(`<details><summary>${changed.length} leases change status</summary>`, '', '| Lease | Dates | Beds | Monthly | Before | After |', '|---|---|---:|---:|---|---|'); for (const c of changed) lines.push(`| ${c.name} (${c.id}) | ${c.start} → ${c.end} | ${c.beds} | ${money(c.monthly)} | ${c.before} | ${c.after}${c.flagsAfter ? ' ' + c.flagsAfter : ''} |`); lines.push('', '</details>', ''); }
  totals.push({ ay, basis, dOcc: a.occupied - b.occupied, dMonthly: a.monthly - b.monthly, dAnnual: a.annual - b.annual, doublesBefore: before.tenantDoubles.length, doublesAfter: after.tenantDoubles.length });
}
lines.push('## Summary', '', '| AY | Basis | Δ occupied beds | Δ monthly | Δ annual | Double-booked tenants before → after |', '|---|---|---:|---:|---:|---|');
for (const t of totals) lines.push(`| ${t.ay}-${t.ay + 1} | ${t.basis} | ${sign(t.dOcc)} | ${sign(t.dMonthly, money)} | ${sign(t.dAnnual, money)} | ${t.doublesBefore} → ${t.doublesAfter} |`);
lines.push('', '**Sign-off:** ☐ approved to make `requireOverlapForCollision: true` the default (constants.js FEATURE_FLAGS). Not shipped until this box is ticked by Amicus.', '');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/OVERLAP-DELTA.md', lines.join('\n'));
console.log(lines.join('\n'));
