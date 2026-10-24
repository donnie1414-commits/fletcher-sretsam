#!/usr/bin/env node
/**
 * Produce the committed fixture from a live snapshot: personal data is replaced
 * with deterministic placeholders, free text is reduced to its length, and every
 * table is gzipped. Ids, dates, money, links and statuses are untouched, so the
 * engine produces identical numbers on the redacted copy.
 *
 * usage: node tools/redact-fixture.mjs test/fixtures/live test/fixtures/snapshot-YYYY-MM-DD
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('usage: redact-fixture.mjs <live-dir> <out-dir>'); process.exit(2); }
fs.mkdirSync(dst, { recursive: true });
const h = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const len = (s) => (s == null ? null : `[redacted ${String(s).length} chars]`);
const redactors = {
  customers: (c) => ({ ...c, firstname: c.firstname == null ? null : `First${h(c.id)}`, lastname: c.lastname == null ? null : `Last${h(c.id)}`, email: c.email == null ? null : `t${h(c.email)}@example.invalid`, phone: c.phone == null ? null : '+15555550100', mobilephone: c.mobilephone == null ? null : '+15555550101', house_mates: len(c.house_mates), notes: len(c.notes), agent_assigned: len(c.agent_assigned), cosigner_first: len(c.cosigner_first), cosigner_last: len(c.cosigner_last), entityid: c.entityid == null ? null : String(c.id) }),
  stage_rows: (r) => ({ ...r, expected_tenants: len(r.expected_tenants), notes: len(r.notes) }),
  stage_notes: (n) => ({ ...n, text: len(n.text), name: len(n.name) }),
  leases: (l) => ({ ...l, provisions: len(l.provisions) }),
};
const manifest = { source: src, redactedAt: new Date().toISOString(), tables: {} };
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith('.json') || f === 'manifest.json') continue;
  const table = f.replace(/\.json$/, '');
  let rows = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));
  if (Array.isArray(rows) && redactors[table]) rows = rows.map(redactors[table]);
  const out = JSON.stringify(rows);
  fs.writeFileSync(path.join(dst, f + '.gz'), zlib.gzipSync(out, { level: 9 }));
  manifest.tables[table] = { rows: Array.isArray(rows) ? rows.length : Object.keys(rows).length, sha256: crypto.createHash('sha256').update(out).digest('hex'), redacted: !!redactors[table] };
  console.log(`${table.padEnd(16)} ${String(manifest.tables[table].rows).padStart(6)} rows ${redactors[table] ? '(redacted)' : ''}`);
}
const live = fs.existsSync(path.join(src, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')) : null;
if (live) manifest.pulledAt = live.pulledAt;
fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(manifest, null, 2));
