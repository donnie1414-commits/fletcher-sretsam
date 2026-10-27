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
// Synthetic tours (calendar events) on top of the snapshot: two for one Tenant-New lead on a real unit, one cancelled, one for another agent.
if (fx) {
  const lead = fx.customers.find((c) => c.entitystatus === 17 && c.isinactive !== 'T' && !c.property);
  const unit = fx.units.find((u) => u.isinactive !== 'T' && u.property);
  const today = new Date().toISOString().slice(0, 10);
  fx.tours = [
    { id: 9001, title: 'Tour · lead', startdate: today, starttime: '10:00', endtime: '10:30', organizer: 42, status: 'CONFIRMED', location: 'x', message: '', company: lead.id, company_name: `${lead.firstname} ${lead.lastname}`, lastmodifieddate: '2026-10-27', unit: unit.id, outcome: 1, ay: 2 },
    { id: 9002, title: 'Tour · cancelled', startdate: today, starttime: '14:00', endtime: '14:30', organizer: 42, status: 'CANCELLED', location: 'x', message: '', company: lead.id, lastmodifieddate: '2026-10-27', unit: unit.id, outcome: 4, ay: 2 },
    { id: 9003, title: 'Tour · other agent', startdate: today, starttime: '09:00', endtime: '09:30', organizer: 43, status: 'CONFIRMED', location: 'x', message: '', company: null, lastmodifieddate: '2026-10-27', unit: unit.id, outcome: null, ay: 2 },
  ];
  fx.testLead = lead; fx.testUnit = unit;
}

