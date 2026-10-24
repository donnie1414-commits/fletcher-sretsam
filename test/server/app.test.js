/** Offline integration: the full server path (schema probe → DAO → engine → routes → shell) against the committed snapshot through fake N modules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../src/server/app.js';
import { loadFixture } from '../../src/shared/rules/fixture-io.js';
import { fakeRuntime, fakeLog } from './fakes.js';

const snaps = fs.readdirSync('test/fixtures').filter((d) => d.startsWith('snapshot-')).sort();
const fx = snaps.length ? loadFixture(path.join('test/fixtures', snaps[snaps.length - 1])) : null;

/** A fake N/query that answers the DAO's SQL from the fixture by table name (WHERE handling is deliberately minimal). */
function fakeQuery(fixture) {
  const tableRows = (sql) => {
    const t = /FROM\s+([a-z0-9_]+)/i.exec(sql)[1].toLowerCase();
    if (sql.includes('ROWNUM <= 1') && !sql.includes('ROWNUM rn')) return [{}]; // schema probe: pretend every field exists except those listed below
    const map = { customrecord_serp_property_record: 'properties', customrecord_serp_units_bedrooms: 'units', customrecord_serp_lease_record: 'leases', customrecord_serp_academic_yr_details: 'targets', customrecord_serp_academic_yr_list: 'academic_years', customrecord_ad_unit_ay_status: 'stage_rows', customrecord_ad_uas_note: 'stage_notes', customrecord_ad_uas_stage_log: 'stage_log', customer: 'customers', subsidiary: 'subsidiaries', entitystatus: null };
    if (t === 'employee') return [{ markets: 'Bethlehem, Troy' }];
    if (t === 'entitystatus') return fixture.lists.entitystatus.map((s) => ({ id: s.key, name: s.name, entitytype: s.entitytype, inactive: s.inactive || 'F' }));
    if (t.startsWith('customlist')) return fixture.lists[t] || [];
    if (t === 'customrecord_ad_write_audit' || t === 'customrecord_ad_saved_view') return [];
    if (t.startsWith('map_')) return [];
    let rows = fixture[map[t]] || [];
    if (/isinactive = 'F'/.test(sql)) rows = rows.filter((r) => r.isinactive !== 'T');
    const ayIn = /custrecord_serp_academic_year IN \(([^)]*)\)|custrecord_ad_uas_ay IN \(([^)]*)\)/.exec(sql);
    if (ayIn) { const ids = new Set((ayIn[1] || ayIn[2]).split(',').map((x) => Number(x))); rows = rows.filter((r) => ids.has(Number(r.ay))); }
    if (/COUNT\(\*\) AS n FROM customer/.test(sql)) return [{ n: rows.length }];
    if (/ROWNUM rn/.test(sql)) { const m = /rn > (\d+) AND rn <= (\d+)/.exec(sql); return rows.filter((r) => r.stage === 'CUSTOMER').slice(Number(m[1]), Number(m[2])).map((r) => ({ ...r, status_name: 'Tenant-New' })); }
    if (t === 'customer' && /stage = 'CUSTOMER'/.test(sql)) rows = rows.filter((r) => r.stage === 'CUSTOMER');
    return rows.map((r) => ({ ...r, lease_type_name: r.lease_type === 1 ? 'Whole House' : r.lease_type === 2 ? 'Unit' : r.lease_type === 3 ? 'Bedroom' : null, status_name: r.status === 1 ? 'Fully Executed' : r.status === 2 ? 'In Process' : null, ay_name: fixture.academic_years.find((a) => a.id === r.ay)?.name || null }));
  };
  const missing = new Set(['custrecord_ad_uas_lease_terms']);
  return {
    runSuiteQL: ({ query }) => { if (/ROWNUM <= 1/.test(query) && [...missing].some((f) => query.includes(f))) throw new Error('Unknown identifier'); return { asMappedResults: () => tableRows(query) }; },
    runSuiteQLPaged: ({ query, pageSize }) => { const rows = tableRows(query); const ranges = []; for (let i = 0; i * pageSize < Math.max(rows.length, 1); i++) ranges.push({ index: i }); return { pageRanges: ranges, fetch: ({ index }) => ({ data: { asMappedResults: () => rows.slice(index * pageSize, (index + 1) * pageSize) } }) }; },
  };
}
function request(app, params = {}, method = 'GET', body = null) {
  let out = ''; const headers = {};
  app.handle({ request: { parameters: params, method, body, headers: { 'X-Requested-With': 'AmicusLeasing' } }, response: { write: (s) => { out += s; }, setHeader: ({ name, value }) => { headers[name] = value; } } });
  return { text: out, headers, json: () => JSON.parse(out) };
}
test('server path against the snapshot', { skip: fx ? false : 'no snapshot' }, async (t) => {
  const N = { query: fakeQuery(fx), record: {}, runtime: fakeRuntime({ roleId: 3 }), log: fakeLog, file: { load: () => { throw new Error('no file'); } }, cache: null };
  const app = createApp(N);
  await t.test('shell is small and carries the bootstrap JSON', () => {
    const r = request(app);
    assert.ok(r.text.startsWith('<!doctype html>'));
    const bootText = /<script type="application\/json" id="al-bootstrap">([\s\S]*?)<\/script>/.exec(r.text)[1];
    assert.ok(Buffer.byteLength(r.text) - Buffer.byteLength(bootText) < 2.5 * 1024, `shell without bootstrap is ${Buffer.byteLength(r.text) - Buffer.byteLength(bootText)} bytes`);
    assert.ok(Buffer.byteLength(bootText) < 3 * 1024, `bootstrap JSON is ${Buffer.byteLength(bootText)} bytes`);
    const boot = JSON.parse(bootText);
    assert.equal(boot.scope.all, true); assert.ok(boot.academicYears.length >= 3);
    assert.ok(boot.degraded.some((d) => d.field === 'custrecord_ad_uas_lease_terms'), 'missing optional field is reported, not fatal');
  });
  await t.test('summary ties to the golden inventory and pipeline denominator equals summary denominator', () => {
    const s = request(app, { route: 'summary', ay: '2027', basis: 'proforma' }).json();
    assert.equal(s.student.beds, 5348);
    const first = request(app, { route: 'pipeline', ay: '2027', pageSize: '500' }).json();
    assert.equal(first.total, 1445); assert.equal(first.totalBeds, 5348 + 3, 'pipeline rows carry commercial beds too (3 at the office) — the KPI denominator excludes them');
    const rows = [...first.rows]; for (let pg = 1; pg * 500 < first.total; pg++) rows.push(...request(app, { route: 'pipeline', ay: '2027', pageSize: '500', page: String(pg) }).json().rows);
    assert.equal(rows.length, 1445);
    const student = rows.filter((r) => r.segment !== 'COMMERCIAL' && r.segment !== 'STR').reduce((a, r) => a + r.beds, 0);
    assert.equal(student, s.student.beds, 'pipeline denominator equals the KPI denominator');
    assert.ok(rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'stage') && Object.prototype.hasOwnProperty.call(r, 'free')));
    assert.equal(first.stageRowCount, 1446);
  });
  await t.test('portfolio, weekly, exceptions, today and tenants respond', () => {
    const port = request(app, { route: 'portfolio', ay: '2027' }).json(); assert.ok(port.nodes.length > 6000); assert.equal(port.nodes[0].kind, 'fund');
    const w = request(app, { route: 'weekly', ay: '2027' }).json(); assert.equal(w.shiftDays, 364); assert.ok(w.panels.week && w.panels.ay);
    const ex = request(app, { route: 'exceptions', ay: '2027' }).json(); assert.ok(ex.groups.length >= 1); assert.ok(ex.groups.every((g, i, a) => i === 0 || a[i - 1].severity <= g.severity));
    const today = request(app, { route: 'today', ay: '2027' }).json(); assert.ok(today.exceptions.count >= 0 && today.blockedTenants);
    const ten = request(app, { route: 'tenants', pageSize: '25' }).json(); assert.equal(ten.rows.length, 25); assert.ok(ten.rows.every((r) => r.ready && Array.isArray(r.ready.reasons)));
    const leads = request(app, { route: 'leads' }).json(); assert.equal(leads.meta.status, 501);
  });
  await t.test('a scoped user only sees their markets and cannot widen the selection', () => {
    const scoped = createApp({ ...N, runtime: fakeRuntime({ roleId: 1000 }) });
    const s = request(scoped, { route: 'summary', ay: '2027', market: 'providence' }).json();
    assert.deepEqual(s.byMarket.map((m) => m.marketId).sort(), ['lehigh', 'troy']);
    assert.equal(s.selection.marketId, null);
    const p = request(scoped, { route: 'pipeline', ay: '2027', pageSize: '500' }).json();
    assert.ok(p.rows.every((r) => r.market === 'lehigh' || r.market === 'troy'));
  });
  await t.test('write route requires POST + header and returns per-row results', () => {
    const r = request(app, { route: 'write' }); assert.equal(r.json().meta.status, 405);
    let out = ''; app.handle({ request: { parameters: { route: 'write' }, method: 'POST', body: '{}', headers: {} }, response: { write: (s) => { out += s; }, setHeader() {} } });
    assert.equal(JSON.parse(out).meta.status, 403);
  });
});
