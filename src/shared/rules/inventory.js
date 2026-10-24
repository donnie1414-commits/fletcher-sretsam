/**
 * §5.1 / §5.2 — Inventory: Fund ▸ Market ▸ Property ▸ Unit ▸ Bedroom, and beds.
 *
 * Input rows are plain objects as produced by the DAO / snapshot:
 *   property: { id, name, parent, isinactive, city, state, subsidiary, subsidiary_name,
 *               prop_type, prop_type_name, bedrooms, bed_count, total_units, nickname }
 *   unit    : { id, name, parent, property, beds, isinactive, rr_unit_id, occupied }
 *
 * Output (all ids are strings for stable Map keys):
 *   leaves     — the lowest-level bed-carrying records; the ONE denominator
 *   unitNodes  — pipeline rows: units (no parent) + unit-less leaf properties
 *   propertiesById, unitsById, bedroomsById
 *   issues     — data notes (orphan bedroom, inactive parent, …)
 *
 * Rules (§5.2, plus assumptions A-3/A-7 in docs/ASSUMPTIONS.md):
 *   bedroom beds   = bed count, blank ⇒ 1
 *   unit beds      = Σ bedroom beds when it has bedrooms, else its own count (blank ⇒ 0)
 *   property beds  = Σ unit beds when it has units; else its own bedroom count ONLY when it
 *                    also has no child properties (a parent "1717-1719 Whitaker" groups the
 *                    children that carry the units — counting its own number would double count)
 *   bedroom with blank property inherits its parent unit's property
 */
import { fundForSubsidiary, marketForCity } from '../constants.js';
import { segmentOf } from './segments.js';

const S = (v) => (v == null ? null : String(v));
const num = (v) => (v == null || v === '' ? null : Number(v));
const active = (r) => !r || r.isinactive !== 'T';

