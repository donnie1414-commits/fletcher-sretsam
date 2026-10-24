import { test } from 'node:test';
import assert from 'node:assert/strict';
import { house, lease, fixture, run, property, unit } from '../helpers.js';
import { segmentOf } from '../../src/shared/rules/segments.js';

test('property type Commercial/Land/Office ⇒ rent only, never in the bed denominator', () => {
  const h = house();
  const office = property({ name: 'Office', prop_type_name: 'Office', bedrooms: 3 }); const ou = unit(office.id, { beds: 2 });
  const r = run(fixture({ properties: [...h.properties, office], units: [...h.units, ou], leases: [lease({ property: office.id, unit: ou.id, type: 'UNIT', monthly: 2500 }), lease({ property: h.p.id, type: 'WH', monthly: 5000 })] }), { segmentOverrides: { STR: [], COMMERCIAL: [], NON_STUDENT: [] } });
  assert.equal(r.summary.student.beds, 5);
  assert.equal(r.summary.student.monthly, 5000);
  assert.equal(r.summary.commercial.monthly, 2500);
  assert.equal(r.summary.commercial.beds, 0);
});
test('short-term rentals keep bed metrics but report separately and never enter the student figures', () => {
  const h = house(); const str = house();
  const r = run(fixture({ properties: [...h.properties, ...str.properties], units: [...h.units, ...str.units], leases: [lease({ property: str.p.id, type: 'WH', monthly: 9000 })] }), { segmentOverrides: { STR: [str.p.id], COMMERCIAL: [], NON_STUDENT: [] } });
  assert.equal(r.summary.student.beds, 5);
  assert.equal(r.summary.student.occupied, 0);
  assert.equal(r.summary.str.beds, 5);
  assert.equal(r.summary.str.occupied, 5);
  assert.equal(r.summary.str.monthly, 9000);
});
test('ordinary non-student residential stays in the main figures', () => {
  const h = house();
  const r = run(fixture({ ...h, leases: [lease({ property: h.p.id, type: 'WH' })] }), { segmentOverrides: { STR: [], COMMERCIAL: [], NON_STUDENT: [h.p.id] } });
  assert.equal(r.summary.student.occupied, 5);
});
test('segmentOf swap point: id list today, field tomorrow', () => {
  assert.equal(segmentOf({ id: 1, segmentField: 'Commercial' }, { STR: [], COMMERCIAL: [], NON_STUDENT: [] }), 'COMMERCIAL'); // custrecord_serp_property_type_cr
  assert.equal(segmentOf({ id: 1, segmentField: 'Land' }, { STR: [], COMMERCIAL: [], NON_STUDENT: [] }), 'COMMERCIAL');
  assert.equal(segmentOf({ id: 1, segmentField: 'Residential' }, { STR: [], COMMERCIAL: [], NON_STUDENT: [] }), 'STUDENT'); // the live default is not a segment
  assert.equal(segmentOf({ id: 1, segmentField: 'Residential' }, { STR: ['1'], COMMERCIAL: [], NON_STUDENT: [] }), 'STR'); // id list still applies to residential
  assert.equal(segmentOf({ id: 1 }, { STR: ['1'], COMMERCIAL: [], NON_STUDENT: [] }), 'STR');
  assert.equal(segmentOf({ id: 2 }, { STR: ['1'], COMMERCIAL: [], NON_STUDENT: [] }), 'STUDENT');
});
