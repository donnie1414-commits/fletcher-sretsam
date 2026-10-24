/**
 * Amicus Leasing Workspace — shared constants.
 *
 * ONE module, consumed by the server bundle, the client bundle and the tests.
 * Nothing in here is mirrored by hand anywhere else (§3.4).
 *
 * Rules of this file:
 *   - No NetSuite imports, no DOM, no Date.now().
 *   - List-value internal ids are NOT hardcoded here as the source of truth.
 *     Values are matched by label (case/space-insensitive) and the live ids are
 *     learned by the schema probe at startup (server) and shipped to the client
 *     in the bootstrap JSON. `*_ID_OVERRIDES` exist for the rare case where a
 *     label is ambiguous; they are filled from the probe write-up, never guessed.
 */

// ---------------------------------------------------------------------------
// Funds
// ---------------------------------------------------------------------------
export const FUNDS = Object.freeze({
  A1: { id: 'A1', label: 'Amicus I' },
  A2: { id: 'A2', label: 'Amicus II' },
  A3: { id: 'A3', label: 'Amicus III' },
});
export const FUND_ORDER = Object.freeze(['A1', 'A2', 'A3']);

/** Subsidiary name → fund. Order matters: first match wins. (§5.1) */
export const SUBSIDIARY_FUND_RULES = Object.freeze([
  { match: /alma\s*mater/i, fund: 'A3' },
  { match: /miami|\ba3\b|amicus\s*(3|iii)\b/i, fund: 'A3' },
  { match: /02908/i, fund: 'A1' },
  { match: /amicus\s*(1|i)\b/i, fund: 'A1' },
  { match: /troy/i, fund: 'A2' },
  { match: /pennsylvania|\bpa\b/i, fund: 'A2' },
  { match: /\bny\b|new\s*york/i, fund: 'A2' },
  { match: /amicus\s*(2|ii)\b/i, fund: 'A2' },
]);

// ---------------------------------------------------------------------------
// Markets (market = the property's city, normalised to one of these)
// ---------------------------------------------------------------------------
/**
 * `cities` are the raw city spellings that fold into the market.
 * `calendar` is the per-market AY lease calendar (§6.4): [month, day].
 * `university` is display-only.
 */
export const MARKETS = Object.freeze([
  { id: 'lehigh',      label: 'Bethlehem',   university: 'Lehigh',     cities: ['bethlehem', 'lehigh', 'fountain hill'], calendar: { start: [6, 15], end: [5, 22] } },
  { id: 'binghamton',  label: 'Binghamton',  university: 'Binghamton', cities: ['binghamton', 'vestal', 'johnson city'], calendar: { start: [6, 1],  end: [5, 23] } },
  { id: 'troy',        label: 'Troy',        university: 'RPI',        cities: ['troy'],                                  calendar: { start: [6, 1],  end: [5, 18] } },
  { id: 'providence',  label: 'Providence',  university: 'Brown/RISD', cities: ['providence', 'east providence'],         calendar: { start: [6, 22], end: [5, 23] } },
  { id: 'savannah',    label: 'Savannah',    university: 'SCAD',       cities: ['savannah'],                              calendar: { start: [6, 5],  end: [5, 31] } },
  { id: 'new-orleans', label: 'New Orleans', university: 'Tulane',     cities: ['new orleans'],                           calendar: { start: [6, 4],  end: [5, 27] } },
  { id: 'charleston',  label: 'Charleston',  university: 'CofC',       cities: ['charleston'],                            calendar: { start: [8, 5],  end: [7, 25] } },
  // Present in the live data (A3 Miami of Ohio, 72 properties / 680 beds) but not in the brief's seven markets.
  // No lease calendar was given for it: the lease dialog must say so rather than prefill. See ASSUMPTIONS A-4.
  { id: 'oxford',      label: 'Oxford',      university: 'Miami (OH)', cities: ['oxford'],                                calendar: null },
]);
export const UNKNOWN_MARKET = Object.freeze({ id: 'unknown', label: 'Unmapped city', cities: [], calendar: null });

