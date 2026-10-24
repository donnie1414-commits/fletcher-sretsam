/** Synthetic fixture builder for rule tests. Ids mirror the live lists so the same lookups apply. */
import { prepare, runEngine } from '../src/shared/rules/index.js';
import { placeLeases } from '../src/shared/rules/placement.js';
import { rollup, applyTargets } from '../src/shared/rules/metrics.js';

export const AYS = [
  { id: 7, name: 'AY 2025-2026' }, { id: 4, name: 'AY 2026-2027' }, { id: 2, name: 'AY 2027-2028' }, { id: 3, name: 'AY 2028-2029' },
];
export const AY_ID = { 2025: 7, 2026: 4, 2027: 2, 2028: 3 };
export const LISTS = {
  customlist_serp_lease_type_list: [{ id: 1, name: 'Whole House' }, { id: 2, name: 'Unit' }, { id: 3, name: 'Bedroom' }],
  customlist_serp_lease_status: [{ id: 1, name: 'Fully Executed' }, { id: 2, name: 'In Process' }],
  customlist_ad_leasing_stage: [{ id: 1, name: 'Renewal Declined' }, { id: 2, name: 'Lease Form Collection', isinactive: 'T' }, { id: 3, name: 'Ready For Lease - Waiting on Forms' }, { id: 4, name: 'Lease Out - Unsigned' }, { id: 5, name: 'Fully Executed' }, { id: 6, name: 'Offline' }, { id: 7, name: 'Renewal Offered' }],
};
export const TYPE = { WH: 1, UNIT: 2, BED: 3 };
export const STATUS = { EXECUTED: 1, IN_PROCESS: 2 };

let seq = 1000;
export const nextId = () => ++seq;

export function property(over = {}) {
  return { id: nextId(), name: `Prop ${seq}`, parent: null, isinactive: 'F', city: 'Bethlehem', state: 'Pennsylvania', subsidiary: 14, subsidiary_name: 'Amicus Pennsylvania LLC', prop_type: 1, prop_type_name: 'Residential', bedrooms: null, bed_count: null, total_units: null, ...over };
}
export function unit(propertyId, over = {}) { return { id: nextId(), name: `Unit ${seq}`, parent: null, property: propertyId, beds: null, isinactive: 'F', ...over }; }
export function bedroom(unitId, propertyId, over = {}) { return { id: nextId(), name: `Bedroom ${seq}`, parent: unitId, property: propertyId, beds: 1, isinactive: 'F', ...over }; }
/** lease({ property, unit, type:'WH'|'UNIT'|'BED', status:'EXECUTED'|'IN_PROCESS'|null, ay:2026, start, end, monthly, total, duration, tenants:[ids] }) */
export function lease(o) {
  const ay = o.ay === undefined ? 2026 : o.ay;
  return {
    id: o.id || nextId(), name: o.name || `Lease ${seq}`, isinactive: o.inactive ? 'T' : 'F',
    property: o.property ?? null, unit: o.unit ?? null,
    lease_type: o.type === null ? null : TYPE[o.type || 'UNIT'] ?? o.type,
    status: o.status === null ? null : STATUS[o.status || 'EXECUTED'],
    ay: ay == null ? null : AY_ID[ay], ay_name: ay == null ? null : `AY ${ay}-${ay + 1}`,
    start_date: o.start ?? '06/01/2026', end_date: o.end ?? '05/23/2027',
    duration_months: o.duration === undefined ? 12 : o.duration, monthly_rent: o.monthly ?? 1000, total_rent: o.total ?? null,
    tenant_count: o.tenantCount ?? (o.tenants ? o.tenants.length : 1), tenants: o.tenants ? o.tenants.join(', ') : '',
    sent_date: o.sent ?? null, signed_date: o.signed ?? null, signed_flag: o.signed ? 'T' : 'F', group_type: 1,
  };
}
/** A standard house: property with 2 units; unit A has 3 bedrooms, unit B has 2 bedrooms. Returns ids. */
export function house(over = {}) {
  const p = property(over.property);
  const uA = unit(p.id, { name: 'Unit A' }), uB = unit(p.id, { name: 'Unit B' });
  const bA = [1, 2, 3].map((i) => bedroom(uA.id, p.id, { name: `A-${i}` }));
  const bB = [1, 2].map((i) => bedroom(uB.id, p.id, { name: `B-${i}` }));
  return { p, uA, uB, bA, bB, properties: [p], units: [uA, uB, ...bA, ...bB] };
}
export function fixture({ properties = [], units = [], leases = [], targets = [] } = {}) {
  return { properties, units, leases, targets, academic_years: AYS, lists: LISTS };
}
export function run(fx, { ay = 2026, basis = 'proforma', flags = {}, segmentOverrides } = {}) {
  const prep = prepare(fx, segmentOverrides ? { segmentOverrides } : {});
  const placement = placeLeases({ inventory: prep.inventory, leases: prep.leases, ay, basis, flags: { requireOverlapForCollision: false, ...flags } });
  applyTargets(prep.inventory, placement.leafResults, prep.targets, ay);
  const r = rollup(prep.inventory, placement);
  return { prep, inventory: prep.inventory, leases: prep.leases, placement, ...r };
}
export const codesOf = (placement) => placement.exceptions.map((e) => e.code).sort();
export const codesFor = (placement, leaseId) => placement.exceptions.filter((e) => e.leaseId === String(leaseId)).map((e) => e.code).sort();
export const leafOf = (r, id) => [...r.placement.leafResults.values()].find((x) => x.leaf.id === String(id));
export { runEngine };
