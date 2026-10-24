import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, runEngine, property, unit } from '../helpers.js';
import { summaryExtras, velocity } from '../../src/shared/rules/summary.js';
import { recordQuality, leaseQuality, tenantQuality } from '../../src/shared/rules/quality.js';

function build() {
  const h = house();
  const fx = fixture({ ...h, leases: [
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 3000, sent: '10/15/2026', signed: '10/21/2026', tenants: ['1', '2', '3'] }),
    lease({ property: h.p.id, unit: h.bB[0].id, type: 'BED', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 900, sent: '10/22/2026', status: 'IN_PROCESS', tenants: ['4'] }),
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2026, start: '06/01/2026', end: '05/23/2027', monthly: 2700, sent: '10/01/2025', signed: '10/10/2025', tenants: ['1', '2', '9'] }),
    lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2026, start: '06/01/2026', end: '05/23/2027', monthly: 1800, sent: '12/01/2025', signed: '12/10/2025', tenants: ['5', '6'] }),
  ], targets: [{ id: 1, isinactive: 'F', unit: h.uA.id, property: h.p.id, ay: 2, beds: 3, target_per_bed: 1000, target_monthly: 3000, settle_per_bed: 950, settle_monthly: 2850, prev_year_per_bed: 900 }] });
  return { h, fx, run: runEngine(fx, { ay: 2027 }) };
}
test('KPI rows carry the prior year, the same-date pace and the lease counts', () => {
  const { run } = build();
  const x = summaryExtras(run, { today: '2026-10-23' });
  const t = x.kpi.total;
  assert.equal(t.beds, 5); assert.equal(t.occ, 4); assert.equal(t.leases, 2); assert.equal(t.excluded, 0);
  assert.equal(t.pOcc, 5, 'last year both units were leased'); assert.equal(t.pLeases, 2);
  assert.equal(x.pace.lyAsOf, '2025-10-23', 'same date last year = today less the AY-start gap');
  assert.equal(t.lyWkOcc, 3, 'by 10/23 last year only unit A (sent 10/01) was counted on the pro-forma basis');
  assert.ok(Math.abs(t.lyWkDelta - (4 / 5 - 3 / 5)) < 1e-12);
  assert.equal(x.kpi.byMarket.length, 1); assert.equal(x.kpi.byMarket[0].row.name, 'Bethlehem'); assert.equal(x.kpi.byMarket[0].children[0].name, 'Amicus II');
  assert.equal(x.kpi.byFund[0].children[0].beds, 5);
});
test('lease-type table, ties and vacancy counts', () => {
  const { run } = build();
  const x = summaryExtras(run, { today: '2026-10-23' });
  const byKey = Object.fromEntries(x.byLeaseType.map((r) => [r.key, r]));
  assert.equal(byKey.UNIT.occ, 3); assert.equal(byKey.BED.occ, 1); assert.equal(byKey.WH.occ, 0);
  assert.ok(Math.abs(byKey.UNIT.occShare - 0.75) < 1e-12);
  assert.equal(byKey.UNIT.pOcc, 5);
  assert.ok(x.ties.people && x.ties.mrev && x.ties.trev, JSON.stringify(x.ties));
  assert.deepEqual(x.vacancy, { fullUnits: 0, fullBeds: 0, partUnits: 1, partBeds: 1 });
  assert.equal(x.propertyCount, 1);
});
test('targets: settle, prior-year rent per bed and actual-vs-target roll to every level; same-store marks units leased both years', () => {
  const { run, h } = build();
  const x = summaryExtras(run, { today: '2026-10-23' });
  const t = x.kpi.total;
  assert.equal(t.tgt, 3000); assert.equal(t.tgtBed, 1000); assert.equal(t.settle, 2850); assert.equal(t.prevRentBed, 900);
  assert.ok(Math.abs(t.actVsTgt - 0) < 1e-12, 'unit A signed exactly at target');
  assert.equal(t.tgtVacant, 0);
  assert.equal(t.ssBeds, 3, 'unit A was 100% leased both years; unit B is only part-let this year');
  assert.equal(t.ssCur, 3000); assert.equal(t.ssPrior, 2700); assert.ok(Math.abs(t.ssYoY - (3000 / 2700 - 1)) < 1e-12);
  assert.deepEqual(run.sameStore.dropped, { excluded: 0, vacantCur: 1, vacantPrior: 0 });
});
test('recent lease records (last 3 days, every AY) and the commercial / STR blocks', () => {
  const h = house();
  const com = property({ name: 'Storefront', prop_type: 2, prop_type_name: 'Commercial' });
  const cu = unit(com.id, { name: 'Shop', beds: 0 });
  const fx = fixture({ properties: [h.p, com], units: [...h.units, cu], leases: [
    { ...lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 3000 }), created: '10/22/2026 09:00' },
    { ...lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 2000 }), created: '10/01/2026' },
    { ...lease({ property: com.id, unit: cu.id, type: 'UNIT', ay: 2027, start: '01/01/2027', end: '12/31/2029', monthly: 5000, duration: 36 }), created: '10/23/2026' },
  ] });
  const run = runEngine(fx, { ay: 2027 });
  const x = summaryExtras(run, { today: '2026-10-23' });
  assert.deepEqual(x.recent.map((r) => r.property), ['Storefront', h.p.name]);
  assert.equal(x.commercial.properties, 1); assert.equal(x.commercial.rows[0].status, 'Leased', 'year 2 of a 36-month commercial lease (anchored on its start date) still counts');
  assert.equal(x.commercial.annual, 60000, 'annual = monthly × 12, never the multi-year contract total');
  const r26 = summaryExtras(runEngine(fx, { ay: 2026 }), { today: '2026-10-23' });
  assert.equal(r26.commercial.leased, 1); assert.equal(r26.commercial.rows[0].leases, 1, 'a zero-bed storefront still places its lease for rent (A-21)');
  assert.equal(r26.kpi.total.beds, 5, 'commercial never reaches the student denominator');
});
test('velocity rows: days from the AY start per counted lease, newest AY first', () => {
  const { fx } = build();
  const runs = { '2027:proforma': runEngine(fx, { ay: 2027, basis: 'proforma', withPrior: false }), '2027:executed': runEngine(fx, { ay: 2027, basis: 'executed', withPrior: false }), '2026:proforma': runEngine(fx, { ay: 2026, basis: 'proforma', withPrior: false }), '2026:executed': runEngine(fx, { ay: 2026, basis: 'executed', withPrior: false }) };
  const v = velocity(runs, { ays: [{ year: 2027 }, { year: 2026 }] });
  assert.equal(v.ays[0].selected, true);
  const cur = v.proforma.filter((r) => r[0] === 0);
  assert.equal(cur.length, 2); assert.equal(cur[0][1], -229, '10/15/2026 is 229 days before 6/1/2027'); assert.equal(cur[0][2], 3);
  assert.equal(v.executed.filter((r) => r[0] === 1).length, 2);
  assert.equal(v.beds['A2|lehigh'], 5);
});
test('quality lists: record gaps, lease dates/status, tenant records', () => {
  const h = house();
  const fx = fixture({ ...h, units: [...h.units, unit(h.p.id, { name: 'Unit C', beds: null })], leases: [
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 3000, signed: null, tenants: ['1', '2'], tenantCount: 3 }),
    lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 2000, status: 'IN_PROCESS', sent: null, tenants: ['2'] }),
    lease({ property: h.p.id, unit: h.bA[0].id, type: 'BED', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 900, status: null }),
  ] });
  const run = runEngine(fx, { ay: 2027 });
  const rec = recordQuality(run);
  assert.ok(rec.some((r) => r.code === 'UNIT_ZERO_BEDS' && r.record === 'Unit C'));
  const lq = leaseQuality(run, { today: '2026-10-23', ayEnd: '2028-05-31' });
  assert.deepEqual(lq.map((r) => r.code).sort(), ['EXEC_NO_SIGNED', 'INPROC_NO_SENT', 'NO_STATUS']);
  const customers = new Map([['1', { id: '1', name: 'A One', email: null, isinactive: 'F' }], ['2', { id: '2', name: 'B Two', email: 'b@x', isinactive: 'T' }]]);
  const tq = tenantQuality(run, { customersById: customers });
  const codes = tq.map((r) => r.code).sort();
  assert.deepEqual(codes, ['TENANT_COUNT', 'TENANT_INACTIVE', 'TENANT_MULTI', 'TENANT_NO_EMAIL']);
  assert.equal(tq.find((r) => r.code === 'TENANT_MULTI').dupLeases, 2);
});