// ---------------------------------------------------------------------------
// Academic year
// ---------------------------------------------------------------------------
/**
 * Academic years run roughly June → May. When a lease has to be assigned to an
 * AY from a DATE (two-year carry, start-date anchoring, weekly alignment), the
 * boundary is this month/day. ASSUMPTION — see docs/ASSUMPTIONS.md A-1.
 */
export const AY_BOUNDARY = Object.freeze({ month: 6, day: 1 });

/** Term length in months at or above which a lease is treated as two-year (§5.3). */
export const TWO_YEAR_MIN_MONTHS = 15;

/** Days of overlap between sequential leases tolerated as ordinary turnover (§5.7.1). */
export const OVERLAP_TOLERANCE_DAYS = 7;

/** A unit sitting in a human-owned stage longer than this shows on Today (§6.1). */
export const STALE_STAGE_DAYS = 14;

// ---------------------------------------------------------------------------
// Feature flags (defaults; the server may override from a deployment parameter)
// ---------------------------------------------------------------------------
export const FEATURE_FLAGS = Object.freeze({
  /** §5.7.1 — collisions require date overlap. OFF until the delta report is signed off. */
  requireOverlapForCollision: false,
});

// ---------------------------------------------------------------------------
// Lease types (§5.3)
// ---------------------------------------------------------------------------
export const LEASE_TYPES = Object.freeze({
  WH:   { key: 'WH',   label: 'Whole House', short: 'WH',   labels: ['whole house', 'whole-house', 'house', 'wh'] },
  UNIT: { key: 'UNIT', label: 'Unit',        short: 'Unit', labels: ['unit', 'apartment', 'apt'] },
  BED:  { key: 'BED',  label: 'Bedroom',     short: 'Bed',  labels: ['bedroom', 'bed', 'room', 'by the bed', 'by bed'] },
});
export const LEASE_TYPE_ID_OVERRIDES = Object.freeze({ /* listValueId: 'WH'|'UNIT'|'BED' — filled from probe */ });

// ---------------------------------------------------------------------------
// Lease statuses (§5.3)
// ---------------------------------------------------------------------------
export const LEASE_STATUSES = Object.freeze({
  EXECUTED:   { key: 'EXECUTED',   label: 'Fully Executed', labels: ['fully executed', 'executed', 'fully-executed'] },
  IN_PROCESS: { key: 'IN_PROCESS', label: 'In Process',     labels: ['in process', 'in-process', 'sent', 'out for signature'] },
  OTHER:      { key: 'OTHER',      label: 'Other',          labels: [] },
  NONE:       { key: 'NONE',       label: 'No status',      labels: [] },
});
export const LEASE_STATUS_ID_OVERRIDES = Object.freeze({ /* listValueId: key */ });

/** Basis → set of counted status keys. Pro-forma is the default (§5.3). */
export const BASES = Object.freeze({
  proforma: { id: 'proforma', label: 'Pro-forma', statuses: ['EXECUTED', 'IN_PROCESS'] },
  executed: { id: 'executed', label: 'Fully Executed', statuses: ['EXECUTED'] },
});
export const DEFAULT_BASIS = 'proforma';

// ---------------------------------------------------------------------------
// Pipeline stages (§5.4) — funnel order is defined HERE, never by list id
// ---------------------------------------------------------------------------
export const STAGE_OWNER = Object.freeze({ DEFAULT: 'default', HUMAN: 'human', LEASE: 'lease' });