export function buildInventory({ properties = [], units = [] }, opts = {}) {
  const issues = [];
  const propertiesById = new Map();
  const unitsById = new Map();
  const bedroomsById = new Map();

  for (const p of properties) {
    if (!active(p)) continue;
    const market = marketForCity(p.city);
    propertiesById.set(S(p.id), {
      id: S(p.id), name: p.name, nickname: p.nickname || null, parentId: S(p.parent),
      city: p.city || null, state: p.state || null, marketId: market.id, marketLabel: market.label,
      subsidiaryId: S(p.subsidiary), subsidiaryName: p.subsidiary_name || null,
      fund: fundForSubsidiary(p.subsidiary_name) || (opts.subsidiaryFund && opts.subsidiaryFund[S(p.subsidiary)]) || null,
      propType: p.prop_type_name || null,
      segment: segmentOf({ id: p.id, segmentField: p.prop_type_name, propType: p.prop_type_name }, opts.segmentOverrides),
      ownBedroomCount: num(p.bedrooms), ownBedCount: num(p.bed_count), totalUnitsField: num(p.total_units),
      units: [], children: [], leaves: [], beds: 0, ownLeaf: null,
    });
  }
  for (const p of propertiesById.values()) {
    if (p.parentId && propertiesById.has(p.parentId)) propertiesById.get(p.parentId).children.push(p.id);
    if (p.parentId && !propertiesById.has(p.parentId)) issues.push({ code: 'PARENT_PROPERTY_MISSING', propertyId: p.id, detail: `parent ${p.parentId} missing/inactive` });
    if (!p.fund) issues.push({ code: 'FUND_UNMAPPED', propertyId: p.id, detail: `subsidiary "${p.subsidiaryName}"` });
    if (p.marketId === 'unknown' && p.segment !== 'COMMERCIAL') issues.push({ code: 'MARKET_UNMAPPED', propertyId: p.id, detail: `city "${p.city}"` });
  }

  // units first (parent IS NULL), then bedrooms
  const rawUnits = units.filter((u) => active(u) && u.parent == null);
  const rawBeds = units.filter((u) => active(u) && u.parent != null);
  for (const u of rawUnits) {
    unitsById.set(S(u.id), {
      id: S(u.id), name: u.name, propertyId: S(u.property), rrUnitId: u.rr_unit_id || null,
      ownBeds: num(u.beds), bedrooms: [], beds: 0, leaves: [], leaf: null, occupiedFlag: u.occupied === 'T',
    });
  }
  for (const b of rawBeds) {
    const parent = unitsById.get(S(b.parent));
    if (!parent) {
      // Orphan bedroom: parent missing or inactive. Treat as its own unit so its beds are not lost.
      issues.push({ code: 'ORPHAN_BEDROOM', unitId: S(b.id), detail: `parent ${b.parent} missing/inactive` });
      unitsById.set(S(b.id), { id: S(b.id), name: b.name, propertyId: S(b.property), rrUnitId: b.rr_unit_id || null, ownBeds: num(b.beds) ?? 1, bedrooms: [], beds: 0, leaves: [], leaf: null, orphanBedroom: true });
      continue;
    }
    const propertyId = S(b.property) || parent.propertyId;
    if (!S(b.property)) issues.push({ code: 'BEDROOM_PROPERTY_INHERITED', unitId: parent.id, bedroomId: S(b.id) });
    else if (propertyId !== parent.propertyId) issues.push({ code: 'BEDROOM_PROPERTY_MISMATCH', unitId: parent.id, bedroomId: S(b.id), detail: `bedroom→${propertyId} unit→${parent.propertyId}` });
    const beds = num(b.beds) == null ? 1 : num(b.beds);
    const leaf = { key: `b:${b.id}`, kind: 'bedroom', id: S(b.id), name: b.name, bedroomId: S(b.id), unitId: parent.id, propertyId: parent.propertyId, beds };
    bedroomsById.set(leaf.id, leaf);
    parent.bedrooms.push(leaf);
  }

  const leaves = [];
  for (const u of unitsById.values()) {
    u.bedrooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (u.bedrooms.length) {
      u.beds = u.bedrooms.reduce((s, b) => s + b.beds, 0);
      u.leaves = u.bedrooms;
      if (u.ownBeds != null && u.ownBeds !== u.beds) issues.push({ code: 'UNIT_BED_COUNT_DIFFERS', unitId: u.id, detail: `unit says ${u.ownBeds}, bedrooms sum ${u.beds}` });
    } else {
      u.beds = u.ownBeds == null ? 0 : u.ownBeds;
      u.leaf = { key: `u:${u.id}`, kind: 'unit', id: u.id, name: u.name, bedroomId: null, unitId: u.id, propertyId: u.propertyId, beds: u.beds };
      u.leaves = [u.leaf];
      if (u.beds === 0) issues.push({ code: 'UNIT_ZERO_BEDS', unitId: u.id, detail: 'no bedroom records and bed count 0/blank' });
    }
    const p = propertiesById.get(u.propertyId);
    if (!p) { issues.push({ code: 'UNIT_PROPERTY_MISSING', unitId: u.id, detail: `property ${u.propertyId}` }); }
    else { p.units.push(u.id); p.leaves.push(...u.leaves); }
    leaves.push(...u.leaves);
  }
  const unitNodes = [...unitsById.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const p of propertiesById.values()) {
    if (p.units.length === 0 && p.children.length === 0 && (p.ownBedroomCount || 0) > 0 && p.segment !== 'COMMERCIAL') {
      // Property-only leaf (§5.2 rule 3)
      p.ownLeaf = { key: `p:${p.id}`, kind: 'property', id: p.id, name: p.name, bedroomId: null, unitId: null, propertyId: p.id, beds: p.ownBedroomCount };
      p.leaves.push(p.ownLeaf);
      leaves.push(p.ownLeaf);
      unitNodes.push({ id: `p:${p.id}`, name: p.name, propertyId: p.id, rrUnitId: null, ownBeds: p.ownBedroomCount, bedrooms: [], beds: p.ownBedroomCount, leaves: [p.ownLeaf], leaf: p.ownLeaf, propertyOnly: true });
      issues.push({ code: 'PROPERTY_ONLY_LEAF', propertyId: p.id, detail: `no unit records; using property bedroom count ${p.ownBedroomCount}` });
    }
    p.beds = p.leaves.reduce((s, l) => s + l.beds, 0);
  }

  return { propertiesById, unitsById, bedroomsById, leaves, unitNodes, issues };
}

/** Resolve a Units/Bedrooms id to its level: 'unit' | 'bedroom' | null. */
export function levelOf(inv, unitsBedroomsId) {
  const id = S(unitsBedroomsId);
  if (id == null) return null;
  if (inv.bedroomsById.has(id)) return 'bedroom';
  if (inv.unitsById.has(id)) return 'unit';
  return null;
}

/** Fund ▸ Market ▸ Property ▸ Unit ▸ Bedroom tree skeleton (no metrics). */
export function buildTree(inv) {
  const funds = new Map();
  for (const p of inv.propertiesById.values()) {
    const fundKey = p.fund || 'UNMAPPED';
    if (!funds.has(fundKey)) funds.set(fundKey, { key: `f:${fundKey}`, kind: 'fund', id: fundKey, name: fundKey, children: new Map() });
    const f = funds.get(fundKey);
    if (!f.children.has(p.marketId)) f.children.set(p.marketId, { key: `m:${fundKey}:${p.marketId}`, kind: 'market', id: p.marketId, name: p.marketLabel, children: [] });
    const m = f.children.get(p.marketId);
    const pNode = { key: `p:${p.id}`, kind: 'property', id: p.id, name: p.name, segment: p.segment, children: [] };
    for (const uid of p.units) {
      const u = inv.unitsById.get(uid);
      pNode.children.push({ key: `u:${u.id}`, kind: 'unit', id: u.id, name: u.name, children: u.bedrooms.map((b) => ({ key: b.key, kind: 'bedroom', id: b.id, name: b.name, children: [] })) });
    }
    m.children.push(pNode);
  }
  return [...funds.values()].map((f) => ({ ...f, children: [...f.children.values()] }));
}
