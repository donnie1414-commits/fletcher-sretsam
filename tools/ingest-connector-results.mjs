#!/usr/bin/env node
/**
 * Assemble fixture tables from NetSuite MCP connector result files.
 *
 * The connector saves every large SuiteQL result to a .txt file holding one JSON
 * object: { queryExecuted, resultCount, totalResults, data, pageSize, pageIndex,
 * numberOfPages }. This script groups those files by query, checks that every
 * page is present and the row counts add up, and writes one JSON array per
 * table into test/fixtures/live/<table>.json. It is the connector-side twin of
 * tools/snapshot.js (which pulls over REST when TBA credentials are present).
 *
 * usage: node tools/ingest-connector-results.mjs <dir-with-result-files> [--out test/fixtures/live]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const out = (args.find((a) => a.startsWith('--out=')) || '--out=test/fixtures/live').slice(6);
if (!dir) { console.error('usage: ingest-connector-results.mjs <dir> [--out=dir]'); process.exit(2); }

/** Map the FROM table of a query to a fixture name. */
function tableOf(sql) {
  const m = /\bFROM\s+([a-z0-9_]+)/i.exec(sql);
  const t = m ? m[1].toLowerCase() : 'unknown';
  return ({
    customrecord_serp_units_bedrooms: 'units',
    customrecord_serp_property_record: 'properties',
    customrecord_serp_lease_record: 'leases',
    customrecord_serp_academic_yr_details: 'targets',
    customrecord_serp_academic_yr_list: 'academic_years',
    customrecord_ad_unit_ay_status: 'stage_rows',
    customrecord_ad_uas_note: 'stage_notes',
    customrecord_ad_uas_stage_log: 'stage_log',
    customer: 'customers',
    subsidiary: 'subsidiaries',
  })[t] || t;
}

const groups = new Map(); // key: table|sql → { sql, pages: Map(pageIndex → obj) }
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.txt')) continue;
  let obj;
  try { obj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!obj || !Array.isArray(obj.data) || !obj.queryExecuted) continue;
  const key = obj.queryExecuted.replace(/\s+/g, ' ').trim();
  if (!groups.has(key)) groups.set(key, { sql: key, table: tableOf(key), pages: new Map() });
  const g = groups.get(key);
  const idx = obj.pageIndex == null ? 0 : obj.pageIndex;
  const prev = g.pages.get(idx);
  // keep the newest file for a page (re-pulled pages supersede)
  if (!prev || fs.statSync(path.join(dir, f)).mtimeMs > prev.mtime) g.pages.set(idx, { ...obj, mtime: fs.statSync(path.join(dir, f)).mtimeMs, file: f });
}

fs.mkdirSync(out, { recursive: true });
const manifest = { pulledAt: new Date().toISOString(), tables: {} };
let ok = true;
for (const g of groups.values()) {
  const pages = [...g.pages.values()].sort((a, b) => a.pageIndex - b.pageIndex);
  const expectPages = pages[0].numberOfPages || 1;
  const total = pages[0].totalResults;
  const have = pages.reduce((s, p) => s + p.data.length, 0);
  const missing = [];
  for (let i = 0; i < expectPages; i++) if (!g.pages.has(i)) missing.push(i);
  const complete = missing.length === 0 && have === total;
  const rows = pages.flatMap((p) => p.data);
  // the same query may have been run twice with different page sizes; prefer complete sets
  const prior = manifest.tables[g.table];
  if (prior && prior.complete && !complete) { console.log(`skip incomplete duplicate for ${g.table}`); continue; }
  fs.writeFileSync(path.join(out, `${g.table}.json`), JSON.stringify(rows));
  manifest.tables[g.table] = { rows: have, totalResults: total, pages: pages.length, expectPages, missingPages: missing, complete, sql: g.sql, pageSize: pages[0].pageSize };
  console.log(`${g.table.padEnd(16)} rows=${have}/${total} pages=${pages.length}/${expectPages}${missing.length ? ' MISSING ' + missing.join(',') : ''}${complete ? '' : '  <-- INCOMPLETE'}`);
  if (!complete) ok = false;
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
process.exit(ok ? 0 : 1);
