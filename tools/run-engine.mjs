#!/usr/bin/env node
// Run the engine over a fixture directory and print the Summary by market for 3 AYs × 2 bases.
import fs from 'node:fs';
import path from 'node:path';
import { prepare, runEngine } from '../src/shared/rules/index.js';
const dir = process.argv[2] || 'test/fixtures/live';
const overlap = process.argv.includes('--overlap');
const load = (n) => { const p = path.join(dir, n + '.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; };
const fixture = { properties: load('properties'), units: load('units'), leases: load('leases'), targets: load('targets'), academic_years: load('academic_years'), lists: fs.existsSync(path.join(dir, 'lists.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'lists.json'), 'utf8')) : null };
const prep = prepare(fixture);
const inv = prep.inventory;
console.log(`properties=${inv.propertiesById.size} units=${inv.unitsById.size} bedrooms=${inv.bedroomsById.size} leaves=${inv.leaves.length} unitNodes=${inv.unitNodes.length} beds=${inv.leaves.reduce((s, l) => s + l.beds, 0)} issues=${inv.issues.length}`);
const issueCounts = {}; for (const i of inv.issues) issueCounts[i.code] = (issueCounts[i.code] || 0) + 1; console.log('inventory issues', issueCounts);
const pct = (x) => (x == null ? '   -  ' : (x * 100).toFixed(1).padStart(5) + '%');
for (const ay of [2026, 2027, 2028]) for (const basis of ['proforma', 'executed']) {
  const r = runEngine(fixture, { ay, basis, prepared: prep, withPrior: false, flags: { requireOverlapForCollision: overlap } });
  const s = r.summary.student;
  console.log(`\nAY ${ay}-${ay + 1} ${basis}${overlap ? ' [overlap rule]' : ''}: beds=${s.beds} occupied=${s.occupied} occ=${pct(s.occPct)} finOcc=${pct(s.finOccPct)} monthly=${Math.round(s.monthly)} annual=${Math.round(s.annual)} people=${s.people} rent/bed=${s.rentPerBed?.toFixed(0)} byType=${JSON.stringify(s.byType)} | STR beds=${r.summary.str.beds} | commercial monthly=${Math.round(r.summary.commercial.monthly)} | counted=${r.placement.counted} placed=${r.placement.placed}`);
  for (const m of r.summary.byMarketTotal.sort((a, b) => a.market.localeCompare(b.market))) console.log(`   ${m.market.padEnd(12)} beds=${String(m.metrics.beds).padStart(5)} occ=${String(m.metrics.occupied).padStart(5)} ${pct(m.metrics.occPct)} fin=${pct(m.metrics.finOccPct)} monthly=${String(Math.round(m.metrics.monthly)).padStart(8)} rent/bed=${(m.metrics.rentPerBed || 0).toFixed(0).padStart(5)} people=${m.metrics.people}`);
  const ex = {}; for (const e of r.exceptions) ex[e.code] = (ex[e.code] || 0) + 1; console.log('   exceptions', JSON.stringify(ex), 'tenantDoubles', r.tenantDoubles.length);
}
