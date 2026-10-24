import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory } from '../../src/shared/rules/inventory.js';
import { property, unit, bedroom, house } from '../helpers.js';

test('bedroom bed count blank ⇒ 1; unit beds = Σ bedrooms', () => {
  const h = house();
  h.bA[0].beds = null; h.bA[1].beds = 2;
  const inv = buildInventory({ properties: h.properties, units: h.units });
  assert.equal(inv.unitsById.get(String(h.uA.id)).beds, 1 + 2 + 1);
  assert.equal(inv.propertiesById.get(String(h.p.id)).beds, 4 + 2);
  assert.equal(inv.leaves.length, 5);
});
test('a unit with no bedroom records uses its own bed count (blank ⇒ 0, flagged)', () => {
  const p = property(); const u1 = unit(p.id, { beds: 4 }); const u2 = unit(p.id, { beds: null });
  const inv = buildInventory({ properties: [p], units: [u1, u2] });
  assert.equal(inv.unitsById.get(String(u1.id)).beds, 4);
  assert.equal(inv.unitsById.get(String(u1.id)).leaf.kind, 'unit');
  assert.equal(inv.unitsById.get(String(u2.id)).beds, 0);
  assert.ok(inv.issues.some((i) => i.code === 'UNIT_ZERO_BEDS' && i.unitId === String(u2.id)));
  assert.equal(inv.leaves.length, 2);
});
test('a property with no unit records uses its own bedroom count and becomes a pipeline row', () => {
  const p = property({ bedrooms: 5 });
  const inv = buildInventory({ properties: [p], units: [] });
  assert.equal(inv.propertiesById.get(String(p.id)).beds, 5);
  assert.equal(inv.leaves[0].kind, 'property');
  assert.equal(inv.unitNodes.length, 1);
  assert.ok(inv.unitNodes[0].propertyOnly);
});
test('a parent property whose children carry the units contributes no beds of its own (A-3)', () => {
  const parent = property({ name: '1717-1719 Whitaker St', bedrooms: 6 });
  const c1 = property({ name: '1717 Whitaker St', parent: parent.id, bedrooms: 3 });
  const c2 = property({ name: '1719 Whitaker St', parent: parent.id, bedrooms: 3 });
  const u1 = unit(c1.id, { beds: 3 }), u2 = unit(c2.id, { beds: 3 });
  const inv = buildInventory({ properties: [parent, c1, c2], units: [u1, u2] });
  assert.equal(inv.propertiesById.get(String(parent.id)).beds, 0);
  assert.equal(inv.leaves.reduce((s, l) => s + l.beds, 0), 6);
  assert.equal(inv.unitNodes.length, 2);
});
test('a bedroom with a blank property inherits its parent unit\'s property', () => {
  const p = property(); const u = unit(p.id); const b = bedroom(u.id, null);
  const inv = buildInventory({ properties: [p], units: [u, b] });
  assert.equal(inv.bedroomsById.get(String(b.id)).propertyId, String(p.id));
  assert.ok(inv.issues.some((i) => i.code === 'BEDROOM_PROPERTY_INHERITED'));
});
test('inactive records are not inventory; an orphan bedroom is kept as its own unit so beds are not lost', () => {
  const p = property(); const u = unit(p.id, { isinactive: 'T' }); const b = bedroom(u.id, p.id);
  const inv = buildInventory({ properties: [p], units: [u, b] });
  assert.equal(inv.unitsById.has(String(u.id)), false);
  assert.ok(inv.issues.some((i) => i.code === 'ORPHAN_BEDROOM'));
  assert.equal(inv.leaves.reduce((s, l) => s + l.beds, 0), 1);
});
test('fund comes from the subsidiary rollup and market from the city', () => {
  const rows = [
    [property({ subsidiary_name: 'Amicus 1', city: 'Providence' }), 'A1', 'providence'],
    [property({ subsidiary_name: '02908 Holdco LLC', city: 'Providence' }), 'A1', 'providence'],
    [property({ subsidiary_name: 'Amicus 2', city: 'Savannah' }), 'A2', 'savannah'],
    [property({ subsidiary_name: 'Amicus Pennsylvania LLC', city: 'Bethlehem' }), 'A2', 'lehigh'],
    [property({ subsidiary_name: 'Amicus NY, LLC', city: 'Binghamton' }), 'A2', 'binghamton'],
    [property({ subsidiary_name: 'Amicus Troy NY, LLC', city: 'Troy' }), 'A2', 'troy'],
    [property({ subsidiary_name: 'Alma Mater REIT LLC', city: 'New Orleans' }), 'A3', 'new-orleans'],
    [property({ subsidiary_name: 'A3 Miami 1 LLC', city: 'Oxford' }), 'A3', 'oxford'],
    [property({ subsidiary_name: 'Amicus Miami of Ohio', city: 'Charleston' }), 'A3', 'charleston'],
  ];
  const inv = buildInventory({ properties: rows.map((r) => r[0]), units: [] });
  for (const [p, fund, market] of rows) { const n = inv.propertiesById.get(String(p.id)); assert.equal(n.fund, fund, p.subsidiary_name); assert.equal(n.marketId, market, p.city); }
});