export const STAGES = Object.freeze([
  { key: 'NONE',             order: 0, owner: 'default', label: 'No stage set',                       labels: ['', 'no stage set', 'none', 'not started'] },
  { key: 'RENEWAL_OFFERED',  order: 1, owner: 'human',   label: 'Renewal Offered',                    labels: ['renewal offered'] },
  { key: 'IN_NEGOTIATIONS',  order: 2, owner: 'human',   label: 'In Negotiations',                    labels: ['in negotiations', 'in negotiation', 'negotiating'] },
  { key: 'RENEWAL_DECLINED', order: 3, owner: 'human',   label: 'Renewal Declined',                   labels: ['renewal declined', 'declined'] },
  { key: 'READY_FOR_LEASE',  order: 4, owner: 'human',   label: 'Ready For Lease - Waiting on Forms', labels: ['ready for lease - waiting on forms', 'ready for lease', 'waiting on forms'] },
  { key: 'OFFLINE',          order: 5, owner: 'human',   label: 'Offline',                            labels: ['offline', 'off line', 'not leasing'] },
  { key: 'LEASE_OUT',        order: 6, owner: 'lease',   label: 'Lease Out - Unsigned',               labels: ['lease out - unsigned', 'lease out', 'unsigned', 'lease sent'] },
  { key: 'FULLY_EXECUTED',   order: 7, owner: 'lease',   label: 'Fully Executed',                     labels: ['fully executed', 'executed', 'leased'] },
]);

/**
 * Retired list values fold onto a live stage ON READ and are excluded from
 * every picker and legend by construction (§3.4). Keyed by lower-cased label
 * (and, once probed, by id in STAGE_ID_OVERRIDES).
 */
export const RETIRED_STAGE_FOLD = Object.freeze({
  'renewal accepted': 'READY_FOR_LEASE',
  'lease out - signed': 'FULLY_EXECUTED',
});
export const STAGE_ID_OVERRIDES = Object.freeze({ /* listValueId: stageKey — filled from probe */ });

export const STAGE_SOURCE = Object.freeze({ MANUAL: 'manual', LEASE: 'lease' });

// ---------------------------------------------------------------------------
// Lease dialog (§6.4)
// ---------------------------------------------------------------------------
export const GROUP_TYPES = Object.freeze([
  { key: 'NEW',       label: 'New Group' },
  { key: 'TRANSFER',  label: 'Transfers' },
  { key: 'RENEWAL',   label: 'Renewal' },
]);
export const UTILITIES = Object.freeze([
  { key: 'water', label: 'Water included' },
  { key: 'gas',   label: 'Gas included' },
]);

// ---------------------------------------------------------------------------
// Property segments (§5.8)
// ---------------------------------------------------------------------------
export const SEGMENTS = Object.freeze({
  STUDENT:      { key: 'STUDENT',      label: 'Student',                 beds: true,  inOccupancy: true,  inPrelease: true  },
  NON_STUDENT:  { key: 'NON_STUDENT',  label: 'Non-student residential', beds: true,  inOccupancy: true,  inPrelease: true  }, // stays in main figures
  STR:          { key: 'STR',          label: 'Short-term rental',       beds: true,  inOccupancy: false, inPrelease: false }, // reported separately
  COMMERCIAL:   { key: 'COMMERCIAL',   label: 'Commercial / land / office', beds: false, inOccupancy: false, inPrelease: false }, // rent only
});
/**
 * Segment source. The probe found that the Property record DOES carry a type
 * field — custrecord_serp_property_type_cr (customlist830: Residential /
 * Commercial / Land / Office; 86 of 812 blank) — so commercial/land/office come
 * from the field. There is still no field for short-term rentals or non-student
 * residential, so those remain hardcoded id lists below. SWAP POINT: when such a
 * field exists, map its values in rules/segments.js SEGMENT_FIELD_VALUES and
 * empty the lists; nothing else changes. See docs/ASSUMPTIONS.md A-6.
 */
export const SEGMENT_FIELD_ID = 'custrecord_serp_property_type_cr';
export const SEGMENT_PROPERTY_IDS = Object.freeze({
  STR: Object.freeze([]),
  COMMERCIAL: Object.freeze([]),
  NON_STUDENT: Object.freeze([]),
});