function request(app, params = {}, method = 'GET', body = null) {
  let out = ''; const headers = {};
  app.handle({ request: { parameters: params, method, body, headers: { 'X-Requested-With': 'AmicusLeasing' } }, response: { write: (s) => { out += s; }, setHeader: ({ name, value }) => { headers[name] = value; }, writeFile: ({ file: f }) => { headers['Content-Type'] = f.fileType === 'STYLESHEET' ? 'text/css' : 'application/javascript'; headers['Inline'] = 'T'; out += f.getContents(); } } });
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
    const tours = request(app, { route: 'tours', view: 'all' }).json(); assert.equal(tours.available, true); assert.equal(tours.rows.length, 3, 'all three events read back'); assert.equal(tours.rows[0].start, '09:00'); assert.equal(tours.rows.find((r) => r.id === '9002').outcome, 'CANCELLED'); assert.ok(tours.rows[0].unit && tours.rows[0].property && tours.rows[0].market, 'unit → property → market resolved from the inventory'); assert.ok(tours.outcomes.find((o) => o.key === 'NO_SHOW').id === 3);
    const mine = request(app, { route: 'tours', view: 'mine' }).json(); assert.equal(mine.rows.length, 2, 'mine = organised by me (42)');
    const leads = request(app, { route: 'leads', view: 'all', pageSize: '500' }).json(); assert.ok(leads.total > 100, `leads total ${leads.total}`); assert.ok(leads.rows.every((r) => r.statusId === 17 && r.properties !== undefined)); const L = leads.rows.find((r) => r.id === String(fx.testLead.id)); assert.ok(L, 'the lead with tours is in the set'); assert.equal(L.tourCount, 1, 'the cancelled tour is not counted'); assert.equal(L.nextTour.id, '9001');
    const noTour = request(app, { route: 'leads', view: 'no-tour', pageSize: '500' }).json(); assert.ok(!noTour.rows.some((r) => r.id === String(fx.testLead.id)));
    assert.equal(today.tours.count, 2, 'today: the two live tours'); assert.ok(today.tours.calendarUrl); assert.ok(today.leads.count > 0 && today.leads.rows.length <= 25);
    const pl = request(app, { route: 'pipeline', ay: '2027', pageSize: '500', q: fx.testUnit.name }).json(); const row = pl.rows.find((r) => r.unitId === String(fx.testUnit.id)); assert.ok(row, 'unit row found'); assert.equal(row.tours, 2, 'two live tours on the unit this year'); assert.equal(row.nextTour, new Date().toISOString().slice(0, 10));
  });
  await t.test('calendar events unreadable: tours degrade to off with a reason, nothing else breaks', () => {
    const off = createApp({ ...N, query: fakeQuery({ ...fx, toursUnavailable: true }) });
    const tours = request(off, { route: 'tours' }).json(); assert.equal(tours.available, false); assert.deepEqual(tours.rows, []); assert.ok(tours.degraded.some((d) => d.feature === 'tours'));
    const today = request(off, { route: 'today', ay: '2027' }).json(); assert.equal(today.tours.available, false); assert.ok(today.leads.count >= 0);
    const leads = request(off, { route: 'leads', view: 'all' }).json(); assert.equal(leads.toursAvailable, false); assert.ok(leads.total > 0);
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
    const withFiles = createApp({ ...N, runtime: fakeRuntime({ roleId: 3, params: { custscript_al_client_js: 229898, custscript_al_client_css: 229899 } }), file: { load: ({ id }) => ({ id, fileType: id === 229898 ? 'JAVASCRIPT' : 'STYLESHEET', getContents: () => (id === 229898 ? '(()=>{/*bundle*/})();' : ':root{}') }) } });
    const shell = request(withFiles, { script: '123', deploy: '1', compid: 'ACME' });
    assert.ok(/\/app\/site\/hosting\/scriptlet\.nl\?script=123&deploy=1&compid=ACME&route=asset&kind=js&v=[0-9a-f]+/.test(shell.text), 'the script tag points back at the Suitelet with a version');
    assert.ok(shell.text.includes('<style id="al-css"') && shell.text.includes(':root{}'), 'the stylesheet is inlined into the page, so file type, caching and CSP cannot change how the app looks');
    assert.ok(!/<link rel="stylesheet"/.test(shell.text), 'no stylesheet link when the inline copy is present');
    assert.ok(/<meta name="al-build" content="[^"]+">/.test(shell.text) && shell.text.includes('window.__AL_SERVER_BUILD='), 'the page carries the build id for the client to compare');
    const js = request(withFiles, { route: 'asset', kind: 'js' }); assert.equal(js.headers['Content-Type'], 'application/javascript'); assert.equal(js.headers['Inline'], 'T'); assert.equal(js.text, '(()=>{/*bundle*/})();');
    const css = request(withFiles, { route: 'asset', kind: 'css' }); assert.equal(css.headers['Content-Type'], 'text/css'); assert.equal(css.text, ':root{}');
    const escaped = createApp({ ...N, runtime: fakeRuntime({ roleId: 3, params: { custscript_al_client_js: 1, custscript_al_client_css: 2 } }), file: { load: ({ id }) => ({ id, getContents: () => (id === 1 ? ';' : '.x{content:"</style><script>"}') }) } });
    const esc = request(escaped, {}).text; assert.ok(!esc.includes('</style><script>') && esc.includes('<\\/style><script>'), 'a </style> inside the CSS cannot end the tag early');
    const broken = createApp({ ...N, runtime: fakeRuntime({ roleId: 3, params: { custscript_al_client_js: 229898, custscript_al_client_css: 229899 } }), file: { load: () => { throw Object.assign(new Error('Insufficient permission'), { name: 'INSUFFICIENT_PERMISSION' }); } } });
    const fb = request(broken, { script: '123', deploy: '1' }).text; assert.ok(/<link rel="stylesheet" href="[^"]*route=asset&kind=css&v=[0-9a-f]+"/.test(fb), 'when the file cannot be read the page falls back to linking the asset route');
    const none = request(app, { route: 'asset', kind: 'js' }); assert.ok(none.text.includes('not configured'));
  });
  await t.test('write route requires POST + header and returns per-row results', () => {
    const r = request(app, { route: 'write' }); assert.equal(r.json().meta.status, 405);
    let out = ''; app.handle({ request: { parameters: { route: 'write' }, method: 'POST', body: '{}', headers: {} }, response: { write: (s) => { out += s; }, setHeader() {} } });
    assert.equal(JSON.parse(out).meta.status, 403);
  });
});
