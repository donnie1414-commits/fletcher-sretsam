#!/usr/bin/env node
/**
 * Build the off-NetSuite preview: the real client bundle plus every JSON route precomputed from a
 * snapshot by the real server code (routes → engine) through a fake N/query. Output: dist/preview/.
 *   node tools/preview.mjs [fixture-dir] [--today=YYYY-MM-DD]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { loadFixture, defaultFixtureDir } from '../src/shared/rules/fixture-io.js';
import { fakeQuery } from './fake-netsuite.mjs';
import { fakeRuntime, fakeLog } from '../test/server/fakes.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || defaultFixtureDir();
const fixture = loadFixture(dir);
const today = (args.find((a) => a.startsWith('--today=')) || `--today=${(fixture.manifest?.pulledAt || fixture.manifest?.redactedAt || new Date().toISOString()).slice(0, 10)}`).slice(8);
// pin "today" for the preview so weekly panels are reproducible
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(`${today}T12:00:00Z`); } static now() { return new RealDate(`${today}T12:00:00Z`).getTime(); } };

const out = 'dist/preview'; fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'data'), { recursive: true });
const app = createApp({ query: fakeQuery(fixture), record: {}, runtime: fakeRuntime({ roleId: 3 }), log: fakeLog, file: { load: () => { throw new Error('preview'); } }, cache: null });
const call = (params, method = 'GET', body = null) => { let text = ''; app.handle({ request: { parameters: params, method, body, headers: { 'X-Requested-With': 'AmicusLeasing' } }, response: { write: (s) => { text += s; }, setHeader() {} } }); return text; };
const write = (name, obj) => fs.writeFileSync(path.join(out, 'data', `${name}.json`), JSON.stringify(obj));
const files = [];
const shell = call({});
const boot = JSON.parse(/<script type="application\/json" id="al-bootstrap">([\s\S]*?)<\/script>/.exec(shell)[1]);
boot.snapshotDate = today; boot.session.name = 'Preview (administrator scope)';
write('bootstrap', boot); files.push('bootstrap');
write('lists', JSON.parse(call({ route: 'lists' }))); files.push('lists');
const combos = []; let previewWeeks = [];
for (const ay of boot.academicYears.map((a) => a.year).filter((y) => y >= 2026 && y <= 2029)) for (const basis of ['proforma', 'executed']) {
  const combo = `${ay}-${basis}`; combos.push(combo);
  for (const route of ['summary', 'portfolio', 'weekly', 'exceptions', 'today', 'velocity']) { const j = JSON.parse(call({ route, ay: String(ay), basis })); j.currentAy = boot.currentAy; write(`${route}-${combo}`, j); files.push(`${route}-${combo}`); }
  // the weekly tab's week picker: the current week and the three before it, by market and by fund
  const wk = JSON.parse(call({ route: 'weekly', ay: String(ay), basis }));
  const weeks = wk.weekOptions.slice(0, 4).map((o) => o.value);
  for (const w of weeks) for (const groupBy of ['market', 'fund']) { const name = `weekly-${combo}${groupBy === 'fund' ? '-fund' : ''}-${w}`; write(name, JSON.parse(call({ route: 'weekly', ay: String(ay), basis, week: w, groupBy }))); files.push(name); }
  write(`weekly-${combo}-fund`, JSON.parse(call({ route: 'weekly', ay: String(ay), basis, groupBy: 'fund' }))); files.push(`weekly-${combo}-fund`);
  previewWeeks = weeks;
  const first = JSON.parse(call({ route: 'pipeline', ay: String(ay), basis, pageSize: '500' }));
  const rows = [...first.rows]; for (let pg = 1; pg * 500 < first.total; pg++) rows.push(...JSON.parse(call({ route: 'pipeline', ay: String(ay), basis, pageSize: '500', page: String(pg) })).rows);
  write(`pipeline-${combo}`, { ...first, rows, page: 0 }); files.push(`pipeline-${combo}`);
  console.log(`${combo}: pipeline ${rows.length} rows`);
}
// tenants: the full active set (the shim filters/pages client-side with the shared helper)
const t0 = JSON.parse(call({ route: 'tenants', view: 'all', pageSize: '500' }));
const trows = [...t0.rows]; for (let pg = 1; pg * 500 < t0.total; pg++) trows.push(...JSON.parse(call({ route: 'tenants', view: 'all', pageSize: '500', page: String(pg) })).rows);
write('tenants', { ...t0, rows: trows, page: 0 }); files.push('tenants'); console.log(`tenants ${trows.length} rows`);
fs.copyFileSync('dist/amicus_leasing_app.js', path.join(out, 'app.js')); fs.copyFileSync('dist/amicus_leasing_app.css', path.join(out, 'app.css'));
const bootJson = JSON.stringify(boot).replace(/<\/(script)/gi, '<\\/$1');
const html = `<title>Amicus Leasing</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="app.css">
<style>.pv-note{position:fixed;left:0;right:0;bottom:0;z-index:30;font:12px system-ui,sans-serif;padding:6px max(16px, env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) max(16px, env(safe-area-inset-left,0px));background:var(--bg-sunken);color:var(--fg-muted);border-top:1px solid var(--rule)}</style>
<div id="root"></div>
<div class="pv-note">Preview of the rebuilt workspace running the real engine over the NetSuite snapshot of ${today} (people redacted). Nothing here writes to NetSuite.</div>
<script type="application/json" id="al-bootstrap">${bootJson}</script>
<script>window.__AL_PREVIEW = ${JSON.stringify({ base: 'data/', files, combos, weeks: previewWeeks.slice().sort(), defaultAy: boot.defaultAy })};</script>
<script src="app.js"></script>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'standalone.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${html}</head><body></body></html>`.replace('</head><body>', '</head><body>').replace(/<div id="root">[\s\S]*$/, (m) => m));
let total = 0; for (const f of fs.readdirSync(path.join(out, 'data'))) total += fs.statSync(path.join(out, 'data', f)).size;
console.log(`preview written to ${out}: ${files.length} data files, ${(total / 1024 / 1024).toFixed(1)} MB data, app.js ${(fs.statSync(path.join(out, 'app.js')).size / 1024).toFixed(0)} KB`);