// ---------------------------------------------------------------------------
// Exceptions (§5.7) — severity: 1 highest
// ---------------------------------------------------------------------------
export const EXCEPTION_CODES = Object.freeze({
  WH_MULTI:      { code: 'WH_MULTI',      severity: 1, excludes: true,  label: 'Multiple whole-house leases on property',
                   meaning: 'More than one property-wide whole-house lease is active for this academic year at the same time.',
                   action: 'Keep one; link the others to the specific unit they cover or inactivate the duplicate.' },
  WH_PLUS:       { code: 'WH_PLUS',       severity: 1, excludes: true,  label: 'Whole-house lease + unit/bedroom leases on same property',
                   meaning: 'A property-wide whole-house lease overlaps unit or bedroom leases at the same property.',
                   action: 'If the house is part-let, change this lease to Unit or Bedroom and link it; otherwise inactivate the unit/bedroom leases.' },
  PROP_HAS_WH:   { code: 'PROP_HAS_WH',   severity: 2, excludes: true,  label: 'Property also has a whole-house lease',
                   meaning: 'This unit/bedroom lease overlaps a property-wide whole-house lease.',
                   action: 'Resolve the whole-house lease first (WH_PLUS); this row clears with it.' },
  MULTI_UNIT:    { code: 'MULTI_UNIT',    severity: 1, excludes: true,  label: 'Multiple leases on same unit/house',
                   meaning: 'Two or more unit-level leases claim the same unit at the same time.',
                   action: 'Relink one lease to the correct unit, correct its dates, or inactivate the duplicate.' },
  UNIT_PLUS_BED: { code: 'UNIT_PLUS_BED', severity: 1, excludes: true,  label: 'Unit/house lease + bedroom lease(s) in same unit',
                   meaning: 'A unit-level lease overlaps bedroom leases inside the same unit.',
                   action: 'If the unit is let by the bedroom, change this lease to Bedroom and link the bedroom; otherwise inactivate the bedroom leases.' },
  UNIT_HAS:      { code: 'UNIT_HAS',      severity: 2, excludes: true,  label: 'Unit also has a unit or whole-house lease',
                   meaning: 'This bedroom lease overlaps a unit-level lease on the same unit.',
                   action: 'Resolve the unit-level lease first (UNIT_PLUS_BED); this row clears with it.' },
  MULTI_BED:     { code: 'MULTI_BED',     severity: 1, excludes: true,  label: 'Multiple bedroom leases on same bedroom',
                   meaning: 'Two or more bedroom leases claim the same bedroom at the same time.',
                   action: 'Relink one lease to the right bedroom, correct the dates, or inactivate the duplicate.' },
  UNIT_ON_BED:   { code: 'UNIT_ON_BED',   severity: 2, excludes: true,  label: 'Unit lease linked to a bedroom record',
                   meaning: 'The lease type says Unit (or Whole House) but the linked record is a bedroom.',
                   action: 'Relink to the parent unit, or change the lease type to Bedroom.' },
  BED_ON_UNIT:   { code: 'BED_ON_UNIT',   severity: 2, excludes: true,  label: 'Bedroom lease linked to a unit record',
                   meaning: 'The lease type says Bedroom but the linked record is a unit.',
                   action: 'Relink to the specific bedroom, or change the lease type to Unit.' },
  NOT_LINKED:    { code: 'NOT_LINKED',    severity: 2, excludes: true,  label: 'Not linked to a unit/bedroom record',
                   meaning: 'A unit or bedroom lease has no Units/Bedrooms link, so the engine cannot tell which beds it covers.',
                   action: 'Set the Units/Bedrooms link on the lease.' },
  ZERO_BEDS:     { code: 'ZERO_BEDS',     severity: 3, excludes: true,  label: 'Linked record has 0 beds in NetSuite',
                   meaning: 'The covered scope has no beds, so the lease cannot occupy anything.',
                   action: 'Set the bed count on the unit or bedroom record.' },
  NO_PROP:       { code: 'NO_PROP',       severity: 2, excludes: true,  label: 'Property not found in NetSuite',
                   meaning: 'The lease points at a property that is missing or inactive.',
                   action: 'Set the Property on the lease to an active property.' },
  UNKNOWN_TYPE:  { code: 'UNKNOWN_TYPE',  severity: 2, excludes: true,  label: 'Unknown lease type',
                   meaning: 'The lease type is blank or not one of Whole House / Unit / Bedroom.',
                   action: 'Set the lease type.' },
  BAD_DATES:     { code: 'BAD_DATES',     severity: 2, excludes: true,  label: 'End date is before the start date',
                   meaning: 'The lease dates are inverted, so its term and academic year cannot be computed.',
                   action: 'Correct the start or end date.' },
  TERM_MISMATCH: { code: 'TERM_MISMATCH', severity: 4, excludes: false, label: 'Duration says two years but the dates cover one',
                   meaning: 'The duration field is 15+ months but the dates span fewer. The dates are used.',
                   action: 'Correct the duration field or the end date.' },
  TENANT_DOUBLE: { code: 'TENANT_DOUBLE', severity: 1, excludes: false, label: 'Same tenant on two overlapping leases',
                   meaning: 'One tenant is attached to two leases whose dates overlap, so their rent is counted twice.',
                   action: 'Remove the tenant from the lease they are not on, or correct the dates.' },
  OVERLAP_MINOR: { code: 'OVERLAP_MINOR', severity: 5, excludes: false, label: 'Overlaps by a few days',
                   meaning: `Sequential leases on the same scope overlap by at most ${OVERLAP_TOLERANCE_DAYS} days — treated as ordinary turnover.`,
                   action: 'No action needed unless the overlap is unintended.' },
  NO_STATUS:     { code: 'NO_STATUS',     severity: 4, excludes: true,  label: 'Lease has no status',
                   meaning: 'A lease without a status is excluded from every statistic but stays visible (§5.3).',
                   action: 'Set the lease status once the lease has been sent.' },
});
export const EXCEPTION_ORDER = Object.freeze(
  Object.values(EXCEPTION_CODES).sort((a, b) => a.severity - b.severity || a.code.localeCompare(b.code)).map((e) => e.code),
);

