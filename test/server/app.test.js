/** Offline integration: the full server path (schema probe → DAO → engine → routes → shell) against the committed snapshot through fake N modules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../src/server/app.js';
import { loadFixture } from '../../src/shared/rules/fixture-io.js';
import { fakeRuntime, fakeLog } from './fakes.js';
import { fakeQuery } from '../../tools/fake-netsuite.mjs';

const snaps = fs.readdirSync('test/fixtures').filter((d) => d.startsWith('snapshot-')).sort();
const fx = snaps.length ? loadFixture(path.join('test/fixtures', snaps[snaps.length - 1])) : null;

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
    assert.ok(first.stageBeds && typeof first.breachCount === 'number' && typeof first.needsActionCount === 'number');
    assert.equal(first.total, 1445 - 7, 'commercial units (the office + six storefronts) are not leasing rows'); assert.equal(first.totalBeds, s.student.beds, 'pipeline total beds equals Summary total beds exactly');
    const rows = [...first.rows]; for (let pg = 1; pg * 500 < first.total; pg++) rows.push(...request(app, { route: 'pipeline', ay: '2027', pageSize: '500', page: String(pg) }).json().rows);
    assert.equal(rows.length, 1438);
    const student = rows.filter((r) => r.segment !== 'COMMERCIAL' && r.segment !== 'STR').reduce((a, r) => a + r.beds, 0);
    assert.equal(student, s.student.beds, 'pipeline denominator equals the KPI denominator');
    assert.ok(rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'stage') && Object.prototype.hasOwnProperty.call(r, 'free')));
    assert.equal(first.stageRowCount, 1446);
  });
  await t.test('portfolio, weekly, exceptions, today and tenants respond', () => {
    const first = request(app, { route: 'pipeline', ay: '2027', pageSize: '25' }).json();
    const port = request(app, { route: 'portfolio', ay: '2027' }).json(); assert.ok(port.nodes.length > 6000); assert.equal(port.nodes[0].kind, 'fund'); assert.ok(port.vacancy && port.nodes.some((n) => n.metrics.pOccupied > 0) && port.nodes.some((n) => n.leaf && n.leaf.type));
    const w = request(app, { route: 'weekly', ay: '2027' }).json(); assert.equal(w.shiftDays, 364); assert.ok(w.cmp.week && w.cmp.year && Array.isArray(w.history) && w.history.length > 10); assert.ok(w.byGroup.length >= 5); assert.equal(w.inactivationsAvailable, false, 'systemnote is not visible to the role: the section degrades, the tab does not');
    const s27 = request(app, { route: 'summary', ay: '2027' }).json(); assert.ok(s27.kpi.byMarket.length >= 5 && s27.byLeaseType.length === 3 && s27.ties.people && s27.ties.mrev && s27.vacancy.fullUnits > 0, 'summary carries the v2 blocks'); assert.ok(s27.pace && s27.kpi.total.lyWkOcc > 0, 'same-date-last-year pace');
    const v = request(app, { route: 'velocity', ay: '2027' }).json(); assert.ok(v.ays.length >= 2 && v.proforma.length > 500);
    const exf = request(app, { route: 'exceptions', ay: '2027' }).json(); assert.ok(Array.isArray(exf.blocking) && Array.isArray(exf.leaseQuality) && Array.isArray(exf.tenantQuality) && Array.isArray(exf.records));
    const uh = request(app, { route: 'unithistory', ay: '2027', unit: first.rows[0].key }).json(); assert.ok(uh.unit && uh.years.length >= 2);
    const team = request(app, { route: 'team' }).json(); assert.ok(Array.isArray(team.team));
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
  await t.test('assets are served through the Suitelet, same-origin, from the File Cabinet ids in the parameters', () => {
    const withFiles = createApp({ ...N, runtime: fakeRuntime({ roleId: 3, params: { custscript_al_client_js: 229898, custscript_al_client_css: 229899 } }), file: { load: ({ id }) => ({ id, getContents: () => (id === 229898 ? '(()=>{/*bundle*/})();' : ':root{}') }) } });
    const shell = request(withFiles, { script: '123', deploy: '1', compid: 'ACME' });
    assert.ok(shell.text.includes('/app/site/hosting/scriptlet.nl?script=123&deploy=1&compid=ACME&route=asset&kind=js&v=229898'), 'the script tag points back at the Suitelet');
    assert.ok(shell.text.includes('route=asset&kind=css&v=229899'));
    const js = request(withFiles, { route: 'asset', kind: 'js' }); assert.equal(js.headers['Content-Type'], 'application/javascript; charset=utf-8'); assert.equal(js.text, '(()=>{/*bundle*/})();');
    const css = request(withFiles, { route: 'asset', kind: 'css' }); assert.equal(css.headers['Content-Type'], 'text/css; charset=utf-8'); assert.equal(css.text, ':root{}');
    const none = request(app, { route: 'asset', kind: 'js' }); assert.ok(none.text.includes('not configured'));
  });
  await t.test('write route requires POST + header and returns per-row results', () => {
    const r = request(app, { route: 'write' }); assert.equal(r.json().meta.status, 405);
    let out = ''; app.handle({ request: { parameters: { route: 'write' }, method: 'POST', body: '{}', headers: {} }, response: { write: (s) => { out += s; }, setHeader() {} } });
    assert.equal(JSON.parse(out).meta.status, 403);
  });
});
