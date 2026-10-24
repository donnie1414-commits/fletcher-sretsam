/**
 * §5.3 coverage, §5.7 exceptions, §5.7.1 overlap — place counted leases onto beds
 * for ONE academic year and ONE basis. Pure.
 *
 * placeLeases({ inventory, leases, ay, basis, flags, tolerance }) →
 *   { leafResults: Map(leafKey → LeafResult), leaseResults: Map(leaseId → LeaseResult),
 *     exceptions: Exception[], counted: number, placed: number }
 */
import { BASES, DEFAULT_BASIS, FEATURE_FLAGS, EXCEPTION_CODES, OVERLAP_TOLERANCE_DAYS } from '../constants.js';
import { levelOf } from './inventory.js';
import { yearEntry } from './lease.js';
import { collides, overlapDays } from './overlap.js';
import { splitPeople } from './people.js';
import { compare } from './dates.js';

const COLLISION_ORDER = ['WH_MULTI', 'WH_PLUS', 'PROP_HAS_WH', 'MULTI_UNIT', 'UNIT_PLUS_BED', 'UNIT_HAS', 'MULTI_BED'];

export function resolveScope(inv, l) {
  const fail = (code, detail) => ({ ok: false, code, detail: detail || null, level: null, leaves: [], beds: 0 });
  if (!l.typeKey) return fail('UNKNOWN_TYPE', l.typeRaw == null ? 'blank' : `value ${l.typeRaw}`);
  if (l.badDates) return fail('BAD_DATES', `${l.start} → ${l.end}`);
  if (l.missingDates) return fail('BAD_DATES', 'start or end date missing');
  const level = levelOf(inv, l.unitId);
  const unitRec = level === 'unit' ? inv.unitsById.get(l.unitId) : level === 'bedroom' ? inv.unitsById.get(inv.bedroomsById.get(l.unitId).unitId) : null;
  let property = inv.propertiesById.get(l.propertyId) || null;
  const notes = [];
  if (!property && unitRec) { property = inv.propertiesById.get(unitRec.propertyId) || null; if (property) notes.push('property taken from the linked unit'); }
  if (!property) return fail('NO_PROP', l.propertyId ? `property ${l.propertyId} missing or inactive` : 'blank');
  if (unitRec && unitRec.propertyId !== property.id) notes.push(`unit belongs to property ${unitRec.propertyId}, lease says ${property.id}`);

  let scope;
  if (l.typeKey === 'WH') {
    if (!l.unitId) scope = { level: 'property', propertyId: property.id, unitId: null, bedroomId: null, leaves: property.leaves };
    else if (level === 'unit') scope = { level: 'unit', propertyId: unitRec.propertyId, unitId: unitRec.id, bedroomId: null, leaves: unitRec.leaves };
    else if (level === 'bedroom') return fail('UNIT_ON_BED', 'whole-house lease linked to a bedroom record');
    else return fail('NOT_LINKED', `link ${l.unitId} points at a missing or inactive Units/Bedrooms record`);
  } else if (l.typeKey === 'UNIT') {
    if (!l.unitId) return fail('NOT_LINKED');
    if (level === 'unit') scope = { level: 'unit', propertyId: unitRec.propertyId, unitId: unitRec.id, bedroomId: null, leaves: unitRec.leaves };
    else if (level === 'bedroom') return fail('UNIT_ON_BED');
    else return fail('NOT_LINKED', `link ${l.unitId} points at a missing or inactive Units/Bedrooms record`);
  } else if (l.typeKey === 'BED') {
    if (!l.unitId) return fail('NOT_LINKED');
    if (level === 'bedroom') { const b = inv.bedroomsById.get(l.unitId); scope = { level: 'bedroom', propertyId: b.propertyId, unitId: b.unitId, bedroomId: b.id, leaves: [b] }; }
    else if (level === 'unit') return fail('BED_ON_UNIT');
    else return fail('NOT_LINKED', `link ${l.unitId} points at a missing or inactive Units/Bedrooms record`);
  } else return fail('UNKNOWN_TYPE', l.typeKey);

  scope.beds = scope.leaves.reduce((s, x) => s + x.beds, 0);
  if (scope.beds === 0) return { ...fail('ZERO_BEDS', `${scope.level} has 0 beds`), ...{ level: scope.level, propertyId: scope.propertyId, unitId: scope.unitId, bedroomId: scope.bedroomId } };
  return { ok: true, code: null, detail: notes.join('; ') || null, ...scope };
}