// ---------------------------------------------------------------------------
// Pipeline record field ids (§5.4) — the ONLY place these are spelled out
// ---------------------------------------------------------------------------
export const UAS = Object.freeze({
  TYPE: 'customrecord_ad_unit_ay_status',
  UNIT: 'custrecord_ad_uas_unit',
  AY: 'custrecord_ad_uas_ay',
  PROPERTY: 'custrecord_ad_uas_property',
  STAGE: 'custrecord_ad_uas_stage',
  MANUAL_STAGE: 'custrecord_ad_uas_manual_stage',
  STAGE_SOURCE: 'custrecord_ad_uas_stage_source',
  STAGE_DATE: 'custrecord_ad_uas_stage_date',
  LEASE: 'custrecord_ad_uas_lease',
  LAST_OFFER: 'custrecord_ad_uas_last_offer',
  FOLLOWUP: 'custrecord_ad_uas_followup',
  NOTES: 'custrecord_ad_uas_notes',
  EXPECTED_TENANTS: 'custrecord_ad_uas_expected_tenants',
  LEASE_TERMS: 'custrecord_ad_uas_lease_terms',
});
export const UAS_NOTE = Object.freeze({
  TYPE: 'customrecord_ad_uas_note',
  // child field ids are probed (parent link, author, body, created); see schema.js
});
export const STAGE_LIST = 'customlist_ad_leasing_stage';

