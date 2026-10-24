import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, run } from '../helpers.js';
import { leasingEvents, weeklyReport } from '../../src/shared/rules/weekly.js';

function build() {
  const h = house();
  const fx = fixture({ ...h, leases: [
    // AY 27-28 (this year): signed in the week of Mon 2026-10-19
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 3000, sent: '10/15/2026', signed: '10/21/2026' }),
    lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2027, start: '06/01/2027', end: '05/23/2028', monthly: 2000, sent: '10/22/2026', signed: null }),
    // AY 26-27 (last year): signed 364 days earlier (Wed 2025-10-22), and one more later that week (Sat 2025-10-25) which a partial-week compare must NOT count
    lease({ property: h.p.id, unit: h.uA.id, type: 'UNIT', ay: 2026, start: '06/01/2026', end: '05/23/2027', monthly: 2800, sent: '10/10/2025', signed: '10/22/2025' }),
    lease({ property: h.p.id, unit: h.uB.id, type: 'UNIT', ay: 2026, start: '06/01/2026', end: '05/23/2027', monthly: 1900, sent: '10/11/2025', signed: '10/25/2025' }),
  ] });
  const cur = run(fx, { ay: 2027 }), last = run(fx, { ay: 2026 });
  return { h, cur, last, eventsThis: leasingEvents(cur.placement, cur.inventory), eventsLast: leasingEvents(last.placement, last.inventory) };
}
test('partial week compares the same elapsed days last year, aligned Mon–Sun by a 364-day shift', () => {
  const b = build();
  const w = weeklyReport({ ay: 2027, today: '2026-10-23', eventsThis: b.eventsThis, eventsLast: b.eventsLast, bedsThis: 5, bedsLast: 5 });
  assert.equal(w.shiftDays, 364);
  assert.equal(w.panels.week.start, '2026-10-19'); assert.equal(w.panels.week.end, '2026-10-23'); assert.equal(w.panels.week.elapsedDays, 5);
  assert.equal(w.panels.week.lastStart, '2025-10-20'); assert.equal(w.panels.week.lastEnd, '2025-10-24');
  assert.equal(w.panels.week.thisYear.bedsLeased, 3);
  assert.equal(w.panels.week.lastYear.bedsLeased, 3); // the Saturday signing last year is outside the elapsed days
  assert.equal(w.panels.week.thisYear.leasesSent, 1); // sent 10/22 is in the week; 10/15 is not
  assert.equal(w.panels.week.change.bedsLeased, 0);
  assert.equal(w.panels.week.thisYear.revenueLeased, 36000);
});
test('not-yet-dated reconciliation line shows counted leases that land in no week', () => {
  const b = build();
  const w = weeklyReport({ ay: 2027, today: '2026-10-23', eventsThis: b.eventsThis, eventsLast: b.eventsLast, bedsThis: 5, bedsLast: 5 });
  assert.equal(w.undated.noSigned, 1); assert.equal(w.undated.noSignedBeds, 2);
  assert.equal(b.cur.summary.student.occupied, 5); // Summary counts both; weekly signed-to-date shows 3 — the gap is the undated line
  assert.ok(Math.abs(w.panels.ay.preleasePct - 3 / 5) < 1e-12);
});
test('a chosen past week is a full Mon–Sun week', () => {
  const b = build();
  const w = weeklyReport({ ay: 2027, today: '2026-10-23', weekOf: '2026-10-14', eventsThis: b.eventsThis, eventsLast: b.eventsLast, bedsThis: 5, bedsLast: 5 });
  assert.equal(w.panels.week.start, '2026-10-12'); assert.equal(w.panels.week.end, '2026-10-18'); assert.equal(w.panels.week.elapsedDays, 7);
  assert.equal(w.panels.week.thisYear.leasesSent, 1);
});
test('pace series is cumulative and aligned', () => {
  const b = build();
  const w = weeklyReport({ ay: 2027, today: '2026-10-23', eventsThis: b.eventsThis, eventsLast: b.eventsLast, bedsThis: 5, bedsLast: 5 });
  const lastPoint = w.pace[w.pace.length - 1];
  assert.equal(lastPoint.thisYear, 3); assert.equal(lastPoint.lastYear, 3);
  assert.ok(w.pace.length > 20);
});
