import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, runEngine } from '../helpers.js';
import { weeklyReport } from '../../src/shared/rules/weekly.js';

function build() {
  const h = house();
  const fx = fixture({ ...h, leases: [
    // AY 27-28 (this year): sent 10/15, signed in the week of Mon 2026-10-19
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 3000, sent: '10/15/2026', signed: '10/21/2026' }),
    lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 2000, sent: '10/22/2026', signed: null, status: 'IN_PROCESS' }),
    // AY 26-27 (last year): signed 364 days earlier (Wed 2025-10-22), and one more later that week (Sat 2025-10-25)
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2026, start: '06/01/2026', end: '05/23/2027', monthly: 2800, sent: '10/10/2025', signed: '10/22/2025' }),
    lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2026, start: '06/01/2026', end: '05/23/2027', monthly: 1900, sent: '10/11/2025', signed: '10/25/2025' }),
  ] });
  return { h, fx, run: (basis) => runEngine(fx, { ay: 2027, basis }) };
}
const report = (b, basis, extra = {}) => weeklyReport({ ay: 2027, basis, today: '2026-10-23', cur: b.run(basis), prior: b.run(basis).prior, ...extra });

test('pro-forma dates by Lease Sent Date, executed by Lease Signed Date (v2 rule, A-14)', () => {
  const b = build();
  const pf = report(b, 'proforma');
  assert.equal(pf.week, '2026-10-19'); assert.equal(pf.weekEnd, '2026-10-25'); assert.equal(pf.isCurrent, true);
  assert.equal(pf.sel.newLeases, 1, 'only the 10/22 sent lease is new this week; the 10/15 one is in the prior week');
  assert.equal(pf.sel.occ, 5); assert.equal(pf.totalBeds, 5); assert.ok(Math.abs(pf.sel.occPct - 1) < 1e-12);
  assert.equal(pf.sentThisWeek.length, 1); assert.equal(pf.executed.length, 1);
  const ex = report(b, 'executed');
  assert.equal(ex.sel.occ, 3, 'executed basis counts only the signed lease');
  assert.equal(ex.sel.newBeds, 3); assert.equal(ex.sel.newLeases, 1);
});
test('last year is laid on this year’s calendar: the AY-start gap, rounded to whole weeks for week comparisons', () => {
  const b = build();
  const w = report(b, 'executed');
  assert.equal(w.offsetDays, 365); assert.equal(w.shiftDays, 364);
  assert.equal(w.sel.lyOcc, 5, 'both prior leases are signed by the aligned week end');
  assert.equal(w.sel.lyNewBeds, 5, 'the two prior signings (10/22 and 10/25) both land in the aligned week');
  assert.equal(w.cmp.week.ty.beds, 3);
  assert.equal(w.cmp.week.ly.beds, 3, 'the elapsed-days compare stops at Friday last year, so the Saturday signing is out');
  assert.equal(w.cmp.week.lyFrom, '2025-10-20'); assert.equal(w.cmp.week.lyTo, '2025-10-24');
});
test('in process at week end, with days since sent and the over-21 flag', () => {
  const b = build();
  const w = report(b, 'proforma');
  assert.equal(w.pipeline.now, 1); assert.equal(w.inProcess[0].days, 1); assert.equal(w.pipeline.over21, 0);
  assert.equal(w.pipeline.ly, 0, 'both prior leases were signed by then');
  assert.equal(w.inProcess[0].lyRentBed, 950, 'same unit a year earlier: 1900 over 2 beds');
});
test('by-market breakdown ties to the week', () => {
  const b = build();
  const w = report(b, 'proforma');
  assert.equal(w.byGroup.length, 1); assert.equal(w.byGroup[0].name, 'Bethlehem'); assert.equal(w.byGroup[0].beds, 5); assert.equal(w.byGroup[0].newBeds, 2); assert.equal(w.byGroup[0].inProcess, 1);
  const f = report(b, 'proforma', { groupBy: 'fund' });
  assert.equal(f.byGroup[0].name, 'Amicus II');
});
test('a chosen past week is a full Mon–Sun week and the pace chart is cumulative', () => {
  const b = build();
  const w = report(b, 'proforma', { weekOf: '2026-10-14' });
  assert.equal(w.week, '2026-10-12'); assert.equal(w.weekEnd, '2026-10-18'); assert.equal(w.isCurrent, false);
  assert.equal(w.sel.newLeases, 1, 'the 10/15 sent lease'); assert.equal(w.sel.occ, 3);
  assert.ok(w.chart.pts.length >= 1); assert.ok(w.chart.ahead.length >= 4, 'LY line continues past the selected week');
  assert.ok(w.weekOptions.length >= 2 && w.weekOptions[0].value === '2026-10-19');
});
test('undated counted leases are reconciled, never guessed into a week', () => {
  const h = house();
  const fx = fixture({ ...h, leases: [lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 3000, sent: null, signed: null })] });
  const run = runEngine(fx, { ay: 2027 });
  const w = weeklyReport({ ay: 2027, basis: 'proforma', today: '2026-10-23', cur: run, prior: run.prior });
  assert.equal(w.undated.leases, 1); assert.equal(w.undated.beds, 3); assert.equal(w.sel.occ, 0); assert.equal(w.cmp.undatedBeds, 3);
  assert.equal(run.summary.student.occupied, 3, 'Summary still counts it');
});