// ---------------------------------------------------------------------------
// Lease record field ids (§5.5.1 + rentroom-skill-confirmed ids)
// ---------------------------------------------------------------------------
export const LEASE = Object.freeze({
  TYPE: 'customrecord_serp_lease_record',
  PROPERTY: 'custrecord_property',
  UNIT: 'custrecord_unitsbedroom',
  AY: 'custrecord_serp_lease_academic_year',
  STATUS: 'custrecord_serp_lease_status',
  START: 'custrecord_serp_lease_start_date',
  END: 'custrecord_serp_lease_end_date',
  MONTHLY_RENT: 'custrecord_monthly_actual_rent',
  TENANT_COUNT: 'custrecord_serp_number_of_tenants',
  TENANTS: 'custrecord_serp_tenants_',
  TENANTS_MAP: 'MAP_customrecord_serp_lease_record_custrecord_serp_tenants_',
  RR_UNIT_ID: 'custrecord_serp_rr_unit_id',
  // Probed (ids unknown until step 1 runs): lease type, duration months,
  // total rent, sent date, signed date, utilities, group type, provisions, notes.
});

export const PROPERTY = Object.freeze({
  TYPE: 'customrecord_serp_property_record',
  CITY: 'custrecord_serp_prop_city',
  STATE: 'custrecord_test_state',
  SUBSIDIARY: 'custrecord_serp_proj_subsidiary',
});
export const UNIT = Object.freeze({
  TYPE: 'customrecord_serp_units_bedrooms',
  BEDS: 'custrecord_serp_number_of_beds',
  RR_UNIT_ID: 'custrecord_serp_rentroom_unit_id',
  // parent / property field ids are probed
});

// ---------------------------------------------------------------------------
// Customer (tenant) field ids (§5.5.1)
// ---------------------------------------------------------------------------
export const CUSTOMER = Object.freeze({
  TYPE: 'customer',
  PROPERTY: 'custentity_serp_ent_property',
  AY: 'custentity_serp_academic_year',
  PROPERTY_MAP: 'map_customer_custentity_serp_ent_property',
  AY_MAP: 'map_customer_custentity_serp_academic_year',
  RR_UPLOAD_STATUS: 'custentity14',
});
export const TENANT_STATUSES = Object.freeze([
  { key: 'TENANT_NEW',       label: 'Tenant - New',        labels: ['tenant - new', 'tenant-new'] },
  { key: 'TENANT_INQUIRING', label: 'Tenant - Inquiring',  labels: ['tenant - inquiring'] },
  { key: 'TENANT_CLOSED_WON',label: 'Tenant - Closed Won', labels: ['tenant - closed won'] },
]);

// ---------------------------------------------------------------------------
// Market lock (§5.10)
// ---------------------------------------------------------------------------
export const MARKET_LOCK = Object.freeze({
  SCRIPT_PARAM_MARKETS: 'custscript_lkr_markets',
  SCRIPT_PARAM_LOCK: 'custscript_lkr_user_lock',
  EMPLOYEE_FIELD: 'custentity_lkr_markets',
});

// ---------------------------------------------------------------------------
// New records / fields this app needs (named here so the setup checklist and
// the code agree by construction — §9)
// ---------------------------------------------------------------------------
export const SAVED_VIEW = Object.freeze({
  TYPE: 'customrecord_ad_saved_view',
  OWNER: 'custrecord_ad_sv_owner',
  WORKSPACE: 'custrecord_ad_sv_workspace',
  NAME: 'custrecord_ad_sv_name',
  JSON: 'custrecord_ad_sv_json',
  IS_DEFAULT: 'custrecord_ad_sv_default',
  SHARED_MARKETS: 'custrecord_ad_sv_shared_markets',
});
export const TOUR = Object.freeze({
  TYPE: 'calendarevent',
  UNIT: 'custevent_ad_tour_unit',
  OUTCOME: 'custevent_ad_tour_outcome',
  AY: 'custevent_ad_tour_ay',
  OUTCOME_LIST: 'customlist_ad_tour_outcome',
});
export const TOUR_OUTCOMES = Object.freeze([
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'NO_SHOW',   label: 'No-show' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'LEASED',    label: 'Leased' },
]);
export const AUDIT = Object.freeze({
  TYPE: 'customrecord_ad_write_audit',
  WHO: 'custrecord_ad_wa_who',
  WHEN: 'custrecord_ad_wa_when',
  RECORD_TYPE: 'custrecord_ad_wa_rectype',
  RECORD_ID: 'custrecord_ad_wa_recid',
  FIELD: 'custrecord_ad_wa_field',
  BEFORE: 'custrecord_ad_wa_before',
  AFTER: 'custrecord_ad_wa_after',
  CHANGE_ID: 'custrecord_ad_wa_change_id',
});