function exc(code, l, scope, ay, extra = {}) {
  const meta = EXCEPTION_CODES[code];
  return {
    code, severity: meta.severity, excludes: meta.excludes, label: meta.label,
    leaseId: l.id, leaseName: l.name, ay,
    propertyId: scope?.propertyId ?? l.propertyId ?? null, unitId: scope?.unitId ?? null, bedroomId: scope?.bedroomId ?? null,
    linkId: l.unitId, typeKey: l.typeKey, statusKey: l.statusKey, start: l.start, end: l.end, monthlyRent: l.monthlyRent,
    detail: extra.detail ?? scope?.detail ?? null, partners: extra.partners || [], overlapDays: extra.overlapDays ?? null,
  };
}

export function placeLeases({ inventory: inv, leases, ay, basis = DEFAULT_BASIS, flags = FEATURE_FLAGS, tolerance = OVERLAP_TOLERANCE_DAYS }) {
  const basisStatuses = new Set((BASES[basis] || BASES[DEFAULT_BASIS]).statuses);
  const requireOverlap = !!flags.requireOverlapForCollision;
  const leaseResults = new Map();
  const exceptions = [];
  const counted = []; // status ok + scope ok → eligible for placement, subject to collisions

  for (const l of leases) {
    if (l.inactive) continue;
    const year = yearEntry(l, ay);
    if (!year) continue;
    const scope = resolveScope(inv, l);
    const r = { lease: l, year, scope, status: 'skipped', code: null, flags: [], coveredBeds: scope.ok ? scope.beds : 0 };
    leaseResults.set(l.id, r);
    if (l.statusKey === 'NONE') { r.status = 'excluded'; r.code = 'NO_STATUS'; exceptions.push(exc('NO_STATUS', l, scope, ay)); if (!scope.ok) { exceptions.push(exc(scope.code, l, scope, ay)); } continue; }
    if (!basisStatuses.has(l.statusKey)) { r.status = 'skipped'; continue; } // OTHER, or IN_PROCESS under executed basis
    if (l.termMismatch) { r.flags.push('TERM_MISMATCH'); exceptions.push(exc('TERM_MISMATCH', l, scope, ay, { detail: `duration field ${l.durationField}, dates span ${l.dateMonths} months` })); }
    if (!scope.ok) { r.status = 'excluded'; r.code = scope.code; exceptions.push(exc(scope.code, l, scope, ay)); continue; }
    r.status = 'counted';
    counted.push(r);
  }

  // ---- collisions (first failing rule wins; one excluding code per lease) ----
  const assign = (r, code, partner, cls, days) => {
    if (cls === 'minor') { r.flags.push('OVERLAP_MINOR'); exceptions.push(exc('OVERLAP_MINOR', r.lease, r.scope, ay, { partners: [partner.lease.id], overlapDays: days })); return; }
    if (r.code) { if (!r.partners) r.partners = []; r.partners.push(partner.lease.id); return; }
    r.code = code; r.status = 'excluded'; r.partners = [partner.lease.id];
    r._pendingExc = { code, days };
  };
  const pairCheck = (a, b, codeA, codeB) => {
    const cls = collides(a.lease, b.lease, { requireOverlap, tolerance });
    if (cls === 'none') return;
    const days = requireOverlap ? overlapDays(a.lease, b.lease) : null;
    assign(a, codeA, b, cls, days);
    assign(b, codeB, a, cls, days);
  };
  const byProp = groupBy(counted, (r) => r.scope.propertyId);
  for (const rows of byProp.values()) {
    const P = rows.filter((r) => r.scope.level === 'property');
    const O = rows.filter((r) => r.scope.level !== 'property');
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) pairCheck(P[i], P[j], 'WH_MULTI', 'WH_MULTI');
    for (const p of P) for (const o of O) pairCheck(p, o, 'WH_PLUS', 'PROP_HAS_WH');
  }
  const byUnit = groupBy(counted.filter((r) => r.scope.unitId), (r) => r.scope.unitId);
  for (const rows of byUnit.values()) {
    const U = rows.filter((r) => r.scope.level === 'unit');
    const B = rows.filter((r) => r.scope.level === 'bedroom');
    for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) pairCheck(U[i], U[j], 'MULTI_UNIT', 'MULTI_UNIT');
    for (const u of U) for (const b of B) pairCheck(u, b, 'UNIT_PLUS_BED', 'UNIT_HAS');
  }
  const byBed = groupBy(counted.filter((r) => r.scope.level === 'bedroom'), (r) => r.scope.bedroomId);
  for (const rows of byBed.values()) for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) pairCheck(rows[i], rows[j], 'MULTI_BED', 'MULTI_BED');
  for (const r of counted) if (r._pendingExc) { exceptions.push(exc(r._pendingExc.code, r.lease, r.scope, ay, { partners: r.partners, overlapDays: r._pendingExc.days })); delete r._pendingExc; }

  // ---- tenant double-booking (flag, never excludes) ----
  const byTenant = new Map();
  for (const r of counted) for (const t of r.lease.tenantIds) { if (!byTenant.has(t)) byTenant.set(t, []); byTenant.get(t).push(r); }
  const doubles = new Map(); // tenant → set of lease ids
  for (const [t, rows] of byTenant) {
    if (rows.length < 2) continue;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const cls = collides(rows[i].lease, rows[j].lease, { requireOverlap, tolerance });
      if (cls !== 'collide') continue;
      if (!doubles.has(t)) doubles.set(t, new Set());
      doubles.get(t).add(rows[i].lease.id).add(rows[j].lease.id);
    }
  }
  const tenantDoubles = [];
  for (const [tenantId, ids] of doubles) {
    const rows = [...ids].map((id) => leaseResults.get(id));
    tenantDoubles.push({ tenantId, leases: rows.map((r) => ({ leaseId: r.lease.id, leaseName: r.lease.name, propertyId: r.scope.propertyId, unitId: r.scope.unitId, monthlyRent: r.lease.monthlyRent, start: r.lease.start, end: r.lease.end })) });
    for (const r of rows) { r.flags.push('TENANT_DOUBLE'); exceptions.push(exc('TENANT_DOUBLE', r.lease, r.scope, ay, { partners: rows.filter((x) => x !== r).map((x) => x.lease.id), detail: `tenant ${tenantId}` })); }
  }

  // ---- placement ----
  const leafResults = new Map();
  for (const leaf of inv.leaves) leafResults.set(leaf.key, { leaf, placements: [] });
  let placed = 0;
  for (const r of counted) {
    if (r.status !== 'counted') continue;
    r.status = 'placed'; placed++;
    const people = splitPeople(r.lease.tenantCount, r.scope.leaves.map((x) => x.beds));
    r.scope.leaves.forEach((leaf, k) => {
      const share = leaf.beds / r.scope.beds;
      leafResults.get(leaf.key).placements.push({
        leaseId: r.lease.id, typeKey: r.lease.typeKey, statusKey: r.lease.statusKey, months: r.year.months, carried: r.year.carried,
        monthlyShare: r.lease.monthlyRent * share, revenueShare: r.year.revenue * share, people: people[k],
        start: r.lease.start, end: r.lease.end, scopeLevel: r.scope.level,
      });
    });
  }
  for (const lr of leafResults.values()) finishLeaf(lr);
  return { leafResults, leaseResults, exceptions, tenantDoubles, counted: counted.length, placed, ay, basis, requireOverlap };
}

function finishLeaf(lr) {
  const ps = lr.placements;
  lr.occupied = ps.length ? lr.leaf.beds : 0;
  const monthsSum = ps.reduce((s, p) => s + p.months, 0);
  lr.months = Math.min(12, monthsSum);
  lr.monthly = ps.reduce((s, p) => s + p.monthlyShare, 0); // see ASSUMPTIONS A-8
  lr.annual = ps.reduce((s, p) => s + p.revenueShare, 0);
  let primary = null;
  for (const p of ps) if (!primary || p.months > primary.months || (p.months === primary.months && compare(p.start, primary.start) < 0)) primary = p;
  lr.primary = primary;
  lr.people = primary ? primary.people : 0;
  lr.typeKey = primary ? primary.typeKey : null;
  lr.carriedOnly = ps.length > 0 && ps.every((p) => p.carried);
  lr.sequential = ps.length > 1;
}

function groupBy(arr, keyFn) { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
