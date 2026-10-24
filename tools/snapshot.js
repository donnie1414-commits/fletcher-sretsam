#!/usr/bin/env node
/**
 * npm run snapshot — pull a fresh fixture into test/fixtures/live/ (§8.1).
 * Pages past SuiteQL's 1,000-row cap and verifies every table's row count against COUNT(*).
 *
 * Two transports:
 *   REST (default)   — needs NS_* env (see tools/netsuite-rest.mjs). Read-only SuiteQL.
 *   --from-connector <dir> — assemble from NetSuite MCP connector result files (tools/ingest-connector-results.mjs)
 * Then: node tools/redact-fixture.mjs test/fixtures/live test/fixtures/snapshot-<date>
 */
import fs from 'node:fs';
import path from 'node:path';
import { hasCredentials, suiteqlAll, suiteql } from './netsuite-rest.mjs';
import { SNAPSHOT_QUERIES } from './snapshot-queries.mjs';

const args = process.argv.slice(2);
const out = (args.find((a) => a.startsWith('--out=')) || '--out=test/fixtures/live').slice(6);
const fromConnector = args.indexOf('--from-connector');
if (fromConnector > -1) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['tools/ingest-connector-results.mjs', args[fromConnector + 1], `--out=${out}`], { stdio: 'inherit' });
  process.exit(0);
}
if (!hasCredentials()) { console.error('No NS_* credentials in the environment. Either set NS_ACCOUNT/NS_CONSUMER_KEY/NS_CONSUMER_SECRET/NS_TOKEN_ID/NS_TOKEN_SECRET (read-only SuiteQL role), or run with --from-connector <dir> after pulling pages through the NetSuite connector.'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const manifest = { pulledAt: new Date().toISOString(), transport: 'rest', tables: {} };
for (const [table, spec] of Object.entries(SNAPSHOT_QUERIES)) {
  const rows = await suiteqlAll(spec.sql);
  const expected = spec.count ? Number((await suiteql(spec.count)).items[0].n) : rows.length;
  if (rows.length !== expected) { console.error(`${table}: pulled ${rows.length} but COUNT(*) says ${expected} — truncated snapshot, aborting`); process.exit(1); }
  fs.writeFileSync(path.join(out, `${table}.json`), JSON.stringify(rows));
  manifest.tables[table] = { rows: rows.length, complete: true, sql: spec.sql };
  console.log(`${table.padEnd(16)} ${String(rows.length).padStart(6)} rows`);
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