// ---------------------------------------------------------------------------
// Governance (§2)
// ---------------------------------------------------------------------------
export const GOVERNANCE = Object.freeze({
  REQUEST_UNITS: 1000,
  SUBMIT_FIELDS: 2,
  RECORD_SAVE: 4,
  RECORD_LOAD: 2,
  SUITEQL_PAGE: 10,
  RESERVE: 100, // never dip below this; return partial results instead
});

// ---------------------------------------------------------------------------
// UI (§7) — one accent, one warning, chart palette defined once for both themes
// ---------------------------------------------------------------------------
export const THEME = Object.freeze({
  accent: '#2F5FD0',
  warning: '#C2410C',
  chart: Object.freeze({
    light: Object.freeze(['#2F5FD0', '#8A94A6', '#C2410C', '#4B5563', '#9DB4EC']),
    dark:  Object.freeze(['#7FA3F5', '#8A94A6', '#F0864A', '#B8C0CC', '#3E5FA8']),
  }),
});

// ---------------------------------------------------------------------------
// Helpers shared by both sides
// ---------------------------------------------------------------------------
export function normLabel(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*-\s*/g, ' - ');
}
function byLabel(table, value, idOverrides) {
  if (value == null) return null;
  const v = String(value);
  if (idOverrides && Object.prototype.hasOwnProperty.call(idOverrides, v)) return idOverrides[v];
  const n = normLabel(v);
  for (const entry of Array.isArray(table) ? table : Object.values(table)) {
    if (normLabel(entry.label) === n) return entry.key;
    if (entry.labels && entry.labels.some((l) => normLabel(l) === n)) return entry.key;
  }
  return null;
}
export function leaseTypeKey(value, overrides = LEASE_TYPE_ID_OVERRIDES) { return byLabel(LEASE_TYPES, value, overrides); }
export function leaseStatusKey(value, overrides = LEASE_STATUS_ID_OVERRIDES) {
  if (value == null || String(value).trim() === '') return 'NONE';
  return byLabel(LEASE_STATUSES, value, overrides) || 'OTHER';
}
export function fundForSubsidiary(name) {
  if (!name) return null;
  for (const r of SUBSIDIARY_FUND_RULES) if (r.match.test(name)) return r.fund;
  return null;
}
export function marketForCity(city) {
  const c = normLabel(city);
  if (!c) return UNKNOWN_MARKET;
  for (const m of MARKETS) if (m.cities.includes(c) || m.id === c || normLabel(m.label) === c) return m;
  return UNKNOWN_MARKET;
}
export function stageByKey(key) { return STAGES.find((s) => s.key === key) || STAGES[0]; }
export function humanStages() { return STAGES.filter((s) => s.owner === STAGE_OWNER.HUMAN); }
export function leaseDrivenStages() { return STAGES.filter((s) => s.owner === STAGE_OWNER.LEASE); }
/** Fold any stage id/label (live or retired) onto a stage key. Unknown → NONE, reported by caller. */
export function foldStage(value, overrides = STAGE_ID_OVERRIDES) {
  if (value == null || String(value).trim() === '') return 'NONE';
  const v = String(value);
  if (STAGES.some((s) => s.key === v)) return v; // already a stage key (a probed id → key lookup feeds effectiveStage)
  if (Object.prototype.hasOwnProperty.call(overrides, v)) return overrides[v];
  const n = normLabel(v);
  if (Object.prototype.hasOwnProperty.call(RETIRED_STAGE_FOLD, n)) return RETIRED_STAGE_FOLD[n];
  return byLabel(STAGES, v, null);
}
