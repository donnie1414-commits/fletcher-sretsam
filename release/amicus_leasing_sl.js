/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Amicus Leasing Workspace — entry. Routing only (§4). Built by tools/build.js into dist/amicus_leasing_sl.js.
 */
define(["N/query","N/record","N/runtime","N/log","N/file","N/cache"], function (__n0, __n1, __n2, __n3, __n4, __n5) {
  'use strict';
  var __N = {"N/query": __n0, "N/record": __n1, "N/runtime": __n2, "N/log": __n3, "N/file": __n4, "N/cache": __n5};
  var require = function (id) { if (Object.prototype.hasOwnProperty.call(__N, id)) return __N[id]; throw new Error('module not available in the server bundle: ' + id); };
  var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/suitelet.js
var suitelet_exports = {};
__export(suitelet_exports, {
  onRequest: () => onRequest
});
module.exports = __toCommonJS(suitelet_exports);
var import_query = __toESM(require("N/query"), 1);
var import_record = __toESM(require("N/record"), 1);
var import_runtime = __toESM(require("N/runtime"), 1);
var import_log = __toESM(require("N/log"), 1);
var import_file = __toESM(require("N/file"), 1);
var import_cache = __toESM(require("N/cache"), 1);

// src/server/schema.js
var probeCache = /* @__PURE__ */ new Map();
function createSchema({ query: query2, log: log2, cache: cache2 = null, cacheTtl = 3600 }) {
  const degraded = [];
  function loadCached(table) {
    if (probeCache.has(table)) return probeCache.get(table);
    if (cache2) {
      try {
        const raw = cache2.get({ key: `schema:${table}`, loader: () => null });
        if (raw) {
          const m2 = new Map(Object.entries(JSON.parse(raw)));
          probeCache.set(table, m2);
          return m2;
        }
      } catch (e) {
      }
    }
    const m = /* @__PURE__ */ new Map();
    probeCache.set(table, m);
    return m;
  }
  function persist(table, m) {
    if (!cache2) return;
    try {
      cache2.put({ key: `schema:${table}`, value: JSON.stringify(Object.fromEntries(m)), ttl: cacheTtl });
    } catch (e) {
    }
  }
  function exists(table, fields) {
    try {
      query2.runSuiteQL({ query: `SELECT ${fields.join(", ")} FROM ${table} WHERE ROWNUM <= 1` });
      return fields.map(() => true);
    } catch (e) {
      if (fields.length === 1) {
        log2 && log2.audit && log2.audit({ title: "schema probe", details: `${table}.${fields[0]} missing: ${e && e.message}` });
        return [false];
      }
      const mid = Math.ceil(fields.length / 2);
      return exists(table, fields.slice(0, mid)).concat(exists(table, fields.slice(mid)));
    }
  }
  function probe(table, fields) {
    const m = loadCached(table);
    const unknown = fields.filter((f) => !m.has(f));
    if (unknown.length) {
      const res = exists(table, unknown);
      unknown.forEach((f, i) => m.set(f, res[i]));
      persist(table, m);
    }
    return m;
  }
  function projection(table, specs) {
    const optional = specs.filter((s) => s.optional).map((s) => s.field);
    const have = optional.length ? probe(table, optional) : /* @__PURE__ */ new Map();
    const parts2 = [], missing = [];
    for (const s of specs) {
      const alias2 = s.as || s.field;
      if (s.optional && have.get(s.field) === false) {
        parts2.push(`NULL AS ${alias2}`);
        missing.push(s.field);
        degrade(table, s);
        continue;
      }
      parts2.push(s.expr ? `${s.expr} AS ${alias2}` : s.as ? `${s.field} AS ${s.as}` : s.field);
    }
    return { select: parts2.join(", "), missing };
  }
  function degrade(table, s) {
    if (degraded.some((d) => d.table === table && d.field === s.field)) return;
    degraded.push({ table, field: s.field, feature: s.feature || null });
    log2 && log2.error && log2.error({ title: "schema degraded", details: `${table}.${s.field} missing — feature "${s.feature || alias(s)}" is off` });
  }
  const alias = (s) => s.as || s.field;
  function degradeFeature(entry) {
    if (!degraded.some((d) => d.table === entry.table && d.feature === entry.feature)) degraded.push({ table: entry.table, field: entry.field || "*", feature: entry.feature || null, reason: entry.reason || null });
  }
  return { probe, projection, degraded, degradeFeature, reset: () => probeCache.clear() };
}

// src/server/dao/suiteql.js
function createSuiteQL({ query: query2, log: log2 }) {
  function all(sql, params = [], pageSize = 1e3) {
    const paged = query2.runSuiteQLPaged({ query: sql, params, pageSize });
    const rows = [];
    const ranges = paged.pageRanges || [];
    for (let i = 0; i < ranges.length; i++) {
      const page = paged.fetch({ index: ranges[i].index });
      for (const r of page.data.asMappedResults()) rows.push(r);
    }
    return rows;
  }
  function few(sql, params = []) {
    return query2.runSuiteQL({ query: sql, params }).asMappedResults();
  }
  function one(sql, params = []) {
    const r = few(sql, params);
    return r.length ? r[0] : null;
  }
  function inChunks(ids2, fn, size = 900) {
    const out = [];
    for (let i = 0; i < ids2.length; i += size) out.push(...fn(ids2.slice(i, i + size)));
    return out;
  }
  return { all, few, one, inChunks };
}
function sqlIn(ids2) {
  return ids2.map((x) => Number(x)).filter((n) => Number.isFinite(n)).join(",") || "NULL";
}
function esc(s) {
  return String(s).replace(/'/g, "''");
}

// src/shared/constants.js
var FUNDS = Object.freeze({
  A1: { id: "A1", label: "Amicus I" },
  A2: { id: "A2", label: "Amicus II" },
  A3: { id: "A3", label: "Amicus III" }
});
var FUND_ORDER = Object.freeze(["A1", "A2", "A3"]);
var SUBSIDIARY_FUND_RULES = Object.freeze([
  { match: /alma\s*mater/i, fund: "A3" },
  { match: /miami|\ba3\b|amicus\s*(3|iii)\b/i, fund: "A3" },
  { match: /02908/i, fund: "A1" },
  { match: /amicus\s*(1|i)\b/i, fund: "A1" },
  { match: /troy/i, fund: "A2" },
  { match: /pennsylvania|\bpa\b/i, fund: "A2" },
  { match: /\bny\b|new\s*york/i, fund: "A2" },
  { match: /amicus\s*(2|ii)\b/i, fund: "A2" }
]);
var MARKETS = Object.freeze([
  { id: "lehigh", label: "Bethlehem", university: "Lehigh", cities: ["bethlehem", "lehigh", "fountain hill"], calendar: { start: [6, 15], end: [5, 22] } },
  { id: "binghamton", label: "Binghamton", university: "Binghamton", cities: ["binghamton", "vestal", "johnson city"], calendar: { start: [6, 1], end: [5, 23] } },
  { id: "troy", label: "Troy", university: "RPI", cities: ["troy"], calendar: { start: [6, 1], end: [5, 18] } },
  { id: "providence", label: "Providence", university: "Brown/RISD", cities: ["providence", "east providence"], calendar: { start: [6, 22], end: [5, 23] } },
  { id: "savannah", label: "Savannah", university: "SCAD", cities: ["savannah"], calendar: { start: [6, 5], end: [5, 31] } },
  { id: "new-orleans", label: "New Orleans", university: "Tulane", cities: ["new orleans"], calendar: { start: [6, 4], end: [5, 27] } },
  { id: "charleston", label: "Charleston", university: "CofC", cities: ["charleston"], calendar: { start: [8, 5], end: [7, 25] } },
  // Present in the live data (A3 Miami of Ohio, 72 properties / 680 beds) but not in the brief's seven markets.
  // No lease calendar was given for it: the lease dialog must say so rather than prefill. See ASSUMPTIONS A-4.
  { id: "oxford", label: "Oxford", university: "Miami (OH)", cities: ["oxford"], calendar: null }
]);
var UNKNOWN_MARKET = Object.freeze({ id: "unknown", label: "Unmapped city", cities: [], calendar: null });
var AY_BOUNDARY = Object.freeze({ month: 6, day: 1 });
var TWO_YEAR_MIN_MONTHS = 15;
var OVERLAP_TOLERANCE_DAYS = 7;
var STALE_STAGE_DAYS = 14;
var FEATURE_FLAGS = Object.freeze({
  /** §5.7.1 — collisions require date overlap. OFF until the delta report is signed off. */
  requireOverlapForCollision: false
});
var LEASE_TYPES = Object.freeze({
  WH: { key: "WH", label: "Whole House", short: "WH", labels: ["whole house", "whole-house", "house", "wh"] },
  UNIT: { key: "UNIT", label: "Unit", short: "Unit", labels: ["unit", "apartment", "apt"] },
  BED: { key: "BED", label: "Bedroom", short: "Bed", labels: ["bedroom", "bed", "room", "by the bed", "by bed"] }
});
var LEASE_TYPE_ID_OVERRIDES = Object.freeze({
  /* listValueId: 'WH'|'UNIT'|'BED' — filled from probe */
});
var LEASE_STATUSES = Object.freeze({
  EXECUTED: { key: "EXECUTED", label: "Fully Executed", labels: ["fully executed", "executed", "fully-executed"] },
  IN_PROCESS: { key: "IN_PROCESS", label: "In Process", labels: ["in process", "in-process", "sent", "out for signature"] },
  OTHER: { key: "OTHER", label: "Other", labels: [] },
  NONE: { key: "NONE", label: "No status", labels: [] }
});
var LEASE_STATUS_ID_OVERRIDES = Object.freeze({
  /* listValueId: key */
});
var BASES = Object.freeze({
  proforma: { id: "proforma", label: "Pro-forma", statuses: ["EXECUTED", "IN_PROCESS"] },
  executed: { id: "executed", label: "Fully Executed", statuses: ["EXECUTED"] }
});
var DEFAULT_BASIS = "proforma";
var STAGE_OWNER = Object.freeze({ DEFAULT: "default", HUMAN: "human", LEASE: "lease" });
var STAGES = Object.freeze([
  { key: "NONE", order: 0, owner: "default", label: "No stage set", labels: ["", "no stage set", "none", "not started"] },
  { key: "RENEWAL_OFFERED", order: 1, owner: "human", label: "Renewal Offered", labels: ["renewal offered"] },
  { key: "IN_NEGOTIATIONS", order: 2, owner: "human", label: "In Negotiations", labels: ["in negotiations", "in negotiation", "negotiating"] },
  { key: "RENEWAL_DECLINED", order: 3, owner: "human", label: "Renewal Declined", labels: ["renewal declined", "declined"] },
  { key: "READY_FOR_LEASE", order: 4, owner: "human", label: "Ready For Lease - Waiting on Forms", labels: ["ready for lease - waiting on forms", "ready for lease", "waiting on forms"] },
  { key: "OFFLINE", order: 5, owner: "human", label: "Offline", labels: ["offline", "off line", "not leasing"] },
  { key: "LEASE_OUT", order: 6, owner: "lease", label: "Lease Out - Unsigned", labels: ["lease out - unsigned", "lease out", "unsigned", "lease sent"] },
  // Set from the board's "Revisions" action when a sent lease needs changes; the lease User Event takes the stage back once it is re-sent or signed.
  { key: "LEASE_REVISIONS", order: 7, owner: "human", label: "Lease Revisions", labels: ["lease revisions", "revisions", "lease revision"] },
  { key: "FULLY_EXECUTED", order: 8, owner: "lease", label: "Fully Executed", labels: ["fully executed", "executed", "leased"] }
]);
var RETIRED_STAGE_FOLD = Object.freeze({
  "renewal accepted": "READY_FOR_LEASE",
  "lease out - signed": "FULLY_EXECUTED"
});
var STAGE_ID_OVERRIDES = Object.freeze({
  /* listValueId: stageKey — filled from probe */
});
var STAGE_SOURCE = Object.freeze({ MANUAL: "manual", LEASE: "lease" });
var GROUP_TYPES = Object.freeze([
  { key: "NEW", label: "New Group" },
  { key: "TRANSFER", label: "Transfers" },
  { key: "RENEWAL", label: "Renewal" }
]);
var UTILITIES = Object.freeze([
  { key: "water", label: "Water included" },
  { key: "gas", label: "Gas included" }
]);
var SEGMENTS = Object.freeze({
  STUDENT: { key: "STUDENT", label: "Student", beds: true, inOccupancy: true, inPrelease: true },
  NON_STUDENT: { key: "NON_STUDENT", label: "Non-student residential", beds: true, inOccupancy: true, inPrelease: true },
  // stays in main figures
  STR: { key: "STR", label: "Short-term rental", beds: true, inOccupancy: false, inPrelease: false },
  // reported separately
  COMMERCIAL: { key: "COMMERCIAL", label: "Commercial / land / office", beds: false, inOccupancy: false, inPrelease: false }
  // rent only
});
var SEGMENT_FIELD_ID = "custrecord_serp_property_type_cr";
var SEGMENT_PROPERTY_IDS = Object.freeze({
  STR: Object.freeze([]),
  COMMERCIAL: Object.freeze([]),
  NON_STUDENT: Object.freeze([])
});
var EXCEPTION_CODES = Object.freeze({
  WH_MULTI: {
    code: "WH_MULTI",
    severity: 1,
    excludes: true,
    label: "Multiple whole-house leases on property",
    meaning: "More than one property-wide whole-house lease is active for this academic year at the same time.",
    action: "Keep one; link the others to the specific unit they cover or inactivate the duplicate."
  },
  WH_PLUS: {
    code: "WH_PLUS",
    severity: 1,
    excludes: true,
    label: "Whole-house lease + unit/bedroom leases on same property",
    meaning: "A property-wide whole-house lease overlaps unit or bedroom leases at the same property.",
    action: "If the house is part-let, change this lease to Unit or Bedroom and link it; otherwise inactivate the unit/bedroom leases."
  },
  PROP_HAS_WH: {
    code: "PROP_HAS_WH",
    severity: 2,
    excludes: true,
    label: "Property also has a whole-house lease",
    meaning: "This unit/bedroom lease overlaps a property-wide whole-house lease.",
    action: "Resolve the whole-house lease first (WH_PLUS); this row clears with it."
  },
  MULTI_UNIT: {
    code: "MULTI_UNIT",
    severity: 1,
    excludes: true,
    label: "Multiple leases on same unit/house",
    meaning: "Two or more unit-level leases claim the same unit at the same time.",
    action: "Relink one lease to the correct unit, correct its dates, or inactivate the duplicate."
  },
  UNIT_PLUS_BED: {
    code: "UNIT_PLUS_BED",
    severity: 1,
    excludes: true,
    label: "Unit/house lease + bedroom lease(s) in same unit",
    meaning: "A unit-level lease overlaps bedroom leases inside the same unit.",
    action: "If the unit is let by the bedroom, change this lease to Bedroom and link the bedroom; otherwise inactivate the bedroom leases."
  },
  UNIT_HAS: {
    code: "UNIT_HAS",
    severity: 2,
    excludes: true,
    label: "Unit also has a unit or whole-house lease",
    meaning: "This bedroom lease overlaps a unit-level lease on the same unit.",
    action: "Resolve the unit-level lease first (UNIT_PLUS_BED); this row clears with it."
  },
  MULTI_BED: {
    code: "MULTI_BED",
    severity: 1,
    excludes: true,
    label: "Multiple bedroom leases on same bedroom",
    meaning: "Two or more bedroom leases claim the same bedroom at the same time.",
    action: "Relink one lease to the right bedroom, correct the dates, or inactivate the duplicate."
  },
  UNIT_ON_BED: {
    code: "UNIT_ON_BED",
    severity: 2,
    excludes: true,
    label: "Unit lease linked to a bedroom record",
    meaning: "The lease type says Unit (or Whole House) but the linked record is a bedroom.",
    action: "Relink to the parent unit, or change the lease type to Bedroom."
  },
  BED_ON_UNIT: {
    code: "BED_ON_UNIT",
    severity: 2,
    excludes: true,
    label: "Bedroom lease linked to a unit record",
    meaning: "The lease type says Bedroom but the linked record is a unit.",
    action: "Relink to the specific bedroom, or change the lease type to Unit."
  },
  NOT_LINKED: {
    code: "NOT_LINKED",
    severity: 2,
    excludes: true,
    label: "Not linked to a unit/bedroom record",
    meaning: "A unit or bedroom lease has no Units/Bedrooms link, so the engine cannot tell which beds it covers.",
    action: "Set the Units/Bedrooms link on the lease."
  },
  ZERO_BEDS: {
    code: "ZERO_BEDS",
    severity: 3,
    excludes: true,
    label: "Linked record has 0 beds in NetSuite",
    meaning: "The covered scope has no beds, so the lease cannot occupy anything.",
    action: "Set the bed count on the unit or bedroom record."
  },
  NO_PROP: {
    code: "NO_PROP",
    severity: 2,
    excludes: true,
    label: "Property not found in NetSuite",
    meaning: "The lease points at a property that is missing or inactive.",
    action: "Set the Property on the lease to an active property."
  },
  UNKNOWN_TYPE: {
    code: "UNKNOWN_TYPE",
    severity: 2,
    excludes: true,
    label: "Unknown lease type",
    meaning: "The lease type is blank or not one of Whole House / Unit / Bedroom.",
    action: "Set the lease type."
  },
  BAD_DATES: {
    code: "BAD_DATES",
    severity: 2,
    excludes: true,
    label: "End date is before the start date",
    meaning: "The lease dates are inverted, so its term and academic year cannot be computed.",
    action: "Correct the start or end date."
  },
  TERM_MISMATCH: {
    code: "TERM_MISMATCH",
    severity: 4,
    excludes: false,
    label: "Duration says two years but the dates cover one",
    meaning: "The duration field is 15+ months but the dates span fewer. The dates are used.",
    action: "Correct the duration field or the end date."
  },
  TENANT_DOUBLE: {
    code: "TENANT_DOUBLE",
    severity: 1,
    excludes: false,
    label: "Same tenant on two overlapping leases",
    meaning: "One tenant is attached to two leases whose dates overlap, so their rent is counted twice.",
    action: "Remove the tenant from the lease they are not on, or correct the dates."
  },
  OVERLAP_MINOR: {
    code: "OVERLAP_MINOR",
    severity: 5,
    excludes: false,
    label: "Overlaps by a few days",
    meaning: `Sequential leases on the same scope overlap by at most ${OVERLAP_TOLERANCE_DAYS} days — treated as ordinary turnover.`,
    action: "No action needed unless the overlap is unintended."
  },
  NO_STATUS: {
    code: "NO_STATUS",
    severity: 4,
    excludes: true,
    label: "Lease has no status",
    meaning: "A lease without a status is excluded from every statistic but stays visible (§5.3).",
    action: "Set the lease status once the lease has been sent."
  }
});
var EXCEPTION_ORDER = Object.freeze(
  Object.values(EXCEPTION_CODES).sort((a, b) => a.severity - b.severity || a.code.localeCompare(b.code)).map((e) => e.code)
);
var UAS = Object.freeze({
  TYPE: "customrecord_ad_unit_ay_status",
  UNIT: "custrecord_ad_uas_unit",
  AY: "custrecord_ad_uas_ay",
  PROPERTY: "custrecord_ad_uas_property",
  STAGE: "custrecord_ad_uas_stage",
  MANUAL_STAGE: "custrecord_ad_uas_manual_stage",
  STAGE_SOURCE: "custrecord_ad_uas_stage_source",
  STAGE_DATE: "custrecord_ad_uas_stage_date",
  LEASE: "custrecord_ad_uas_lease",
  LAST_OFFER: "custrecord_ad_uas_last_offer",
  FOLLOWUP: "custrecord_ad_uas_followup",
  NOTES: "custrecord_ad_uas_notes",
  EXPECTED_TENANTS: "custrecord_ad_uas_expected_tenants",
  LEASE_TERMS: "custrecord_ad_uas_lease_terms"
});
var UAS_NOTE = Object.freeze({
  TYPE: "customrecord_ad_uas_note"
  // child field ids are probed (parent link, author, body, created); see schema.js
});
var STAGE_LIST = "customlist_ad_leasing_stage";
var LEASE = Object.freeze({
  TYPE: "customrecord_serp_lease_record",
  PROPERTY: "custrecord_property",
  UNIT: "custrecord_unitsbedroom",
  AY: "custrecord_serp_lease_academic_year",
  STATUS: "custrecord_serp_lease_status",
  START: "custrecord_serp_lease_start_date",
  END: "custrecord_serp_lease_end_date",
  MONTHLY_RENT: "custrecord_monthly_actual_rent",
  TENANT_COUNT: "custrecord_serp_number_of_tenants",
  TENANTS: "custrecord_serp_tenants_",
  TENANTS_MAP: "MAP_customrecord_serp_lease_record_custrecord_serp_tenants_",
  RR_UNIT_ID: "custrecord_serp_rr_unit_id"
  // Probed (ids unknown until step 1 runs): lease type, duration months,
  // total rent, sent date, signed date, utilities, group type, provisions, notes.
});
var PROPERTY = Object.freeze({
  TYPE: "customrecord_serp_property_record",
  CITY: "custrecord_serp_prop_city",
  STATE: "custrecord_test_state",
  SUBSIDIARY: "custrecord_serp_proj_subsidiary"
});
var UNIT = Object.freeze({
  TYPE: "customrecord_serp_units_bedrooms",
  BEDS: "custrecord_serp_number_of_beds",
  RR_UNIT_ID: "custrecord_serp_rentroom_unit_id"
  // parent / property field ids are probed
});
var CUSTOMER = Object.freeze({
  TYPE: "customer",
  PROPERTY: "custentity_serp_ent_property",
  AY: "custentity_serp_academic_year",
  PROPERTY_MAP: "map_customer_custentity_serp_ent_property",
  AY_MAP: "map_customer_custentity_serp_academic_year",
  RR_UPLOAD_STATUS: "custentity14"
});
var TENANT_STATUSES = Object.freeze([
  { key: "TENANT_NEW", label: "Tenant - New", labels: ["tenant - new", "tenant-new"] },
  { key: "TENANT_INQUIRING", label: "Tenant - Inquiring", labels: ["tenant - inquiring"] },
  { key: "TENANT_CLOSED_WON", label: "Tenant - Closed Won", labels: ["tenant - closed won"] }
]);
var MARKET_LOCK = Object.freeze({
  SCRIPT_PARAM_MARKETS: "custscript_lkr_markets",
  SCRIPT_PARAM_LOCK: "custscript_lkr_user_lock",
  EMPLOYEE_FIELD: "custentity_lkr_markets"
});
var SAVED_VIEW = Object.freeze({
  TYPE: "customrecord_ad_saved_view",
  OWNER: "custrecord_ad_sv_owner",
  WORKSPACE: "custrecord_ad_sv_workspace",
  NAME: "custrecord_ad_sv_name",
  JSON: "custrecord_ad_sv_json",
  IS_DEFAULT: "custrecord_ad_sv_default",
  SHARED_MARKETS: "custrecord_ad_sv_shared_markets"
});
var TOUR = Object.freeze({
  TYPE: "calendarevent",
  UNIT: "custevent_ad_tour_unit",
  OUTCOME: "custevent_ad_tour_outcome",
  AY: "custevent_ad_tour_ay",
  OUTCOME_LIST: "customlist_ad_tour_outcome"
});
var TOUR_OUTCOMES = Object.freeze([
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "COMPLETED", label: "Completed" },
  { key: "NO_SHOW", label: "No-show" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "LEASED", label: "Leased" }
]);
var AUDIT = Object.freeze({
  TYPE: "customrecord_ad_write_audit",
  WHO: "custrecord_ad_wa_who",
  WHEN: "custrecord_ad_wa_when",
  RECORD_TYPE: "custrecord_ad_wa_rectype",
  RECORD_ID: "custrecord_ad_wa_recid",
  FIELD: "custrecord_ad_wa_field",
  BEFORE: "custrecord_ad_wa_before",
  AFTER: "custrecord_ad_wa_after",
  CHANGE_ID: "custrecord_ad_wa_change_id"
});
var GOVERNANCE = Object.freeze({
  REQUEST_UNITS: 1e3,
  SUBMIT_FIELDS: 2,
  RECORD_SAVE: 4,
  RECORD_LOAD: 2,
  SUITEQL_PAGE: 10,
  RESERVE: 100
  // never dip below this; return partial results instead
});
var THEME = Object.freeze({
  accent: "#2F5FD0",
  warning: "#C2410C",
  chart: Object.freeze({
    light: Object.freeze(["#2F5FD0", "#8A94A6", "#C2410C", "#4B5563", "#9DB4EC"]),
    dark: Object.freeze(["#7FA3F5", "#8A94A6", "#F0864A", "#B8C0CC", "#3E5FA8"])
  })
});
function normLabel(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*-\s*/g, " - ");
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
function leaseTypeKey(value, overrides = LEASE_TYPE_ID_OVERRIDES) {
  return byLabel(LEASE_TYPES, value, overrides);
}
function leaseStatusKey(value, overrides = LEASE_STATUS_ID_OVERRIDES) {
  if (value == null || String(value).trim() === "") return "NONE";
  return byLabel(LEASE_STATUSES, value, overrides) || "OTHER";
}
function fundForSubsidiary(name) {
  if (!name) return null;
  for (const r of SUBSIDIARY_FUND_RULES) if (r.match.test(name)) return r.fund;
  return null;
}
function marketForCity(city) {
  const c = normLabel(city);
  if (!c) return UNKNOWN_MARKET;
  for (const m of MARKETS) if (m.cities.includes(c) || m.id === c || normLabel(m.label) === c) return m;
  return UNKNOWN_MARKET;
}
function stageByKey(key) {
  return STAGES.find((s) => s.key === key) || STAGES[0];
}
function foldStage(value, overrides = STAGE_ID_OVERRIDES) {
  if (value == null || String(value).trim() === "") return "NONE";
  const v = String(value);
  if (STAGES.some((s) => s.key === v)) return v;
  if (Object.prototype.hasOwnProperty.call(overrides, v)) return overrides[v];
  const n = normLabel(v);
  if (Object.prototype.hasOwnProperty.call(RETIRED_STAGE_FOLD, n)) return RETIRED_STAGE_FOLD[n];
  return byLabel(STAGES, v, null);
}

// src/server/dao/portfolio.js
function createPortfolioDao({ sq, schema }) {
  const P = PROPERTY.TYPE, U = UNIT.TYPE, L = LEASE.TYPE;
  function academicYears() {
    return sq.few(`SELECT id, name, isinactive, custrecord_start_date AS start_date, custrecord_serp_acad_end_date AS end_date FROM customrecord_serp_academic_yr_list ORDER BY custrecord_start_date`);
  }
  function lists() {
    const out = {};
    for (const list of [STAGE_LIST, "customlist_ad_stage_source", "customlist_serp_lease_type_list", "customlist_serp_lease_status", "customlist_lease_group_type", "customlist_serp_hear_us_list", "customlist830", "customlist_serp_schools", "customlist_serp_cities"]) {
      try {
        out[list] = sq.few(`SELECT id, name, isinactive FROM ${list} ORDER BY id`);
      } catch (e) {
        out[list] = [];
      }
    }
    return out;
  }
  const PROPERTY_SPECS = () => [
    { field: "id" },
    { field: "name" },
    { field: "parent" },
    { field: "isinactive" },
    { field: PROPERTY.CITY, as: "city" },
    { field: PROPERTY.STATE, as: "state" },
    { field: PROPERTY.SUBSIDIARY, as: "subsidiary" },
    { field: PROPERTY.SUBSIDIARY, as: "subsidiary_name", expr: `BUILTIN.DF(${PROPERTY.SUBSIDIARY})` },
    { field: "custrecord_serp_property_type_cr", as: "prop_type", optional: true, feature: "commercial segregation" },
    { field: "custrecord_serp_property_type_cr", as: "prop_type_name", optional: true, expr: "BUILTIN.DF(custrecord_serp_property_type_cr)", feature: "commercial segregation" },
    { field: "custrecord_serp_prop_status", as: "prop_status", optional: true, feature: "property status" },
    { field: "custrecord_number_of_bedrooms", as: "bedrooms", optional: true, feature: "property-level bed count" },
    { field: "custrecord_serp_prop_bed_count", as: "bed_count", optional: true },
    { field: "custrecord_serp_total_units", as: "total_units", optional: true },
    { field: "custrecord_serp_property_nick_name", as: "nickname", optional: true, feature: "property nicknames" },
    { field: "lastmodified" }
  ];
  function properties() {
    const { select } = schema.projection(P, PROPERTY_SPECS());
    return sq.all(`SELECT ${select} FROM ${P} WHERE isinactive = 'F' ORDER BY id`);
  }
  const UNIT_SPECS = () => [
    { field: "id" },
    { field: "name" },
    { field: "parent" },
    { field: "isinactive" },
    { field: "custrecord_serp_parent_property", as: "property" },
    { field: UNIT.BEDS, as: "beds" },
    { field: UNIT.RR_UNIT_ID, as: "rr_unit_id", optional: true, feature: "Rentroom unit ids" },
    { field: "custrecord_occupied", as: "occupied", optional: true },
    { field: "custrecord_serp_next_available_dates", as: "next_available", optional: true, feature: "next available date" },
    { field: "lastmodified" }
  ];
  function units() {
    const { select } = schema.projection(U, UNIT_SPECS());
    return sq.all(`SELECT ${select} FROM ${U} WHERE isinactive = 'F' ORDER BY id`);
  }
  const LEASE_SPECS = () => [
    { field: "id" },
    { field: "name" },
    { field: "isinactive" },
    { field: LEASE.PROPERTY, as: "property" },
    { field: LEASE.UNIT, as: "unit" },
    { field: "custrecord_serp_lease_type_test", as: "lease_type" },
    { field: "custrecord_serp_lease_type_test", as: "lease_type_name", expr: "BUILTIN.DF(custrecord_serp_lease_type_test)" },
    { field: LEASE.STATUS, as: "status" },
    { field: LEASE.STATUS, as: "status_name", expr: `BUILTIN.DF(${LEASE.STATUS})` },
    { field: LEASE.AY, as: "ay" },
    { field: LEASE.AY, as: "ay_name", expr: `BUILTIN.DF(${LEASE.AY})` },
    { field: LEASE.START, as: "start_date" },
    { field: LEASE.END, as: "end_date" },
    { field: "custrecord_serp_lease_duration_options", as: "duration_months", optional: true, feature: "duration field (term falls back to rent ÷ dates)" },
    { field: LEASE.MONTHLY_RENT, as: "monthly_rent" },
    { field: "custrecord_serp_rent_actual_total", as: "total_rent", optional: true, feature: "total rent" },
    { field: LEASE.TENANT_COUNT, as: "tenant_count", optional: true, feature: "headcount" },
    { field: LEASE.TENANTS, as: "tenants" },
    { field: "custrecord_serp_lease_sent_date", as: "sent_date", optional: true, feature: "weekly: leases sent" },
    { field: "custrecord_effective_date", as: "signed_date", optional: true, feature: "weekly: beds leased" },
    { field: "custrecord_serp_lease_signed", as: "signed_flag", optional: true },
    { field: "custrecord_serp_group_type", as: "group_type", optional: true, feature: "group type" },
    { field: "custrecord_rent_target_per_bed", as: "target_per_bed", optional: true },
    { field: "custrecord_serp_monthly_targ_rent_lease", as: "target_monthly", optional: true },
    { field: "custrecord_serp_watersewer_included", as: "water_included", optional: true, feature: "utilities" },
    { field: "custrecord_serp_gaselectric_included", as: "gas_included", optional: true, feature: "utilities" },
    { field: "custrecord_serp_additional_provisions", as: "provisions", optional: true },
    { field: LEASE.RR_UNIT_ID, as: "rr_unit_id", optional: true },
    { field: "created" },
    { field: "lastmodified" }
  ];
  function leases(ayIds, { includeInactive = false } = {}) {
    const { select } = schema.projection(L, LEASE_SPECS());
    const where = [`${includeInactive ? "1=1" : "isinactive = 'F'"}`];
    if (ayIds && ayIds.length) where.push(`${LEASE.AY} IN (${sqlIn(ayIds)})`);
    return sq.all(`SELECT ${select} FROM ${L} WHERE ${where.join(" AND ")} ORDER BY id`);
  }
  const T = "customrecord_serp_academic_yr_details";
  const TARGET_SPECS = () => [
    { field: "id" },
    { field: "isinactive" },
    { field: "custrecord_serp_unit", as: "unit" },
    { field: "custrecord_serp_test_units_br", as: "property" },
    { field: "custrecord_serp_academic_year", as: "ay" },
    { field: "custrecord_serp_unit_number_of_beds", as: "beds", optional: true },
    { field: "custrecord_serp_target_rent_perbed", as: "target_per_bed", optional: true, feature: "target rent" },
    { field: "custrecord_serp_target_rent_monthly", as: "target_monthly", optional: true, feature: "target rent" },
    { field: "custrecord_serp_settle_rent_perbed", as: "settle_per_bed", optional: true, feature: "settle rent" },
    { field: "custrecord_serp_settle_rent_monthly", as: "settle_monthly", optional: true, feature: "settle rent" },
    { field: "custrecord_serp_previous_year_rentbed", as: "prev_year_per_bed", optional: true },
    { field: "custrecord_serp_next_available_date", as: "next_available", optional: true }
  ];
  function targets(ayIds) {
    const { select } = schema.projection(T, TARGET_SPECS());
    const where = ["isinactive = 'F'"];
    if (ayIds && ayIds.length) where.push(`custrecord_serp_academic_year IN (${sqlIn(ayIds)})`);
    return sq.all(`SELECT ${select} FROM ${T} WHERE ${where.join(" AND ")} ORDER BY id`);
  }
  let inactCache = null;
  function inactivations() {
    if (inactCache) return inactCache;
    try {
      const rows = sq.all(`SELECT sn.recordid AS id, l.name, l.${LEASE.PROPERTY} AS property_id, l.${LEASE.UNIT} AS unit_id, BUILTIN.DF(l.${LEASE.UNIT}) AS unit_name, l.${LEASE.AY} AS ay, l.${LEASE.STATUS} AS status, l.${LEASE.TENANT_COUNT} AS tenants, l.${LEASE.MONTHLY_RENT} AS monthly_rent, l.isinactive AS inactive_now, TO_CHAR(sn.date, 'YYYY-MM-DD HH24:MI') AS changed, BUILTIN.DF(sn.name) AS changed_by FROM systemnote sn JOIN ${L} l ON l.id = sn.recordid WHERE sn.recordtypeid = (SELECT internalid FROM customrecordtype WHERE scriptid = 'CUSTOMRECORD_SERP_LEASE_RECORD') AND sn.field = 'CUSTOMRECORDENTRY.BINACTIVE' AND sn.newvalue = 'T' ORDER BY sn.date DESC`);
      inactCache = { rows, available: true };
    } catch (e) {
      schema.degradeFeature && schema.degradeFeature({ table: "systemnote", field: "*", feature: "weekly: lease records made inactive", reason: e && e.message });
      inactCache = { rows: [], available: false };
    }
    return inactCache;
  }
  function subsidiaries() {
    return sq.few("SELECT id, name, parent FROM subsidiary ORDER BY id");
  }
  function probe() {
    schema.projection(P, PROPERTY_SPECS());
    schema.projection(U, UNIT_SPECS());
    schema.projection(L, LEASE_SPECS());
    schema.projection(T, TARGET_SPECS());
  }
  return { academicYears, lists, properties, units, leases, targets, subsidiaries, inactivations, probe };
}

// src/server/dao/pipeline.js
function createPipelineDao({ sq, schema }) {
  const SPECS = () => [
    { field: "id" },
    { field: "name" },
    { field: "isinactive" },
    { field: UAS.UNIT, as: "unit" },
    { field: UAS.PROPERTY, as: "property" },
    { field: UAS.AY, as: "ay" },
    { field: UAS.STAGE, as: "stage" },
    { field: UAS.STAGE, as: "stage_name", expr: `BUILTIN.DF(${UAS.STAGE})` },
    { field: UAS.MANUAL_STAGE, as: "manual_stage", optional: true, feature: "manual stage memory" },
    { field: UAS.STAGE_SOURCE, as: "stage_source", optional: true, feature: "stage source" },
    { field: UAS.STAGE_SOURCE, as: "stage_source_name", optional: true, expr: `BUILTIN.DF(${UAS.STAGE_SOURCE})` },
    { field: UAS.STAGE_DATE, as: "stage_date", optional: true, feature: "days in stage" },
    { field: UAS.LEASE, as: "lease", optional: true, feature: "linked lease" },
    { field: UAS.LAST_OFFER, as: "last_offer", optional: true, feature: "last offered rent" },
    { field: UAS.FOLLOWUP, as: "followup", optional: true, feature: "follow-up dates" },
    { field: UAS.NOTES, as: "notes", optional: true },
    { field: UAS.EXPECTED_TENANTS, as: "expected_tenants", optional: true, feature: "expected tenants" },
    { field: UAS.LEASE_TERMS, as: "lease_terms", optional: true, feature: "lease dialog terms shadow" },
    { field: "lastmodified" },
    { field: "lastmodifiedby" }
  ];
  function stageRows(ayIds) {
    const { select, missing } = schema.projection(UAS.TYPE, SPECS());
    const where = ["isinactive = 'F'"];
    if (ayIds && ayIds.length) where.push(`${UAS.AY} IN (${sqlIn(ayIds)})`);
    return { rows: sq.all(`SELECT ${select} FROM ${UAS.TYPE} WHERE ${where.join(" AND ")} ORDER BY id`), missing };
  }
  function notes(rowIds) {
    if (!rowIds.length) return [];
    return sq.inChunks(rowIds, (chunk) => sq.few(`SELECT id, custrecord_ad_note_status AS status_row, custrecord_ad_note_text AS text, custrecord_ad_note_date AS note_date, custrecord_ad_note_author AS author, BUILTIN.DF(custrecord_ad_note_author) AS author_name, custrecord_ad_note_mentions AS mentions, created FROM ${UAS_NOTE.TYPE} WHERE isinactive = 'F' AND custrecord_ad_note_status IN (${sqlIn(chunk)}) ORDER BY created, id`));
  }
  function notesForAy(ayId) {
    if (!ayId) return [];
    try {
      return sq.all(`SELECT n.id, n.custrecord_ad_note_status AS status_row, n.custrecord_ad_note_text AS text, n.custrecord_ad_note_date AS note_date, n.custrecord_ad_note_author AS author, BUILTIN.DF(n.custrecord_ad_note_author) AS author_name, n.custrecord_ad_note_mentions AS mentions, n.created FROM ${UAS_NOTE.TYPE} n JOIN ${UAS.TYPE} s ON s.id = n.custrecord_ad_note_status WHERE n.isinactive = 'F' AND s.isinactive = 'F' AND s.${UAS.AY} IN (${sqlIn([ayId])}) ORDER BY n.created, n.id`);
    } catch (e) {
      return [];
    }
  }
  function stageLog(rowIds) {
    if (!rowIds.length) return [];
    return sq.inChunks(rowIds, (chunk) => sq.few(`SELECT id, custrecord_ad_log_status AS status_row, custrecord_ad_log_from AS from_stage, custrecord_ad_log_to AS to_stage, custrecord_ad_log_source AS source, custrecord_ad_log_user AS user_id, custrecord_ad_log_date AS log_date FROM customrecord_ad_uas_stage_log WHERE custrecord_ad_log_status IN (${sqlIn(chunk)}) ORDER BY id`));
  }
  function rowVersion(id) {
    return sq.one(`SELECT id, lastmodified, ${UAS.STAGE} AS stage, ${UAS.STAGE_SOURCE} AS stage_source FROM ${UAS.TYPE} WHERE id = ?`, [Number(id)]);
  }
  function probe() {
    schema.projection(UAS.TYPE, SPECS());
  }
  return { stageRows, notes, notesForAy, stageLog, rowVersion, probe };
}

// src/server/dao/people.js
var TENANT_SORTS = { name: "c.lastname, c.firstname", created: "c.datecreated DESC", status: "c.entitystatus", email: "c.email" };
function createPeopleDao({ sq, schema }) {
  const C = CUSTOMER.TYPE;
  function select() {
    return schema.projection(C, [
      { field: "id" },
      { field: "entityid" },
      { field: "firstname" },
      { field: "lastname" },
      { field: "email" },
      { field: "phone" },
      { field: "mobilephone" },
      { field: "stage" },
      { field: "entitystatus" },
      { field: "entitystatus", as: "status_name", expr: "BUILTIN.DF(c.entitystatus)" },
      { field: "isinactive" },
      { field: "datecreated" },
      { field: "lastmodifieddate" },
      { field: "duplicate", optional: true },
      { field: CUSTOMER.PROPERTY, as: "property" },
      { field: CUSTOMER.AY, as: "ay" },
      // plain select is safe; expressions are not
      { field: "custentity_serp_schools", as: "school", optional: true, feature: "school" },
      { field: "custentity_desired_location", as: "desired_location", optional: true, feature: "desired location" },
      { field: "custentity_serp_group_size", as: "group_size", optional: true },
      { field: "custentity_serp_house_mates", as: "house_mates", optional: true },
      { field: "custentity_serp_notes", as: "notes", optional: true },
      { field: "custentity_serp_howdid_you_hear_about_us", as: "hear_us", optional: true, feature: "lead source" },
      { field: "custentity12", as: "agent_assigned", optional: true, feature: "agent assigned" },
      { field: "custentity9", as: "tour_date", optional: true },
      { field: "custentity3", as: "tour_scheduled", optional: true },
      { field: "custentity4", as: "lease_sent", optional: true },
      { field: "custentity5", as: "lease_signed", optional: true },
      { field: CUSTOMER.RR_UPLOAD_STATUS, as: "rr_upload_status", optional: true }
    ]).select.replace(/(^|, )(?!NULL|BUILTIN)([a-z_0-9]+)/g, "$1c.$2");
  }
  function tenants({ filters = {}, sort = "name", page = 0, pageSize = 100 } = {}) {
    const where = [];
    if (!filters.includeInactive) where.push("c.isinactive = 'F'");
    if (filters.stage) where.push(`c.stage = '${esc(filters.stage)}'`);
    if (filters.statusIds && filters.statusIds.length) where.push(`c.entitystatus IN (${sqlIn(filters.statusIds)})`);
    if (filters.q) {
      const q = esc(String(filters.q).toLowerCase());
      where.push(`(LOWER(c.firstname || ' ' || c.lastname) LIKE '%${q}%' OR LOWER(c.email) LIKE '%${q}%' OR c.phone LIKE '%${q}%' OR LOWER(c.custentity_desired_location) LIKE '%${q}%')`);
    }
    if (filters.missingProperty) where.push(`NOT EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id)`);
    if (filters.missingAy) where.push(`NOT EXISTS (SELECT 1 FROM ${CUSTOMER.AY_MAP} m WHERE m.mapone = c.id)`);
    if (filters.propertyIds && filters.propertyIds.length) where.push(`EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id AND m.maptwo IN (${sqlIn(filters.propertyIds)}))`);
    if (filters.ayIds && filters.ayIds.length) where.push(`EXISTS (SELECT 1 FROM ${CUSTOMER.AY_MAP} m WHERE m.mapone = c.id AND m.maptwo IN (${sqlIn(filters.ayIds)}))`);
    if (filters.scopePropertyIds) where.push(`(NOT EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id) OR EXISTS (SELECT 1 FROM ${CUSTOMER.PROPERTY_MAP} m WHERE m.mapone = c.id AND m.maptwo IN (${sqlIn(filters.scopePropertyIds)})))`);
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = sq.one(`SELECT COUNT(*) AS n FROM ${C} c ${w}`).n;
    const order = TENANT_SORTS[sort] || TENANT_SORTS.name;
    const sql = `SELECT * FROM (SELECT ROWNUM rn, x.* FROM (SELECT ${select()} FROM ${C} c ${w} ORDER BY ${order}, c.id) x) WHERE rn > ${page * pageSize} AND rn <= ${(page + 1) * pageSize}`;
    return { rows: sq.few(sql), total: Number(total), page, pageSize };
  }
  function byIds(ids2) {
    if (!ids2.length) return [];
    return sq.inChunks(ids2, (chunk) => sq.few(`SELECT ${select()} FROM ${C} c WHERE c.id IN (${sqlIn(chunk)})`));
  }
  function propertyLinks(customerIds) {
    return sq.inChunks(customerIds, (chunk) => sq.few(`SELECT mapone AS customer, maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone IN (${sqlIn(chunk)})`));
  }
  function ayLinks(customerIds) {
    return sq.inChunks(customerIds, (chunk) => sq.few(`SELECT mapone AS customer, maptwo AS ay FROM ${CUSTOMER.AY_MAP} WHERE mapone IN (${sqlIn(chunk)})`));
  }
  function leaseLinks(customerIds) {
    return sq.inChunks(customerIds, (chunk) => sq.few(`SELECT mapone AS lease, maptwo AS customer FROM MAP_customrecord_serp_lease_record_custrecord_serp_tenants_ WHERE maptwo IN (${sqlIn(chunk)})`));
  }
  function duplicates() {
    return sq.few(`SELECT LOWER(email) AS email, COUNT(*) AS n FROM ${C} WHERE isinactive = 'F' AND email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1`);
  }
  function statusList() {
    return sq.few(`SELECT key AS id, name, entitytype, inactive FROM entitystatus ORDER BY entitytype, key`);
  }
  function team() {
    try {
      return sq.few(`SELECT e.id, e.firstname, e.lastname, e.entityid FROM employee e WHERE e.isinactive = 'F' AND e.custentity_lkr_markets IS NOT NULL ORDER BY e.entityid`).map((e) => ({ id: String(e.id), name: [e.firstname, e.lastname].filter(Boolean).join(" ") || e.entityid })).filter((e) => e.name);
    } catch (e) {
      try {
        return sq.few(`SELECT e.id, e.entityid FROM employee e WHERE e.isinactive = 'F' AND e.custentity_lkr_markets IS NOT NULL ORDER BY e.entityid`).map((e2) => ({ id: String(e2.id), name: e2.entityid }));
      } catch (e2) {
        return [];
      }
    }
  }
  function probe() {
    select();
  }
  return { tenants, byIds, propertyLinks, ayLinks, leaseLinks, duplicates, statusList, team, probe };
}

// src/server/auth.js
var ADMIN_ROLE_IDS = /* @__PURE__ */ new Set([3]);
var ALL = "ALL";
function parseMarketList(value) {
  const names = Array.isArray(value) ? value : String(value == null ? "" : value).split(/[,;|]/);
  const ids2 = /* @__PURE__ */ new Set(), unknown = [];
  for (const raw of names) {
    const n = String(raw).trim();
    if (!n) continue;
    const m = marketForCity(n);
    if (m.id === "unknown") unknown.push(n);
    else ids2.add(m.id);
  }
  return { ids: ids2, unknown };
}
function createAuth({ runtime: runtime2, sq, schema, log: log2 }) {
  function readParam(name) {
    try {
      return runtime2.getCurrentScript().getParameter({ name });
    } catch (e) {
      return null;
    }
  }
  function employeeMarkets(userId) {
    const have = schema.probe("employee", [MARKET_LOCK.EMPLOYEE_FIELD]);
    if (have.get(MARKET_LOCK.EMPLOYEE_FIELD) === false) return { present: false, ids: /* @__PURE__ */ new Set(), unknown: [] };
    const row = sq.one(`SELECT BUILTIN.DF(${MARKET_LOCK.EMPLOYEE_FIELD}) AS markets FROM employee WHERE id = ?`, [Number(userId)]);
    const parsed = parseMarketList(row ? row.markets : "");
    return { present: true, ...parsed };
  }
  function resolve() {
    const user = runtime2.getCurrentUser();
    const base = { userId: Number(user.id), roleId: Number(user.role), roleName: user.roleId || null, name: user.name || null, email: user.email || null, isAdmin: false, lockEnabled: true, markets: /* @__PURE__ */ new Set(), all: false, reason: "", warnings: [] };
    if (ADMIN_ROLE_IDS.has(base.roleId) || String(user.roleId || "").toLowerCase() === "administrator") {
      base.isAdmin = true;
      base.all = true;
      base.reason = "administrator bypass";
      return finish2(base);
    }
    const lockParam = readParam(MARKET_LOCK.SCRIPT_PARAM_LOCK);
    base.lockEnabled = lockParam == null ? true : lockParam === true || lockParam === "T" || lockParam === "true";
    if (!base.lockEnabled) {
      base.all = true;
      base.reason = "market lock disabled on the deployment";
      return finish2(base);
    }
    const deploy = parseMarketList(readParam(MARKET_LOCK.SCRIPT_PARAM_MARKETS));
    if (deploy.unknown.length) base.warnings.push(`deployment parameter names unmapped markets: ${deploy.unknown.join(", ")}`);
    const emp = employeeMarkets(base.userId);
    if (!emp.present) {
      base.reason = `employee field ${MARKET_LOCK.EMPLOYEE_FIELD} does not exist — denying by default`;
      return finish2(base);
    }
    if (emp.unknown.length) base.warnings.push(`employee field names unmapped markets: ${emp.unknown.join(", ")}`);
    if (emp.ids.size === 0) {
      base.reason = "employee market field is blank — no access";
      return finish2(base);
    }
    const deployAll = deploy.ids.size === 0 && !deploy.unknown.length;
    for (const id of emp.ids) if (deployAll || deploy.ids.has(id)) base.markets.add(id);
    base.reason = base.markets.size ? `employee ∩ deployment` : "employee markets are all outside the deployment parameter — no access";
    return finish2(base);
  }
  function finish2(s) {
    s.marketIds = s.all ? MARKETS.map((m) => m.id) : [...s.markets];
    log2 && log2.debug && log2.debug({ title: "auth.resolve", details: `${s.userId}/${s.roleId} ${s.all ? ALL : s.marketIds.join(",")} — ${s.reason}` });
    return s;
  }
  function can(scope, marketId) {
    if (scope.all) return true;
    if (!marketId || marketId === "unknown") return false;
    return scope.markets.has(marketId);
  }
  function filterMarkets(scope, ids2) {
    return scope.all ? ids2 : ids2.filter((id) => scope.markets.has(id));
  }
  return { resolve, can, filterMarkets };
}

// src/shared/rules/dates.js
var MS_DAY = 864e5;
function toISO(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function parts(iso) {
  const d = toISO(iso);
  if (!d) return null;
  const [y, m, dd] = d.split("-").map(Number);
  return { y, m, d: dd };
}
function dayNum(iso) {
  const p = parts(iso);
  return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / MS_DAY) : null;
}
function fromDayNum(n) {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = dayNum(iso);
  return d == null ? null : fromDayNum(d + n);
}
function daysBetween(a, b) {
  const x = dayNum(a), y = dayNum(b);
  return x == null || y == null ? null : y - x;
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function compare(a, b) {
  return (dayNum(a) ?? -Infinity) - (dayNum(b) ?? -Infinity);
}
function monthsBetweenFraction(start, end) {
  const a = parts(start), b = parts(end);
  if (!a || !b) return null;
  if (dayNum(end) < dayNum(start)) return -1;
  const whole = (b.y - a.y) * 12 + (b.m - a.m);
  const remainderDays = b.d + 1 - a.d;
  return whole + remainderDays / daysInMonth(b.y, b.m);
}
function monthsBetweenCeil(start, end) {
  const f = monthsBetweenFraction(start, end);
  if (f == null || f < 0) return f;
  return Math.max(1, Math.ceil(f - 1e-9));
}
function ayStartDate(ayYear) {
  return `${ayYear}-${pad(AY_BOUNDARY.month)}-${pad(AY_BOUNDARY.day)}`;
}
function ayEndDate(ayYear) {
  return addDays(ayStartDate(ayYear + 1), -1);
}
function ayForDate(iso) {
  const p = parts(iso);
  if (!p) return null;
  const afterBoundary = p.m > AY_BOUNDARY.month || p.m === AY_BOUNDARY.month && p.d >= AY_BOUNDARY.day;
  return afterBoundary ? p.y : p.y - 1;
}
function ayYearFromLabel(label) {
  if (label == null || label === "") return null;
  if (typeof label === "number") return label;
  const s = String(label);
  let m = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(s);
  if (m) return Number(m[1]);
  m = /\b(\d{2})\s*[-–/]\s*(\d{2})\b/.exec(s);
  if (m) return 2e3 + Number(m[1]);
  m = /^\s*(\d{4})\s*$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}
function ayShort(ayYear) {
  return `${String(ayYear).slice(2)}-${String(ayYear + 1).slice(2)}`;
}
function isoWeekday(iso) {
  const n = dayNum(iso);
  return ((n + 3) % 7 + 7) % 7 + 1;
}
function weekStart(iso) {
  return addDays(iso, -(isoWeekday(iso) - 1));
}

// src/shared/rules/stages.js
function validateHumanStageChange(toValue) {
  const key = foldStage(toValue);
  if (key == null) return { ok: false, key: null, reason: `Unknown stage "${toValue}"` };
  const s = stageByKey(key);
  if (s.owner === STAGE_OWNER.LEASE) return { ok: false, key, reason: `"${s.label}" is lease-driven and cannot be set from the board` };
  return { ok: true, key, reason: null };
}
function daysInStage(stageDate, today) {
  if (!stageDate || !today) return null;
  const d = daysBetween(stageDate, today);
  return d == null ? null : Math.max(0, d);
}
function effectiveStage(row) {
  const stage = foldStage(row.stage);
  const manual = foldStage(row.manualStage);
  if (row.stageSource === "lease" && stage && stageByKey(stage).owner === STAGE_OWNER.LEASE) return stage;
  if (stage && stage !== "NONE") return stage;
  return manual || "NONE";
}

// src/server/writes.js
var ALLOWLIST = Object.freeze({
  // create = provisioning a missing unit × AY row (the v2 "provisioning gap"): unit, AY, property and name are creation-only
  [UAS.TYPE]: { create: true, fields: /* @__PURE__ */ new Set([UAS.STAGE, UAS.MANUAL_STAGE, UAS.STAGE_SOURCE, UAS.STAGE_DATE, UAS.LAST_OFFER, UAS.FOLLOWUP, UAS.EXPECTED_TENANTS, UAS.LEASE_TERMS, UAS.UNIT, UAS.AY, UAS.PROPERTY, "name"]) },
  [UAS_NOTE.TYPE]: { create: true, fields: /* @__PURE__ */ new Set(["custrecord_ad_note_status", "custrecord_ad_note_text", "custrecord_ad_note_date", "custrecord_ad_note_author", "custrecord_ad_note_mentions", "name"]) },
  [LEASE.TYPE]: { create: true, fields: /* @__PURE__ */ new Set([
    LEASE.UNIT,
    LEASE.PROPERTY,
    "custrecord_serp_lease_type_test",
    LEASE.START,
    LEASE.END,
    LEASE.AY,
    LEASE.STATUS,
    "isinactive",
    LEASE.TENANTS,
    // creation-only fields (lease dialog): checked in applyCreate, never on update
    "name",
    "custrecord_serp_lease_duration_options",
    LEASE.MONTHLY_RENT,
    "custrecord_serp_rent_actual_total",
    LEASE.TENANT_COUNT,
    "custrecord_serp_group_type",
    "custrecord_rent_target_per_bed",
    "custrecord_serp_watersewer_included",
    "custrecord_serp_gaselectric_included",
    "custrecord_serp_additional_provisions",
    "custrecord_serp_academic_start_date",
    "custrecord_academic_end_date"
  ]) },
  [CUSTOMER.TYPE]: { create: false, fields: /* @__PURE__ */ new Set(["entitystatus", CUSTOMER.PROPERTY, CUSTOMER.AY, "custentity12", "custentity9", "custentity3", "custentity_desired_location", "custentity_serp_notes", "custentity_serp_howdid_you_hear_about_us", "custentity_serp_schools"]) },
  [TOUR.TYPE]: { create: true, fields: /* @__PURE__ */ new Set(["title", "startdate", "starttime", "endtime", "company", "organizer", "location", "message", "status", TOUR.UNIT, TOUR.OUTCOME, TOUR.AY]) },
  // App-owned record (§4.2 saved views): not in the §5.9 table, declared here explicitly rather than smuggled in.
  [SAVED_VIEW.TYPE]: { create: true, fields: /* @__PURE__ */ new Set([SAVED_VIEW.OWNER, SAVED_VIEW.WORKSPACE, SAVED_VIEW.NAME, SAVED_VIEW.JSON, SAVED_VIEW.IS_DEFAULT, SAVED_VIEW.SHARED_MARKETS, "isinactive", "name"]) }
});
var UAS_CREATE_ONLY = /* @__PURE__ */ new Set([UAS.UNIT, UAS.AY, UAS.PROPERTY, "name"]);
var LEASE_UPDATE_FIELDS = /* @__PURE__ */ new Set([LEASE.UNIT, LEASE.PROPERTY, "custrecord_serp_lease_type_test", LEASE.START, LEASE.END, LEASE.AY, LEASE.STATUS, "isinactive", LEASE.TENANTS]);
var TENANT_WIPING_FIELDS = /* @__PURE__ */ new Set([LEASE.AY, LEASE.PROPERTY]);
var WriteError = class extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
};
var DATE_FIELDS = /* @__PURE__ */ new Set([UAS.FOLLOWUP, UAS.STAGE_DATE, LEASE.START, LEASE.END, "custrecord_ad_note_date", "custrecord_serp_academic_start_date", "custrecord_academic_end_date", "custrecord_serp_lease_sent_date", "custrecord_effective_date", "startdate", "custentity9"]);
function localDate(v) {
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : v;
}
function nsValue(field, v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map(Number);
  if (DATE_FIELDS.has(field)) return localDate(v);
  return v;
}
function createWrites({ record: record2, sq, runtime: runtime2, log: log2, schema, auth, marketOf: marketOf2, clock = () => (/* @__PURE__ */ new Date()).toISOString(), stageIdFor = null }) {
  const auditAvailable = () => {
    try {
      return schema.probe(AUDIT.TYPE, [AUDIT.CHANGE_ID]).get(AUDIT.CHANGE_ID) !== false;
    } catch (e) {
      return false;
    }
  };
  function remaining() {
    try {
      return runtime2.getCurrentScript().getRemainingUsage();
    } catch (e) {
      return Infinity;
    }
  }
  function priorResult(changeId) {
    if (!auditAvailable()) return null;
    const row = sq.one(`SELECT ${AUDIT.RECORD_TYPE} AS rt, ${AUDIT.RECORD_ID} AS rid, ${AUDIT.AFTER} AS after FROM ${AUDIT.TYPE} WHERE ${AUDIT.CHANGE_ID} = ? AND ROWNUM <= 1`, [String(changeId)]);
    return row ? { ok: true, replayed: true, recordType: row.rt, recordId: String(row.rid) } : null;
  }
  function audit(scope, change, recordId, field, before, after) {
    const entry = { who: scope.userId, when: clock(), recordType: change.recordType, recordId: String(recordId), field, before: ser(before), after: ser(after), changeId: change.changeId };
    if (!auditAvailable()) {
      log2.audit({ title: "write (audit record missing)", details: JSON.stringify(entry) });
      return "log-only";
    }
    const r = record2.create({ type: AUDIT.TYPE });
    r.setValue({ fieldId: AUDIT.WHO, value: entry.who });
    r.setValue({ fieldId: AUDIT.WHEN, value: entry.when });
    r.setValue({ fieldId: AUDIT.RECORD_TYPE, value: entry.recordType });
    r.setValue({ fieldId: AUDIT.RECORD_ID, value: entry.recordId });
    r.setValue({ fieldId: AUDIT.FIELD, value: field });
    r.setValue({ fieldId: AUDIT.BEFORE, value: entry.before });
    r.setValue({ fieldId: AUDIT.AFTER, value: entry.after });
    r.setValue({ fieldId: AUDIT.CHANGE_ID, value: entry.changeId });
    r.save();
    return "record";
  }
  const ser = (v) => v == null ? null : Array.isArray(v) ? v.join(",") : String(v);
  function validateChange(change) {
    if (!change || typeof change !== "object") throw new WriteError("BAD_CHANGE", "change is not an object");
    if (!change.changeId || String(change.changeId).length > 80) throw new WriteError("BAD_CHANGE", "changeId is required");
    const rule = ALLOWLIST[change.recordType];
    if (!rule) throw new WriteError("DENIED_RECORD", `writes to ${change.recordType} are not allowed`);
    const isCreate = change.recordId == null;
    if (isCreate && !rule.create) throw new WriteError("DENIED_CREATE", `creating ${change.recordType} is not allowed`);
    const fields = change.fields || {};
    for (const f of Object.keys(fields)) {
      if (!rule.fields.has(f)) throw new WriteError("DENIED_FIELD", `field ${f} on ${change.recordType} is not allowed`, { field: f });
      if (!isCreate && change.recordType === LEASE.TYPE && !LEASE_UPDATE_FIELDS.has(f)) throw new WriteError("DENIED_FIELD", `field ${f} may only be set when creating a lease`, { field: f });
      if (!isCreate && change.recordType === UAS.TYPE && UAS_CREATE_ONLY.has(f)) throw new WriteError("DENIED_FIELD", `field ${f} may only be set when provisioning a status row`, { field: f });
    }
    if (change.recordType === UAS.TYPE && isCreate && (!fields[UAS.UNIT] || !fields[UAS.AY])) throw new WriteError("BAD_CHANGE", "a status row needs a unit and an academic year");
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      const v = validateHumanStageChange(fields[UAS.STAGE]);
      if (!v.ok) throw new WriteError("STAGE_LEASE_DRIVEN", v.reason, { field: UAS.STAGE });
      change.stageKey = v.key;
      if (v.key === "NONE") fields[UAS.STAGE] = "";
      else if (stageIdFor) {
        const id = stageIdFor(v.key);
        if (!id) throw new WriteError("STAGE_NO_LIST_VALUE", `the stage "${stageByKey(v.key).label}" has no value in the leasing-stage list yet (see SETUP-CHECKLIST)`, { field: UAS.STAGE });
        fields[UAS.STAGE] = id;
      }
      if (Object.prototype.hasOwnProperty.call(fields, UAS.STAGE_SOURCE) && String(fields[UAS.STAGE_SOURCE]) !== "manual" && String(fields[UAS.STAGE_SOURCE]) !== "1") throw new WriteError("STAGE_LEASE_DRIVEN", "the board may only set a manual stage source");
    }
    if (change.recordType === LEASE.TYPE && !isCreate && fields.isinactive === false) throw new WriteError("DENIED_FIELD", "reactivating a lease is not supported here");
    if (Object.keys(fields).length === 0) throw new WriteError("BAD_CHANGE", "no fields");
    return { isCreate, fields };
  }
  function tenantFilterOk(leaseProperty, leaseAy, tenantIds) {
    if (!tenantIds.length) return { ok: true, bad: [] };
    const props = sq.inChunks(tenantIds, (c) => sq.few(`SELECT mapone AS customer, maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone IN (${c.map(Number).join(",")})`));
    const ays = sq.inChunks(tenantIds, (c) => sq.few(`SELECT mapone AS customer, maptwo AS ay FROM ${CUSTOMER.AY_MAP} WHERE mapone IN (${c.map(Number).join(",")})`));
    const bad = [];
    for (const t of tenantIds) {
      const hasP = props.some((r) => String(r.customer) === String(t) && String(r.property) === String(leaseProperty));
      const hasA = ays.some((r) => String(r.customer) === String(t) && String(r.ay) === String(leaseAy));
      if (!hasP || !hasA) bad.push({ tenantId: String(t), missingProperty: !hasP, missingAy: !hasA });
    }
    return { ok: bad.length === 0, bad };
  }
  function currentTenants(leaseId) {
    return sq.few(`SELECT maptwo AS customer FROM MAP_customrecord_serp_lease_record_custrecord_serp_tenants_ WHERE mapone = ?`, [Number(leaseId)]).map((r) => String(r.customer)).sort();
  }
  function versionOf(type, id) {
    const col = type === CUSTOMER.TYPE ? "lastmodifieddate" : "lastmodified";
    try {
      const r = sq.one(`SELECT ${col} AS v FROM ${type} WHERE id = ?`, [Number(id)]);
      return r ? r.v : null;
    } catch (e) {
      return null;
    }
  }
  function applyUpdate(scope, change, fields) {
    const rec = record2.load({ type: change.recordType, id: change.recordId });
    const before = {};
    for (const f of Object.keys(fields)) before[f] = rec.getValue({ fieldId: f });
    if (change.version != null && change.version !== "") {
      const lm = versionOf(change.recordType, change.recordId) ?? (rec.getValue({ fieldId: "lastmodified" }) || rec.getValue({ fieldId: "lastmodifieddate" }) || null);
      if (lm != null && !sameVersion(lm, change.version)) throw new WriteError("STALE", "record changed since it was read — reload the tab", { current: before, version: String(lm) });
    }
    let captured = null;
    if (change.recordType === LEASE.TYPE) {
      const touchesWipe = Object.keys(fields).some((f) => TENANT_WIPING_FIELDS.has(f));
      const intended = Object.prototype.hasOwnProperty.call(fields, LEASE.TENANTS) ? (fields[LEASE.TENANTS] || []).map(String).sort() : null;
      if (touchesWipe || intended) {
        captured = intended || currentTenants(change.recordId);
        const prop = fields[LEASE.PROPERTY] ?? rec.getValue({ fieldId: LEASE.PROPERTY });
        const ay = fields[LEASE.AY] ?? rec.getValue({ fieldId: LEASE.AY });
        const screen = tenantFilterOk(prop, ay, captured);
        if (!screen.ok) throw new WriteError("TENANT_FILTER", "one or more tenants do not match the lease Property/Academic Year; nothing was written", { bad: screen.bad });
      }
    }
    for (const [f, v] of Object.entries(fields)) rec.setValue({ fieldId: f, value: nsValue(f, v) });
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      rec.setValue({ fieldId: UAS.MANUAL_STAGE, value: nsValue(UAS.MANUAL_STAGE, fields[UAS.STAGE]) });
      rec.setValue({ fieldId: UAS.STAGE_SOURCE, value: 1 });
      rec.setValue({ fieldId: UAS.STAGE_DATE, value: change.stageKey === "NONE" ? "" : localDate(clock().slice(0, 10)) });
    }
    rec.save();
    let restored = null;
    if (captured) {
      const after = currentTenants(change.recordId);
      if (after.join(",") !== captured.join(",")) {
        const again = record2.load({ type: LEASE.TYPE, id: change.recordId });
        again.setValue({ fieldId: LEASE.TENANTS, value: captured.map(Number) });
        again.save();
        const verify = currentTenants(change.recordId);
        restored = { dropped: captured.filter((t) => !after.includes(t)), restoredOk: verify.join(",") === captured.join(","), final: verify };
        if (!restored.restoredOk) throw new WriteError("TENANTS_LOST", "Tenants were dropped by NetSuite on save and could not be restored", restored);
      } else restored = { dropped: [], restoredOk: true, final: after };
    }
    const auditMode = [];
    for (const f of Object.keys(fields)) auditMode.push(audit(scope, change, change.recordId, f, before[f], fields[f]));
    return { ok: true, recordType: change.recordType, recordId: String(change.recordId), before, after: fields, tenants: restored, audit: auditMode[0] };
  }
  function applyCreate(scope, change, fields) {
    if (change.recordType === LEASE.TYPE && fields[LEASE.TENANTS]) {
      const screen = tenantFilterOk(fields[LEASE.PROPERTY], fields[LEASE.AY], fields[LEASE.TENANTS].map(String));
      if (!screen.ok) throw new WriteError("TENANT_FILTER", "tenants do not match the lease Property/Academic Year", { bad: screen.bad });
    }
    const rec = record2.create({ type: change.recordType, isDynamic: false });
    for (const [f, v] of Object.entries(fields)) rec.setValue({ fieldId: f, value: nsValue(f, v) });
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      rec.setValue({ fieldId: UAS.MANUAL_STAGE, value: nsValue(UAS.MANUAL_STAGE, fields[UAS.STAGE]) });
      rec.setValue({ fieldId: UAS.STAGE_SOURCE, value: 1 });
      rec.setValue({ fieldId: UAS.STAGE_DATE, value: change.stageKey === "NONE" ? "" : localDate(clock().slice(0, 10)) });
    }
    const id = rec.save();
    audit(scope, change, id, "*create*", null, JSON.stringify(fields));
    return { ok: true, created: true, recordType: change.recordType, recordId: String(id), after: fields };
  }
  function apply(changes, scope) {
    const results = [], deferred = [];
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (remaining() < GOVERNANCE.RESERVE) {
        deferred.push(...changes.slice(i).map((c) => c && c.changeId));
        break;
      }
      try {
        const prior = priorResult(change && change.changeId);
        if (prior) {
          results.push({ changeId: change.changeId, ...prior });
          continue;
        }
        const { isCreate, fields } = validateChange(change);
        for (const [f, v] of Object.entries(fields)) if (v === "$prev") {
          const prev = results[results.length - 1];
          if (!prev || !prev.ok || !prev.recordId) throw new WriteError("BAD_CHANGE", `${f} refers to the previous change, which did not create a record`);
          fields[f] = Number(prev.recordId);
        }
        const market = marketOf2(change.recordType, change.recordId, fields);
        if (!auth.can(scope, market)) throw new WriteError("DENIED_MARKET", `record is in market "${market || "unknown"}" which is outside your scope`);
        const r = isCreate ? applyCreate(scope, change, fields) : applyUpdate(scope, change, fields);
        results.push({ changeId: change.changeId, ...r });
      } catch (e) {
        const code = e instanceof WriteError ? e.code : "ERROR";
        log2 && log2.error && log2.error({ title: `write failed ${code}`, details: `${change && change.changeId}: ${e && e.message}` });
        results.push({ changeId: change && change.changeId, ok: false, code, message: e && e.message, ...pick(e, ["field", "current", "version", "bad", "dropped", "final"]) });
      }
    }
    return { results, deferred };
  }
  return { apply, validateChange, ALLOWLIST, tenantFilterOk };
}
function sameVersion(a, b) {
  const norm = (v) => {
    if (v == null) return null;
    const s = v instanceof Date ? v.toISOString() : String(v);
    const iso = localDate(s) instanceof Date ? localDate(s) : null;
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
    if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null };
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap]m)?)?/i.exec(s);
    if (m) {
      let h = m[4] ? Number(m[4]) : null;
      if (h != null && m[6]) {
        const pm = m[6].toLowerCase() === "pm";
        h = h % 12 + (pm ? 12 : 0);
      }
      return { day: `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, time: h == null ? null : `${String(h).padStart(2, "0")}:${m[5]}` };
    }
    void iso;
    return { day: s, time: null };
  };
  const x = norm(a), y = norm(b);
  if (!x || !y) return true;
  if (x.day !== y.day) return false;
  return !x.time || !y.time || x.time === y.time;
}
function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o && o[k] !== void 0) out[k] = o[k];
  return out;
}

// src/shared/rules/segments.js
var SEGMENT_FIELD_VALUES = {
  "short-term rental": "STR",
  "short term rental": "STR",
  "str": "STR",
  "airbnb": "STR",
  "commercial": "COMMERCIAL",
  "office": "COMMERCIAL",
  "land": "COMMERCIAL",
  "retail": "COMMERCIAL",
  "parking": "COMMERCIAL",
  "non-student": "NON_STUDENT",
  "non student": "NON_STUDENT",
  "market rate": "NON_STUDENT"
};
function segmentOf(property, overrides = SEGMENT_PROPERTY_IDS) {
  if (!property) return SEGMENTS.STUDENT.key;
  if (SEGMENT_FIELD_ID && property.segmentField != null && property.segmentField !== "") {
    const k = SEGMENT_FIELD_VALUES[normLabel(property.segmentField)];
    if (k) return k;
  }
  const id = String(property.id);
  for (const key of Object.keys(overrides)) if (overrides[key].map(String).includes(id)) return key;
  return SEGMENTS.STUDENT.key;
}

// src/shared/rules/inventory.js
var S = (v) => v == null ? null : String(v);
var num = (v) => v == null || v === "" ? null : Number(v);
var active = (r) => !r || r.isinactive !== "T";
function buildInventory({ properties = [], units = [] }, opts = {}) {
  const issues = [];
  const propertiesById = /* @__PURE__ */ new Map();
  const unitsById = /* @__PURE__ */ new Map();
  const bedroomsById = /* @__PURE__ */ new Map();
  for (const p of properties) {
    if (!active(p)) continue;
    const market = marketForCity(p.city);
    propertiesById.set(S(p.id), {
      id: S(p.id),
      name: p.name,
      nickname: p.nickname || null,
      parentId: S(p.parent),
      city: p.city || null,
      state: p.state || null,
      marketId: market.id,
      marketLabel: market.label,
      subsidiaryId: S(p.subsidiary),
      subsidiaryName: p.subsidiary_name || null,
      fund: fundForSubsidiary(p.subsidiary_name) || opts.subsidiaryFund && opts.subsidiaryFund[S(p.subsidiary)] || null,
      propType: p.prop_type_name || null,
      segment: segmentOf({ id: p.id, segmentField: p.prop_type_name, propType: p.prop_type_name }, opts.segmentOverrides),
      ownBedroomCount: num(p.bedrooms),
      ownBedCount: num(p.bed_count),
      totalUnitsField: num(p.total_units),
      units: [],
      children: [],
      leaves: [],
      beds: 0,
      ownLeaf: null
    });
  }
  for (const p of propertiesById.values()) {
    if (p.parentId && propertiesById.has(p.parentId)) propertiesById.get(p.parentId).children.push(p.id);
    if (p.parentId && !propertiesById.has(p.parentId)) issues.push({ code: "PARENT_PROPERTY_MISSING", propertyId: p.id, detail: `parent ${p.parentId} missing/inactive` });
    if (!p.fund) issues.push({ code: "FUND_UNMAPPED", propertyId: p.id, detail: `subsidiary "${p.subsidiaryName}"` });
    if (p.marketId === "unknown" && p.segment !== "COMMERCIAL") issues.push({ code: "MARKET_UNMAPPED", propertyId: p.id, detail: `city "${p.city}"` });
  }
  const rawUnits = units.filter((u) => active(u) && u.parent == null);
  const rawBeds = units.filter((u) => active(u) && u.parent != null);
  for (const u of rawUnits) {
    unitsById.set(S(u.id), {
      id: S(u.id),
      name: u.name,
      propertyId: S(u.property),
      rrUnitId: u.rr_unit_id || null,
      ownBeds: num(u.beds),
      bedrooms: [],
      beds: 0,
      leaves: [],
      leaf: null,
      occupiedFlag: u.occupied === "T"
    });
  }
  for (const b of rawBeds) {
    const parent = unitsById.get(S(b.parent));
    if (!parent) {
      issues.push({ code: "ORPHAN_BEDROOM", unitId: S(b.id), detail: `parent ${b.parent} missing/inactive` });
      unitsById.set(S(b.id), { id: S(b.id), name: b.name, propertyId: S(b.property), rrUnitId: b.rr_unit_id || null, ownBeds: num(b.beds) ?? 1, bedrooms: [], beds: 0, leaves: [], leaf: null, orphanBedroom: true });
      continue;
    }
    const propertyId = S(b.property) || parent.propertyId;
    if (!S(b.property)) issues.push({ code: "BEDROOM_PROPERTY_INHERITED", unitId: parent.id, bedroomId: S(b.id) });
    else if (propertyId !== parent.propertyId) issues.push({ code: "BEDROOM_PROPERTY_MISMATCH", unitId: parent.id, bedroomId: S(b.id), detail: `bedroom→${propertyId} unit→${parent.propertyId}` });
    const beds = num(b.beds) == null ? 1 : num(b.beds);
    const leaf = { key: `b:${b.id}`, kind: "bedroom", id: S(b.id), name: b.name, bedroomId: S(b.id), unitId: parent.id, propertyId: parent.propertyId, beds };
    bedroomsById.set(leaf.id, leaf);
    parent.bedrooms.push(leaf);
  }
  const leaves = [];
  for (const u of unitsById.values()) {
    u.bedrooms.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
    if (u.bedrooms.length) {
      u.beds = u.bedrooms.reduce((s, b) => s + b.beds, 0);
      u.leaves = u.bedrooms;
      if (u.ownBeds != null && u.ownBeds !== u.beds) issues.push({ code: "UNIT_BED_COUNT_DIFFERS", unitId: u.id, detail: `unit says ${u.ownBeds}, bedrooms sum ${u.beds}` });
    } else {
      u.beds = u.ownBeds == null ? 0 : u.ownBeds;
      u.leaf = { key: `u:${u.id}`, kind: "unit", id: u.id, name: u.name, bedroomId: null, unitId: u.id, propertyId: u.propertyId, beds: u.beds };
      u.leaves = [u.leaf];
      if (u.beds === 0) issues.push({ code: "UNIT_ZERO_BEDS", unitId: u.id, detail: "no bedroom records and bed count 0/blank" });
    }
    const p = propertiesById.get(u.propertyId);
    if (!p) {
      issues.push({ code: "UNIT_PROPERTY_MISSING", unitId: u.id, detail: `property ${u.propertyId}` });
    } else {
      p.units.push(u.id);
      p.leaves.push(...u.leaves);
    }
    leaves.push(...u.leaves);
  }
  const unitNodes = [...unitsById.values()].sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
  for (const p of propertiesById.values()) {
    if (p.units.length === 0 && p.children.length === 0 && (p.ownBedroomCount || 0) > 0 && p.segment !== "COMMERCIAL") {
      p.ownLeaf = { key: `p:${p.id}`, kind: "property", id: p.id, name: p.name, bedroomId: null, unitId: null, propertyId: p.id, beds: p.ownBedroomCount };
      p.leaves.push(p.ownLeaf);
      leaves.push(p.ownLeaf);
      unitNodes.push({ id: `p:${p.id}`, name: p.name, propertyId: p.id, rrUnitId: null, ownBeds: p.ownBedroomCount, bedrooms: [], beds: p.ownBedroomCount, leaves: [p.ownLeaf], leaf: p.ownLeaf, propertyOnly: true });
      issues.push({ code: "PROPERTY_ONLY_LEAF", propertyId: p.id, detail: `no unit records; using property bedroom count ${p.ownBedroomCount}` });
    }
    p.beds = p.leaves.reduce((s, l) => s + l.beds, 0);
  }
  return { propertiesById, unitsById, bedroomsById, leaves, unitNodes, issues };
}
function levelOf(inv, unitsBedroomsId) {
  const id = S(unitsBedroomsId);
  if (id == null) return null;
  if (inv.bedroomsById.has(id)) return "bedroom";
  if (inv.unitsById.has(id)) return "unit";
  return null;
}

// src/shared/rules/lease.js
var S2 = (v) => v == null ? null : String(v);
var num2 = (v) => v == null || v === "" ? null : Number(v);
function parseIdList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}
function termMonths(l) {
  const dateMonths = l.start && l.end ? monthsBetweenCeil(l.start, l.end) : null;
  const dateFraction = l.start && l.end ? monthsBetweenFraction(l.start, l.end) : null;
  if (l.durationField != null && l.durationField > 0) return { termMonths: Math.ceil(l.durationField), termSource: "duration", dateMonths, dateFraction };
  if (l.totalRent != null && l.monthlyRent > 0) return { termMonths: Math.max(1, Math.ceil(l.totalRent / l.monthlyRent - 1e-9)), termSource: "rent", dateMonths, dateFraction };
  if (dateMonths != null && dateMonths > 0) return { termMonths: dateMonths, termSource: "dates", dateMonths, dateFraction };
  return { termMonths: null, termSource: null, dateMonths, dateFraction };
}
function normalizeLease(raw, lookups = {}) {
  const typeKey = leaseTypeKey(raw.lease_type_name ?? raw.lease_type, lookups.leaseTypeIds) ?? leaseTypeKey(raw.lease_type, lookups.leaseTypeIds);
  const statusKey = raw.status == null && raw.status_name == null ? "NONE" : leaseStatusKey(raw.status_name ?? raw.status, lookups.leaseStatusIds);
  const l = {
    id: S2(raw.id),
    name: raw.name || `Lease ${raw.id}`,
    inactive: raw.isinactive === "T",
    propertyId: S2(raw.property),
    unitId: S2(raw.unit),
    typeKey,
    typeRaw: raw.lease_type ?? null,
    statusKey,
    statusRaw: raw.status ?? null,
    start: toISO(raw.start_date),
    end: toISO(raw.end_date),
    sentDate: toISO(raw.sent_date),
    signedDate: toISO(raw.signed_date),
    signedFlag: raw.signed_flag === "T",
    monthlyRent: num2(raw.monthly_rent) || 0,
    totalRent: num2(raw.total_rent),
    durationField: num2(raw.duration_months),
    tenantCount: num2(raw.tenant_count) || 0,
    tenantIds: parseIdList(raw.tenants),
    ayFieldRaw: raw.ay ?? null,
    ayFieldYear: ayYearFromLabel(raw.ay_name) ?? (lookups.ayYears ? lookups.ayYears[S2(raw.ay)] ?? null : null),
    groupType: raw.group_type ?? null,
    targetPerBed: num2(raw.target_per_bed),
    targetMonthly: num2(raw.target_monthly),
    rrUnitId: raw.rr_unit_id || null,
    created: toISO(raw.created),
    lastModified: toISO(raw.lastmodified)
  };
  if (l.tenantCount === 0 && l.tenantIds.length) l.tenantCount = l.tenantIds.length;
  const t = termMonths(l);
  Object.assign(l, t);
  l.badDates = !!(l.start && l.end && daysBetween(l.start, l.end) < 0);
  l.missingDates = !l.start || !l.end;
  l.isTwoYear = !l.badDates && !l.missingDates && l.dateMonths >= TWO_YEAR_MIN_MONTHS;
  l.termMismatch = !l.badDates && !l.missingDates && l.durationField != null && l.durationField >= TWO_YEAR_MIN_MONTHS && l.dateMonths < TWO_YEAR_MIN_MONTHS;
  if (l.isTwoYear && (l.termMonths == null || l.termMonths < TWO_YEAR_MIN_MONTHS)) {
    l.termMonths = l.dateMonths;
    l.termSource = "dates";
  }
  l.ayStartYear = l.start ? ayForDate(l.start) : null;
  l.years = [];
  if (l.isTwoYear) {
    const months1 = Math.min(12, l.termMonths);
    const months2 = Math.max(0, l.termMonths - months1);
    l.years.push({ ay: l.ayStartYear, months: months1, carried: false });
    if (months2 > 0) l.years.push({ ay: l.ayStartYear + 1, months: months2, carried: true });
  } else {
    const ay = l.ayFieldYear ?? l.ayStartYear;
    if (ay != null) l.years.push({ ay, months: l.termMonths ?? 0, carried: false });
  }
  for (const y of l.years) {
    y.monthlyRent = l.monthlyRent;
    y.revenue = l.monthlyRent * y.months;
  }
  return l;
}
function yearEntry(lease, ay) {
  return lease.years.find((y) => y.ay === ay) || null;
}

// src/shared/rules/overlap.js
function overlapDays(a, b) {
  const as = dayNum(a.start), ae = dayNum(a.end), bs = dayNum(b.start), be = dayNum(b.end);
  if ([as, ae, bs, be].some((x) => x == null)) return null;
  const aEnd = ae + 1, bEnd = be + 1;
  const lo = Math.max(as, bs), hi = Math.min(aEnd, bEnd);
  return Math.max(0, hi - lo);
}
function classifyPair(a, b, tolerance = OVERLAP_TOLERANCE_DAYS) {
  const d = overlapDays(a, b);
  if (d == null) return "undated";
  if (d === 0) return "none";
  if (d <= tolerance) return "minor";
  return "collide";
}
function collides(a, b, { requireOverlap, tolerance } = {}) {
  if (!requireOverlap) return "collide";
  const c = classifyPair(a, b, tolerance);
  return c === "undated" ? "collide" : c;
}

// src/shared/rules/people.js
function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}
function splitPeople(total, weights) {
  const n = weights.length;
  const N = Math.max(0, Number(total) || 0);
  if (n === 0) return [];
  const sumW = weights.reduce((s, w) => s + (Number(w) || 0), 0);
  const out = new Array(n).fill(0);
  if (sumW <= 0) {
    out[0] = N;
    return out;
  }
  let cum = 0, prev = 0;
  for (let k = 0; k < n; k++) {
    cum += Number(weights[k]) || 0;
    const upto = roundHalfUp(N * cum / sumW);
    out[k] = upto - prev;
    prev = upto;
  }
  return out;
}

// src/shared/rules/placement.js
function resolveScope(inv, l) {
  const fail = (code, detail) => ({ ok: false, code, detail: detail || null, level: null, leaves: [], beds: 0 });
  if (!l.typeKey) return fail("UNKNOWN_TYPE", l.typeRaw == null ? "blank" : `value ${l.typeRaw}`);
  if (l.badDates) return fail("BAD_DATES", `${l.start} → ${l.end}`);
  if (l.missingDates) return fail("BAD_DATES", "start or end date missing");
  const level = levelOf(inv, l.unitId);
  const unitRec = level === "unit" ? inv.unitsById.get(l.unitId) : level === "bedroom" ? inv.unitsById.get(inv.bedroomsById.get(l.unitId).unitId) : null;
  let property = inv.propertiesById.get(l.propertyId) || null;
  const notes = [];
  if (!property && unitRec) {
    property = inv.propertiesById.get(unitRec.propertyId) || null;
    if (property) notes.push("property taken from the linked unit");
  }
  if (!property) return fail("NO_PROP", l.propertyId ? `property ${l.propertyId} missing or inactive` : "blank");
  if (unitRec && unitRec.propertyId !== property.id) notes.push(`unit belongs to property ${unitRec.propertyId}, lease says ${property.id}`);
  let scope;
  if (l.typeKey === "WH") {
    if (!l.unitId) scope = { level: "property", propertyId: property.id, unitId: null, bedroomId: null, leaves: property.leaves };
    else if (level === "unit") scope = { level: "unit", propertyId: unitRec.propertyId, unitId: unitRec.id, bedroomId: null, leaves: unitRec.leaves };
    else if (level === "bedroom") return fail("UNIT_ON_BED", "whole-house lease linked to a bedroom record");
    else return fail("NOT_LINKED", `link ${l.unitId} points at a missing or inactive Units/Bedrooms record`);
  } else if (l.typeKey === "UNIT") {
    if (!l.unitId) return fail("NOT_LINKED");
    if (level === "unit") scope = { level: "unit", propertyId: unitRec.propertyId, unitId: unitRec.id, bedroomId: null, leaves: unitRec.leaves };
    else if (level === "bedroom") return fail("UNIT_ON_BED");
    else return fail("NOT_LINKED", `link ${l.unitId} points at a missing or inactive Units/Bedrooms record`);
  } else if (l.typeKey === "BED") {
    if (!l.unitId) return fail("NOT_LINKED");
    if (level === "bedroom") {
      const b = inv.bedroomsById.get(l.unitId);
      scope = { level: "bedroom", propertyId: b.propertyId, unitId: b.unitId, bedroomId: b.id, leaves: [b] };
    } else if (level === "unit") return fail("BED_ON_UNIT");
    else return fail("NOT_LINKED", `link ${l.unitId} points at a missing or inactive Units/Bedrooms record`);
  } else return fail("UNKNOWN_TYPE", l.typeKey);
  scope.beds = scope.leaves.reduce((s, x) => s + x.beds, 0);
  const rentOnly = !(SEGMENTS[property.segment] || SEGMENTS.STUDENT).beds;
  if (scope.beds === 0 && !rentOnly) return { ...fail("ZERO_BEDS", `${scope.level} has 0 beds`), ...{ level: scope.level, propertyId: scope.propertyId, unitId: scope.unitId, bedroomId: scope.bedroomId } };
  return { ok: true, code: null, detail: notes.join("; ") || null, ...scope };
}
function exc(code, l, scope, ay, extra = {}) {
  const meta = EXCEPTION_CODES[code];
  return {
    code,
    severity: meta.severity,
    excludes: meta.excludes,
    label: meta.label,
    leaseId: l.id,
    leaseName: l.name,
    ay,
    propertyId: scope?.propertyId ?? l.propertyId ?? null,
    unitId: scope?.unitId ?? null,
    bedroomId: scope?.bedroomId ?? null,
    linkId: l.unitId,
    typeKey: l.typeKey,
    statusKey: l.statusKey,
    start: l.start,
    end: l.end,
    monthlyRent: l.monthlyRent,
    detail: extra.detail ?? scope?.detail ?? null,
    partners: extra.partners || [],
    overlapDays: extra.overlapDays ?? null,
    version: l.lastModified || null,
    ayId: l.ayFieldRaw == null ? null : String(l.ayFieldRaw)
  };
}
function placeLeases({ inventory: inv, leases, ay, basis = DEFAULT_BASIS, flags = FEATURE_FLAGS, tolerance = OVERLAP_TOLERANCE_DAYS }) {
  const basisStatuses = new Set((BASES[basis] || BASES[DEFAULT_BASIS]).statuses);
  const requireOverlap = !!flags.requireOverlapForCollision;
  const leaseResults = /* @__PURE__ */ new Map();
  const exceptions = [];
  const counted = [];
  for (const l of leases) {
    if (l.inactive) continue;
    const year = yearEntry(l, ay);
    if (!year) continue;
    const scope = resolveScope(inv, l);
    const r = { lease: l, year, scope, status: "skipped", code: null, flags: [], coveredBeds: scope.ok ? scope.beds : 0 };
    leaseResults.set(l.id, r);
    if (l.statusKey === "NONE") {
      r.status = "excluded";
      r.code = "NO_STATUS";
      exceptions.push(exc("NO_STATUS", l, scope, ay));
      if (!scope.ok) {
        exceptions.push(exc(scope.code, l, scope, ay));
      }
      continue;
    }
    if (!basisStatuses.has(l.statusKey)) {
      r.status = "skipped";
      continue;
    }
    if (l.termMismatch) {
      r.flags.push("TERM_MISMATCH");
      exceptions.push(exc("TERM_MISMATCH", l, scope, ay, { detail: `duration field ${l.durationField}, dates span ${l.dateMonths} months` }));
    }
    if (!scope.ok) {
      r.status = "excluded";
      r.code = scope.code;
      exceptions.push(exc(scope.code, l, scope, ay));
      continue;
    }
    r.status = "counted";
    counted.push(r);
  }
  const assign = (r, code, partner, cls, days) => {
    if (cls === "minor") {
      r.flags.push("OVERLAP_MINOR");
      exceptions.push(exc("OVERLAP_MINOR", r.lease, r.scope, ay, { partners: [partner.lease.id], overlapDays: days }));
      return;
    }
    if (r.code) {
      if (!r.partners) r.partners = [];
      r.partners.push(partner.lease.id);
      return;
    }
    r.code = code;
    r.status = "excluded";
    r.partners = [partner.lease.id];
    r._pendingExc = { code, days };
  };
  const pairCheck = (a, b, codeA, codeB) => {
    const cls = collides(a.lease, b.lease, { requireOverlap, tolerance });
    if (cls === "none") return;
    const days = requireOverlap ? overlapDays(a.lease, b.lease) : null;
    assign(a, codeA, b, cls, days);
    assign(b, codeB, a, cls, days);
  };
  const byProp = groupBy(counted, (r) => r.scope.propertyId);
  for (const rows of byProp.values()) {
    const P = rows.filter((r) => r.scope.level === "property");
    const O = rows.filter((r) => r.scope.level !== "property");
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) pairCheck(P[i], P[j], "WH_MULTI", "WH_MULTI");
    for (const p of P) for (const o of O) pairCheck(p, o, "WH_PLUS", "PROP_HAS_WH");
  }
  const byUnit = groupBy(counted.filter((r) => r.scope.unitId), (r) => r.scope.unitId);
  for (const rows of byUnit.values()) {
    const U = rows.filter((r) => r.scope.level === "unit");
    const B = rows.filter((r) => r.scope.level === "bedroom");
    for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) pairCheck(U[i], U[j], "MULTI_UNIT", "MULTI_UNIT");
    for (const u of U) for (const b of B) pairCheck(u, b, "UNIT_PLUS_BED", "UNIT_HAS");
  }
  const byBed = groupBy(counted.filter((r) => r.scope.level === "bedroom"), (r) => r.scope.bedroomId);
  for (const rows of byBed.values()) for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) pairCheck(rows[i], rows[j], "MULTI_BED", "MULTI_BED");
  for (const r of counted) if (r._pendingExc) {
    exceptions.push(exc(r._pendingExc.code, r.lease, r.scope, ay, { partners: r.partners, overlapDays: r._pendingExc.days }));
    delete r._pendingExc;
  }
  const byTenant = /* @__PURE__ */ new Map();
  for (const r of counted) for (const t of r.lease.tenantIds) {
    if (!byTenant.has(t)) byTenant.set(t, []);
    byTenant.get(t).push(r);
  }
  const doubles = /* @__PURE__ */ new Map();
  for (const [t, rows] of byTenant) {
    if (rows.length < 2) continue;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const cls = collides(rows[i].lease, rows[j].lease, { requireOverlap, tolerance });
      if (cls !== "collide") continue;
      if (!doubles.has(t)) doubles.set(t, /* @__PURE__ */ new Set());
      doubles.get(t).add(rows[i].lease.id).add(rows[j].lease.id);
    }
  }
  const tenantDoubles = [];
  for (const [tenantId, ids2] of doubles) {
    const rows = [...ids2].map((id) => leaseResults.get(id));
    tenantDoubles.push({ tenantId, leases: rows.map((r) => ({ leaseId: r.lease.id, leaseName: r.lease.name, propertyId: r.scope.propertyId, unitId: r.scope.unitId, monthlyRent: r.lease.monthlyRent, start: r.lease.start, end: r.lease.end })) });
    for (const r of rows) {
      r.flags.push("TENANT_DOUBLE");
      exceptions.push(exc("TENANT_DOUBLE", r.lease, r.scope, ay, { partners: rows.filter((x) => x !== r).map((x) => x.lease.id), detail: `tenant ${tenantId}` }));
    }
  }
  const leafResults = /* @__PURE__ */ new Map();
  for (const leaf of inv.leaves) leafResults.set(leaf.key, { leaf, placements: [] });
  let placed = 0;
  for (const r of counted) {
    if (r.status !== "counted") continue;
    r.status = "placed";
    placed++;
    const people = splitPeople(r.lease.tenantCount, r.scope.leaves.map((x) => x.beds));
    r.scope.leaves.forEach((leaf, k) => {
      const share = r.scope.beds ? leaf.beds / r.scope.beds : 1 / r.scope.leaves.length;
      leafResults.get(leaf.key).placements.push({
        leaseId: r.lease.id,
        typeKey: r.lease.typeKey,
        statusKey: r.lease.statusKey,
        months: r.year.months,
        carried: r.year.carried,
        monthlyShare: r.lease.monthlyRent * share,
        revenueShare: r.year.revenue * share,
        people: people[k],
        start: r.lease.start,
        end: r.lease.end,
        scopeLevel: r.scope.level
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
  lr.monthly = ps.reduce((s, p) => s + p.monthlyShare, 0);
  lr.annual = ps.reduce((s, p) => s + p.revenueShare, 0);
  let primary = null;
  for (const p of ps) if (!primary || p.months > primary.months || p.months === primary.months && compare(p.start, primary.start) < 0) primary = p;
  lr.primary = primary;
  lr.people = primary ? primary.people : 0;
  lr.typeKey = primary ? primary.typeKey : null;
  lr.carriedOnly = ps.length > 0 && ps.every((p) => p.carried);
  lr.sequential = ps.length > 1;
  lr.start = ps.reduce((d, p) => p.start && (!d || compare(p.start, d) < 0) ? p.start : d, null);
  lr.end = ps.reduce((d, p) => p.end && (!d || compare(p.end, d) > 0) ? p.end : d, null);
  lr.types = [...new Set(ps.map((p) => p.typeKey).filter(Boolean))];
}
function groupBy(arr, keyFn) {
  const m = /* @__PURE__ */ new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// src/shared/rules/metrics.js
var SUM_KEYS = [
  "beds",
  "occupied",
  "bedMonths",
  "monthly",
  "annual",
  "people",
  "leaves",
  "occupiedLeaves",
  "targetMonthly",
  "targetBeds",
  "targetOcc",
  "monthlyOnTarget",
  "settleMonthly",
  "prevRentSum",
  "prevRentBeds",
  "carriedBeds",
  "pOccupied",
  "pBedMonths",
  "pMonthly",
  "pAnnual",
  "pPeople",
  "ssBeds",
  "ssCur",
  "ssPrior",
  "activeLeases",
  "excludedLeases",
  "pActiveLeases"
];
function emptyMetrics() {
  const m = { byType: { WH: 0, UNIT: 0, BED: 0 }, occPct: null, finOccPct: null, rentPerBed: null, rentPerPerson: null, targetVariance: null };
  for (const k of SUM_KEYS) m[k] = 0;
  return m;
}
function addLeaf(m, lr, segmentMeta, plr = null) {
  const beds = segmentMeta.beds ? lr.leaf.beds : 0;
  m.leaves += 1;
  m.beds += beds;
  m.occupied += segmentMeta.beds ? lr.occupied : 0;
  m.occupiedLeaves += lr.occupied ? 1 : 0;
  m.bedMonths += segmentMeta.beds ? lr.occupied * lr.months : 0;
  m.monthly += lr.monthly;
  m.annual += lr.annual;
  m.people += lr.people;
  if (lr.typeKey && segmentMeta.beds) m.byType[lr.typeKey] += lr.occupied;
  if (lr.carriedOnly && segmentMeta.beds) m.carriedBeds += lr.occupied;
  if (lr.targetMonthly != null) {
    m.targetMonthly += lr.targetMonthly;
    m.targetBeds += beds;
    if (lr.occupied) {
      m.targetOcc += lr.targetMonthly;
      m.monthlyOnTarget += lr.monthly;
    }
  }
  if (lr.settleMonthly != null) m.settleMonthly += lr.settleMonthly;
  if (lr.prevRentPerBed != null) {
    m.prevRentSum += lr.prevRentPerBed * beds;
    m.prevRentBeds += beds;
  }
  if (plr) {
    m.pOccupied += segmentMeta.beds ? plr.occupied : 0;
    m.pBedMonths += segmentMeta.beds ? plr.occupied * plr.months : 0;
    m.pMonthly += plr.monthly;
    m.pAnnual += plr.annual;
    m.pPeople += plr.people;
  }
  if (lr.sameStore && plr) {
    m.ssBeds += beds;
    m.ssCur += lr.monthly;
    m.ssPrior += plr.monthly;
  }
  return m;
}
function addMetrics(a, b) {
  for (const k of SUM_KEYS) a[k] += b[k] || 0;
  for (const t of Object.keys(a.byType)) a.byType[t] += b.byType && b.byType[t] || 0;
  return a;
}
var ratio = (a, b) => b > 0 ? a / b : null;
var growth = (cur, prev) => prev > 0 ? cur / prev - 1 : null;
function finish(m) {
  m.vacant = m.beds - m.occupied;
  m.occPct = ratio(m.occupied, m.beds);
  m.vacPct = ratio(m.vacant, m.beds);
  m.finBeds = m.bedMonths / 12;
  m.finOccPct = ratio(m.bedMonths / 12, m.beds);
  m.rentPerBed = ratio(m.monthly, m.occupied);
  m.rentPerPerson = ratio(m.monthly, m.people);
  m.targetVariance = m.targetMonthly ? m.monthly - m.targetMonthly : null;
  m.targetPerBed = ratio(m.targetMonthly, m.targetBeds);
  m.actVsTarget = m.targetOcc > 0 ? m.monthlyOnTarget / m.targetOcc - 1 : null;
  m.targetVacant = m.targetMonthly ? m.targetMonthly - m.targetOcc : null;
  m.prevRentPerBed = ratio(m.prevRentSum, m.prevRentBeds);
  m.pVacant = m.beds - m.pOccupied;
  m.pOccPct = ratio(m.pOccupied, m.beds);
  m.pFinOccPct = ratio(m.pBedMonths / 12, m.beds);
  m.pRentPerBed = ratio(m.pMonthly, m.pOccupied);
  m.occDelta = m.occPct != null && m.pOccPct != null ? m.occPct - m.pOccPct : null;
  m.mrevYoY = growth(m.monthly, m.pMonthly);
  m.trevYoY = growth(m.annual, m.pAnnual);
  m.rentBedYoY = m.occupied > 0 && m.pOccupied > 0 ? growth(m.monthly / m.occupied, m.pMonthly / m.pOccupied) : null;
  m.ssYoY = growth(m.ssCur, m.ssPrior);
  return m;
}
function round(m, places = 2) {
  const out = { ...m, byType: { ...m.byType } };
  for (const k of Object.keys(out)) if (typeof out[k] === "number") out[k] = Number(out[k].toFixed(places));
  return out;
}
function applyTargets(inventory, leafResults, targets, ay) {
  const byUnit = /* @__PURE__ */ new Map();
  const issues = [];
  for (const t of targets.slice().sort((a, b) => Number(a.id) - Number(b.id))) {
    if (t.ay !== ay) continue;
    if (!t.unitId || !inventory.unitsById.has(String(t.unitId))) {
      issues.push({ code: "TARGET_NO_UNIT", targetId: t.id, propertyId: t.propertyId, detail: `Academic Year Details #${t.id} has no active unit` });
      continue;
    }
    if (byUnit.has(String(t.unitId))) issues.push({ code: "TARGET_DUPLICATE", targetId: t.id, unitId: String(t.unitId), propertyId: t.propertyId, detail: `unit has more than one Academic Year Details row; #${t.id} used` });
    byUnit.set(String(t.unitId), t);
  }
  for (const u of inventory.unitsById.values()) {
    const t = byUnit.get(u.id);
    if (!t || !u.beds) continue;
    const unitTarget = t.targetMonthly != null ? t.targetMonthly : t.targetPerBed != null ? t.targetPerBed * u.beds : null;
    const settle = t.settleMonthly != null ? t.settleMonthly : t.settlePerBed != null ? t.settlePerBed * u.beds : null;
    for (const leaf of u.leaves) {
      const lr = leafResults.get(leaf.key);
      if (!lr) continue;
      const share = leaf.beds / u.beds;
      if (unitTarget != null) {
        lr.targetMonthly = unitTarget * share;
        lr.targetPerBed = unitTarget / u.beds;
      }
      if (settle != null) {
        lr.settleMonthly = settle * share;
        lr.settlePerBed = settle / u.beds;
      }
      if (t.prevYearPerBed != null) lr.prevRentPerBed = t.prevYearPerBed;
    }
  }
  return issues;
}
function leaseCounts(placement) {
  const by = { bedroom: /* @__PURE__ */ new Map(), unit: /* @__PURE__ */ new Map(), property: /* @__PURE__ */ new Map() };
  const bump = (map, id, key) => {
    if (id == null) return;
    const o = map.get(id) || { active: 0, excluded: 0 };
    o[key] += 1;
    map.set(id, o);
  };
  for (const r of placement.leaseResults.values()) {
    if (r.status !== "placed" && r.status !== "excluded") continue;
    const key = r.status === "placed" ? "active" : "excluded";
    const s = r.scope;
    if (s.ok || s.level) {
      if (s.level === "bedroom") bump(by.bedroom, s.bedroomId, key);
      else if (s.level === "unit") bump(by.unit, s.unitId, key);
      else bump(by.property, s.propertyId, key);
    } else if (r.lease.propertyId) bump(by.property, r.lease.propertyId, key);
  }
  return by;
}
function rollup(inventory, placement, prior = null) {
  const segFor = (leaf) => {
    const p = inventory.propertiesById.get(leaf.propertyId);
    return p && SEGMENTS[p.segment] || SEGMENTS.STUDENT;
  };
  const inMain = (seg) => seg.inOccupancy;
  const priorOf = (key) => prior ? prior.leafResults.get(key) || null : null;
  const leafM = (lr) => {
    const seg = segFor(lr.leaf);
    return { seg, m: finish(addLeaf(emptyMetrics(), lr, seg, priorOf(lr.leaf.key))) };
  };
  const counts = leaseCounts(placement);
  const pcounts = prior ? leaseCounts(prior) : null;
  const addCounts = (m, level, id) => {
    const c = counts[level].get(id);
    if (c) {
      m.activeLeases += c.active;
      m.excludedLeases += c.excluded;
    }
    const pc = pcounts && pcounts[level].get(id);
    if (pc) m.pActiveLeases += pc.active;
  };
  const funds = /* @__PURE__ */ new Map();
  const summary = { student: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics(), byFund: [], byMarket: [], unmapped: emptyMetrics() };
  const bucketOf = (seg) => seg.key === "STR" ? summary.str : seg.key === "COMMERCIAL" ? summary.commercial : summary.student;
  for (const p of inventory.propertiesById.values()) {
    const fundKey = p.fund || "UNMAPPED";
    if (!funds.has(fundKey)) funds.set(fundKey, node("fund", fundKey, fundKey));
    const f = funds.get(fundKey);
    if (!f.childMap.has(p.marketId)) f.childMap.set(p.marketId, node("market", p.marketId, p.marketLabel));
    const mk = f.childMap.get(p.marketId);
    const pn = node("property", p.id, p.name);
    pn.segment = p.segment;
    pn.parentPropertyId = p.parentId;
    pn.isParent = p.children.length > 0;
    const seg = SEGMENTS[p.segment] || SEGMENTS.STUDENT;
    const main = inMain(seg);
    for (const uid of p.units) {
      const u = inventory.unitsById.get(uid);
      const un = node("unit", u.id, u.name);
      un.segment = p.segment;
      un.rrUnitId = u.rrUnitId;
      for (const leaf of u.leaves) {
        const lr = placement.leafResults.get(leaf.key);
        const { m } = leafM(lr);
        if (leaf.kind === "bedroom") {
          addCounts(m, "bedroom", leaf.id);
          finish(m);
          const bn = node("bedroom", leaf.id, leaf.name);
          bn.metrics = m;
          bn.leaf = summarizeLeaf(lr, priorOf(leaf.key));
          un.children.push(bn);
        } else un.leaf = summarizeLeaf(lr, priorOf(leaf.key));
        addMetrics(un.metrics, m);
      }
      addCounts(un.metrics, "unit", u.id);
      finish(un.metrics);
      pn.children.push(un);
      addMetrics(pn.metrics, un.metrics);
    }
    if (p.ownLeaf) {
      const lr = placement.leafResults.get(p.ownLeaf.key);
      const { m } = leafM(lr);
      pn.leaf = summarizeLeaf(lr, priorOf(p.ownLeaf.key));
      addMetrics(pn.metrics, m);
    }
    addCounts(pn.metrics, "property", p.id);
    finish(pn.metrics);
    mk.children.push(pn);
    if (main) {
      addMetrics(mk.metrics, pn.metrics);
    } else {
      addMetrics(seg.key === "STR" ? mk.str : mk.commercial, pn.metrics);
    }
    addMetrics(bucketOf(seg), pn.metrics);
    if (!p.fund) addMetrics(summary.unmapped, pn.metrics);
  }
  const tree = [];
  for (const f of funds.values()) {
    for (const mk of f.childMap.values()) {
      finish(mk.metrics);
      finish(mk.str);
      finish(mk.commercial);
      f.children.push(mk);
      addMetrics(f.metrics, mk.metrics);
      addMetrics(f.str, mk.str);
      addMetrics(f.commercial, mk.commercial);
      summary.byMarket.push({ fund: f.id, marketId: mk.id, market: mk.name, metrics: mk.metrics, str: mk.str, commercial: mk.commercial });
    }
    finish(f.metrics);
    finish(f.str);
    finish(f.commercial);
    delete f.childMap;
    tree.push(f);
    summary.byFund.push({ fund: f.id, metrics: f.metrics, str: f.str, commercial: f.commercial });
  }
  finish(summary.student);
  finish(summary.str);
  finish(summary.commercial);
  finish(summary.unmapped);
  const mkTotals = /* @__PURE__ */ new Map();
  for (const row of summary.byMarket) {
    if (!mkTotals.has(row.marketId)) mkTotals.set(row.marketId, { marketId: row.marketId, market: row.market, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() });
    const t = mkTotals.get(row.marketId);
    addMetrics(t.metrics, row.metrics);
    addMetrics(t.str, row.str);
    addMetrics(t.commercial, row.commercial);
  }
  summary.byMarketTotal = [...mkTotals.values()].map((t) => ({ ...t, metrics: finish(t.metrics), str: finish(t.str), commercial: finish(t.commercial) }));
  return { tree, summary };
}
function node(kind, id, name) {
  return { key: `${kind[0]}:${id}`, kind, id, name, children: [], childMap: kind === "fund" ? /* @__PURE__ */ new Map() : void 0, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() };
}
function leafTypeLabel(lr) {
  if (!lr || !lr.occupied) return "Vacant";
  const types = [...new Set(lr.placements.map((p) => p.typeKey).filter(Boolean))];
  if (types.length > 1) return "Mixed";
  return (LEASE_TYPES[types[0]] || {}).label || "Unknown";
}
function summarizeLeaf(lr, plr) {
  return {
    occupied: lr.occupied,
    months: lr.months,
    monthly: lr.monthly,
    annual: lr.annual,
    people: lr.people,
    typeKey: lr.typeKey,
    typeLabel: leafTypeLabel(lr),
    start: lr.start || null,
    end: lr.end || null,
    leases: lr.placements.map((p) => p.leaseId),
    sequential: lr.sequential,
    carriedOnly: lr.carriedOnly,
    settleMonthly: lr.settleMonthly ?? null,
    targetMonthly: lr.targetMonthly ?? null,
    prevRentPerBed: lr.prevRentPerBed ?? null,
    sameStore: !!lr.sameStore,
    ssWhy: lr.ssWhy || null,
    prior: plr ? { occupied: plr.occupied, monthly: plr.monthly, leases: plr.placements.map((p) => p.leaseId) } : null
  };
}
function compareMetrics(cur, prior) {
  const d = (k) => cur[k] == null || !prior || prior[k] == null ? null : cur[k] - prior[k];
  return { occupied: d("occupied"), occPct: d("occPct"), rentPerBed: d("rentPerBed"), monthly: d("monthly"), beds: d("beds"), people: d("people"), finOccPct: d("finOccPct"), annual: d("annual") };
}

// src/shared/rules/samestore.js
function markSameStore(inventory, cur, prior) {
  const tally = { grains: 0, beds: 0, dropped: { excluded: 0, vacantCur: 0, vacantPrior: 0 }, droppedBeds: { excluded: 0, vacantCur: 0, vacantPrior: 0 } };
  for (const lr of cur.leafResults.values()) {
    lr.sameStore = false;
    lr.ssWhy = prior ? null : "noPrior";
  }
  if (!prior) return tally;
  const index = (placement) => {
    const ex = { byProp: /* @__PURE__ */ new Set(), byUnit: /* @__PURE__ */ new Set(), byBed: /* @__PURE__ */ new Set(), unattributed: /* @__PURE__ */ new Set(), whProp: /* @__PURE__ */ new Set() };
    for (const r of placement.leaseResults.values()) {
      if (r.status === "placed" && r.scope.level === "property") ex.whProp.add(r.scope.propertyId);
      if (r.status !== "excluded") continue;
      const s = r.scope;
      if (s.level === "bedroom") ex.byBed.add(s.bedroomId);
      else if (s.level === "unit") ex.byUnit.add(s.unitId);
      else if (s.level === "property") ex.byProp.add(s.propertyId);
      else if (r.lease.propertyId) ex.unattributed.add(r.lease.propertyId);
    }
    return ex;
  };
  const exCur = index(cur), exPrior = index(prior);
  for (const p of inventory.propertiesById.values()) {
    const propGrain = p.units.length === 0 || exCur.whProp.has(p.id) || exPrior.whProp.has(p.id);
    const grains = propGrain ? [{ leaves: p.leaves, whole: true, unitIds: p.units, bedIds: p.units.flatMap((uid) => inventory.unitsById.get(uid).bedrooms.map((b) => b.id)) }] : p.units.map((uid) => {
      const u = inventory.unitsById.get(uid);
      return { leaves: u.leaves, whole: false, unitIds: [u.id], bedIds: u.bedrooms.map((b) => b.id) };
    });
    for (const g of grains) {
      const beds = g.leaves.reduce((s, l) => s + l.beds, 0);
      if (beds <= 0) continue;
      const touched = (ex) => ex.unattributed.has(p.id) || g.whole && ex.byProp.has(p.id) || !g.whole && ex.byProp.has(p.id) || g.unitIds.some((id) => ex.byUnit.has(id)) || g.bedIds.some((id) => ex.byBed.has(id));
      let why = null;
      if (touched(exCur) || touched(exPrior)) why = "excluded";
      else if (g.leaves.some((l) => l.beds > 0 && !cur.leafResults.get(l.key).occupied)) why = "vacantCur";
      else if (g.leaves.some((l) => l.beds > 0 && !(prior.leafResults.get(l.key) || { occupied: 0 }).occupied)) why = "vacantPrior";
      for (const l of g.leaves) {
        const lr = cur.leafResults.get(l.key);
        lr.sameStore = !why;
        lr.ssWhy = why;
      }
      if (why) {
        tally.dropped[why] += 1;
        tally.droppedBeds[why] += beds;
      } else {
        tally.grains += 1;
        tally.beds += beds;
      }
    }
  }
  return tally;
}

// src/shared/rules/summary.js
var ratio2 = (a, b) => b > 0 ? a / b : null;
var growth2 = (cur, prev) => prev > 0 ? cur / prev - 1 : null;
var r2 = (v) => v == null ? null : Number(Number(v).toFixed(2));
var fundLabel = (k) => FUNDS[k] ? FUNDS[k].label : k === "UNMAPPED" ? "Unmapped fund" : k;
var mainSeg = (p) => !!p && (SEGMENTS[p.segment] || SEGMENTS.STUDENT).inOccupancy;
function leaseDateFor(lease, basis) {
  return basis === "executed" ? lease.signedDate || null : lease.sentDate || lease.signedDate || null;
}
function propertyOf(run, r) {
  return run.inventory.propertiesById.get(r.scope && r.scope.propertyId || r.lease.propertyId) || null;
}
function linkedName(run, r) {
  const s = r.scope || {};
  if (s.level === "bedroom") {
    const b = run.inventory.bedroomsById.get(s.bedroomId);
    const u = b && run.inventory.unitsById.get(b.unitId);
    return b ? `${u ? u.name + " › " : ""}${b.name}` : "";
  }
  if (s.level === "unit") {
    const u = run.inventory.unitsById.get(s.unitId);
    return u ? u.name : "";
  }
  if (r.lease.unitId) {
    const u = run.inventory.unitsById.get(r.lease.unitId) || run.inventory.bedroomsById.get(r.lease.unitId);
    return u ? u.name : `#${r.lease.unitId}`;
  }
  return "";
}
var typeLabel = (k) => (LEASE_TYPES[k] || {}).label || "Unknown";
var statusLabel = (k) => (LEASE_STATUSES[k] || {}).label || "–";
function paceCut(run, { today, basis }) {
  if (!run.prior || !today) return null;
  const shift = daysBetween(ayStartDate(run.ay - 1), ayStartDate(run.ay));
  const lyAsOf = addDays(today, -shift);
  const cut = dayNum(lyAsOf);
  const rows = [];
  for (const r of run.prior.placement.leaseResults.values()) {
    if (r.status !== "placed") continue;
    const d = leaseDateFor(r.lease, basis);
    if (d && dayNum(d) <= cut) rows.push(r);
  }
  return { asOf: today, lyAsOf, shiftDays: shift, rows };
}
function paceFor(pace, run, pred) {
  if (!pace) return null;
  let occ = 0, trev = 0, leases = 0;
  for (const r of pace.rows) {
    const p = propertyOf(run.prior ? { inventory: run.inventory } : run, r);
    if (!mainSeg(p) || !pred(p, r)) continue;
    occ += r.coveredBeds;
    trev += r.year.revenue;
    leases += 1;
  }
  return { occ, trev: r2(trev), leases };
}
function kpiRow(name, m, pace) {
  const occPct = ratio2(m.occupied, m.beds);
  const wkOccPct = pace ? ratio2(pace.occ, m.beds) : null;
  return {
    name,
    beds: m.beds,
    occ: m.occupied,
    vacant: m.beds - m.occupied,
    occPct,
    vacPct: ratio2(m.beds - m.occupied, m.beds),
    finBeds: r2(m.bedMonths / 12),
    finPct: ratio2(m.bedMonths / 12, m.beds),
    occWH: m.byType.WH,
    occUnit: m.byType.UNIT,
    occBed: m.byType.BED,
    people: m.people,
    leases: m.activeLeases,
    excluded: m.excludedLeases,
    mrev: r2(m.monthly),
    trev: r2(m.annual),
    rentBed: ratio2(m.monthly, m.occupied),
    rentPerson: ratio2(m.monthly, m.people),
    pOcc: m.pOccupied,
    pVacant: m.beds - m.pOccupied,
    pOccPct: ratio2(m.pOccupied, m.beds),
    occDelta: occPct != null && m.beds ? occPct - m.pOccupied / m.beds : null,
    pFinPct: ratio2(m.pBedMonths / 12, m.beds),
    pPeople: m.pPeople,
    pLeases: m.pActiveLeases,
    pMrev: r2(m.pMonthly),
    pTrev: r2(m.pAnnual),
    mrevYoY: growth2(m.monthly, m.pMonthly),
    trevYoY: growth2(m.annual, m.pAnnual),
    pRentBed: ratio2(m.pMonthly, m.pOccupied),
    rentBedYoY: m.occupied > 0 && m.pOccupied > 0 ? growth2(m.monthly / m.occupied, m.pMonthly / m.pOccupied) : null,
    ssBeds: m.ssBeds,
    ssCur: r2(m.ssCur),
    ssPrior: r2(m.ssPrior),
    ssYoY: growth2(m.ssCur, m.ssPrior),
    tgt: r2(m.targetMonthly),
    tgtBeds: m.targetBeds,
    tgtBed: ratio2(m.targetMonthly, m.targetBeds),
    tgtOcc: r2(m.targetOcc),
    tgtVacant: r2(m.targetMonthly - m.targetOcc),
    actVsTgt: m.targetOcc > 0 ? m.monthlyOnTarget / m.targetOcc - 1 : null,
    settle: r2(m.settleMonthly),
    prevRentBed: ratio2(m.prevRentSum, m.prevRentBeds),
    lyWkOcc: pace ? pace.occ : null,
    lyWkOccPct: wkOccPct,
    lyWkDelta: pace && occPct != null && wkOccPct != null ? occPct - wkOccPct : null,
    lyWkLeases: pace ? pace.leases : null,
    lyWkTrev: pace ? pace.trev : null,
    trevPace: pace ? growth2(m.annual, pace.trev) : null
  };
}
function blockingByReason(run, { keep = () => true } = {}) {
  const byReason = /* @__PURE__ */ new Map();
  for (const r of run.placement.leaseResults.values()) {
    if (r.status !== "excluded") continue;
    const p = propertyOf(run, r);
    if (p && (!mainSeg(p) || !keep(p))) continue;
    if (!p && !keep({ fund: null, marketId: "unknown" })) continue;
    const g = byReason.get(r.code) || { code: r.code, leases: 0, beds: 0, people: 0, mrev: 0, trev: 0, rows: [] };
    g.leases += 1;
    g.beds += r.coveredBeds || 0;
    g.people += r.lease.tenantCount;
    g.mrev += r.lease.monthlyRent;
    g.trev += r.year.revenue;
    g.rows.push({ id: r.lease.id, name: r.lease.name, market: p ? p.marketLabel : "", property: p ? p.name : "", propertyId: p ? p.id : null, linked: linkedName(run, r), type: typeLabel(r.lease.typeKey), status: r.lease.statusKey, start: r.lease.start, end: r.lease.end, beds: r.coveredBeds || 0, people: r.lease.tenantCount, mrev: r.lease.monthlyRent, trev: r2(r.year.revenue), partners: r.partners || [] });
    byReason.set(r.code, g);
  }
  const blocking = [...byReason.values()].map((g) => ({ ...g, mrev: r2(g.mrev), trev: r2(g.trev) })).sort((a, b) => b.trev - a.trev || b.leases - a.leases);
  const blockingTotal = blocking.reduce((t, g) => ({ leases: t.leases + g.leases, beds: t.beds + g.beds, people: t.people + g.people, mrev: r2(t.mrev + g.mrev), trev: r2(t.trev + g.trev) }), { leases: 0, beds: 0, people: 0, mrev: 0, trev: 0 });
  return { blocking, blockingTotal };
}
function summaryExtras(run, { keep = () => true, today = null, basis = run.basis } = {}) {
  const inv = run.inventory;
  const pace = paceCut(run, { today, basis });
  const cells = run.summary.byMarket.filter((c) => keep({ fund: c.fund, marketId: c.marketId }));
  const sum = (list) => finish(list.reduce((m, c) => addMetrics(m, c.metrics), emptyMetrics()));
  const total = sum(cells);
  const byFundKeys = [...new Set(cells.map((c) => c.fund))].sort();
  const byMarketKeys = [...new Set(cells.map((c) => c.marketId))].sort((a, b) => a.localeCompare(b));
  const mkName = (id) => (cells.find((c) => c.marketId === id) || {}).market || id;
  const row = (name, list, pred) => kpiRow(name, sum(list), paceFor(pace, run, pred));
  const kpi = {
    total: row("Total", cells, () => true),
    byFund: byFundKeys.map((f) => ({
      key: f,
      row: row(fundLabel(f), cells.filter((c) => c.fund === f), (p) => p.fund === f),
      children: byMarketKeys.filter((m) => cells.some((c) => c.fund === f && c.marketId === m)).map((m) => row(mkName(m), cells.filter((c) => c.fund === f && c.marketId === m), (p) => p.fund === f && p.marketId === m))
    })),
    byMarket: byMarketKeys.map((m) => ({
      key: m,
      row: row(mkName(m), cells.filter((c) => c.marketId === m), (p) => p.marketId === m),
      children: byFundKeys.filter((f) => cells.some((c) => c.fund === f && c.marketId === m)).map((f) => row(fundLabel(f), cells.filter((c) => c.fund === f && c.marketId === m), (p) => p.fund === f && p.marketId === m))
    }))
  };
  const results = [...run.placement.leaseResults.values()].filter((r) => {
    const p = propertyOf(run, r);
    return p && mainSeg(p) && keep(p);
  });
  const placed = results.filter((r) => r.status === "placed");
  const excluded = results.filter((r) => r.status === "excluded");
  const priorPlaced = run.prior ? [...run.prior.placement.leaseResults.values()].filter((r) => r.status === "placed" && (() => {
    const p = propertyOf(run, r);
    return p && mainSeg(p) && keep(p);
  })()) : [];
  const byLeaseType = ["WH", "UNIT", "BED"].map((type) => {
    const list = placed.filter((r) => r.lease.typeKey === type);
    const occ = list.reduce((s, r) => s + r.coveredBeds, 0);
    const fin = list.reduce((s, r) => s + r.coveredBeds * Math.min(r.year.months, 12) / 12, 0);
    const people = list.reduce((s, r) => s + r.lease.tenantCount, 0);
    const mrev = list.reduce((s, r) => s + r.lease.monthlyRent, 0);
    const trev = list.reduce((s, r) => s + r.year.revenue, 0);
    const plist = priorPlaced.filter((r) => r.lease.typeKey === type);
    const pOcc = plist.reduce((s, r) => s + r.coveredBeds, 0), pMrev = plist.reduce((s, r) => s + r.lease.monthlyRent, 0), pTrev = plist.reduce((s, r) => s + r.year.revenue, 0);
    const tp = paceFor(pace, run, (p, r) => r.lease.typeKey === type);
    const occPct = ratio2(occ, total.beds), pOccPct = run.prior ? ratio2(pOcc, total.beds) : null;
    return {
      key: type,
      name: typeLabel(type),
      occ,
      occShare: ratio2(occ, total.occupied),
      occPct,
      finBeds: r2(fin),
      finPct: ratio2(fin, total.beds),
      leases: list.length,
      people,
      mrev: r2(mrev),
      trev: r2(trev),
      rentBed: ratio2(mrev, occ),
      rentPerson: ratio2(mrev, people),
      excluded: excluded.filter((r) => r.lease.typeKey === type).length,
      pOcc: run.prior ? pOcc : null,
      pOccPct,
      occDelta: pOccPct != null && occPct != null ? occPct - pOccPct : null,
      pLeases: run.prior ? plist.length : null,
      pMrev: run.prior ? r2(pMrev) : null,
      mrevYoY: run.prior ? growth2(mrev, pMrev) : null,
      pTrev: run.prior ? r2(pTrev) : null,
      trevYoY: run.prior ? growth2(trev, pTrev) : null,
      lyWkOcc: tp ? tp.occ : null,
      lyWkOccPct: tp ? ratio2(tp.occ, total.beds) : null,
      lyWkDelta: tp && occPct != null ? occPct - (ratio2(tp.occ, total.beds) || 0) : null,
      lyWkTrev: tp ? tp.trev : null,
      trevPace: tp ? growth2(trev, tp.trev) : null,
      pRentBed: run.prior ? ratio2(pMrev, pOcc) : null
    };
  });
  const leasePeople = placed.reduce((s, r) => s + r.lease.tenantCount, 0);
  const leaseMrev = placed.reduce((s, r) => s + r.lease.monthlyRent, 0);
  const leaseTrev = placed.reduce((s, r) => s + r.year.revenue, 0);
  let stackedPeople = 0, stackedLeaves = 0;
  for (const lr of run.placement.leafResults.values()) {
    if (lr.placements.length < 2) continue;
    const p = inv.propertiesById.get(lr.leaf.propertyId);
    if (!p || !mainSeg(p) || !keep(p)) continue;
    stackedLeaves += 1;
    stackedPeople += lr.placements.reduce((s, x) => s + x.people, 0) - (lr.primary ? lr.primary.people : 0);
  }
  const ties = { people: leasePeople - stackedPeople === total.people, mrev: Math.abs(leaseMrev - total.monthly) < 0.05, trev: Math.abs(leaseTrev - total.annual) < 0.05, leasePeople, leaseMrev: r2(leaseMrev), leaseTrev: r2(leaseTrev), stackedPeople, stackedLeaves };
  const vacancy = { fullUnits: 0, fullBeds: 0, partUnits: 0, partBeds: 0 };
  for (const u of inv.unitNodes) {
    const p = inv.propertiesById.get(u.propertyId);
    if (!p || !mainSeg(p) || !keep(p)) continue;
    const occ = u.leaves.reduce((s, l) => s + ((run.placement.leafResults.get(l.key) || {}).occupied || 0), 0);
    if (u.beds > 0 && occ === 0) {
      vacancy.fullUnits += 1;
      vacancy.fullBeds += u.beds;
    } else if (u.beds > occ) {
      vacancy.partUnits += 1;
      vacancy.partBeds += u.beds - occ;
    }
  }
  const recent = [];
  if (today) {
    const since = addDays(today, -3);
    for (const l of run.leases) {
      if (l.inactive || !l.created || dayNum(l.created) < dayNum(since)) continue;
      const p = inv.propertiesById.get(l.propertyId);
      if (!p || !keep(p)) continue;
      const linked = l.unitId ? (inv.unitsById.get(l.unitId) || inv.bedroomsById.get(l.unitId) || {}).name || `#${l.unitId}` : "";
      const ayYear = l.years.length ? l.years[0].ay : l.ayFieldYear ?? null;
      recent.push({ id: l.id, name: l.name, ay: ayYear != null ? `AY ${ayYear}-${ayYear + 1}` : "", status: statusLabel(l.statusKey), fund: fundLabel(p.fund), market: p.marketLabel, property: p.name, propertyId: p.id, linked, type: typeLabel(l.typeKey), people: l.tenantCount, mrev: l.monthlyRent, sent: l.sentDate, signed: l.signedDate, created: l.created });
    }
    recent.sort((a, b) => String(b.created).localeCompare(String(a.created)) || Number(b.id) - Number(a.id));
  }
  const propNodes = [];
  for (const f of run.tree) for (const mk of f.children) for (const pn of mk.children) {
    const p = inv.propertiesById.get(pn.id);
    if (p && keep(p)) propNodes.push({ pn, p });
  }
  const emptyParent = ({ pn }) => pn.isParent && !pn.metrics.beds && !pn.metrics.activeLeases && !pn.metrics.excludedLeases;
  const propertyCount = propNodes.filter((x) => mainSeg(x.p) && !emptyParent(x)).length;
  const strNodes = propNodes.filter((x) => x.p.segment === "STR" && !emptyParent(x));
  const strTotal = finish(strNodes.reduce((m, x) => addMetrics(m, x.pn.metrics), emptyMetrics()));
  const str = {
    properties: strNodes.length,
    leases: strTotal.activeLeases,
    excluded: strTotal.excludedLeases,
    total: kpiRow("Short-term rentals", strTotal, null),
    rows: strNodes.map((x) => ({ ...kpiRow(x.p.name, x.pn.metrics, null), id: x.p.id, market: x.p.marketLabel, fund: fundLabel(x.p.fund) })).sort((a, b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name, void 0, { numeric: true }))
  };
  const comNodes = propNodes.filter((x) => x.p.segment === "COMMERCIAL");
  const comRows = comNodes.map(({ pn, p }) => {
    const mine = [...run.placement.leaseResults.values()].filter((r) => r.status === "placed" && (r.scope.propertyId || r.lease.propertyId) === p.id);
    const monthly = mine.reduce((s, r) => s + r.lease.monthlyRent, 0);
    return {
      id: p.id,
      name: p.name,
      market: p.marketLabel,
      fund: fundLabel(p.fund),
      leases: mine.length,
      status: mine.length ? "Leased" : "Vacant",
      monthly: r2(monthly),
      annual: r2(monthly * 12),
      start: mine.reduce((d, r) => r.lease.start && (!d || r.lease.start < d) ? r.lease.start : d, null),
      end: mine.reduce((d, r) => r.lease.end && (!d || r.lease.end > d) ? r.lease.end : d, null)
    };
  }).sort((a, b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name, void 0, { numeric: true }));
  const comMonthly = comRows.reduce((s, r) => s + r.monthly, 0);
  const commercial = { properties: comRows.length, leased: comRows.filter((r) => r.leases).length, vacant: comRows.filter((r) => !r.leases).length, leases: comRows.reduce((s, r) => s + r.leases, 0), monthly: r2(comMonthly), annual: r2(comMonthly * 12), rows: comRows };
  const { blocking, blockingTotal } = blockingByReason(run, { keep });
  return { pace: pace ? { asOf: pace.asOf, lyAsOf: pace.lyAsOf, shiftDays: pace.shiftDays } : null, kpi, byLeaseType, ties, vacancy, recent, recentSince: today ? addDays(today, -3) : null, str, commercial, blocking, blockingTotal, propertyCount, marketCount: byMarketKeys.length, inScopeLeases: results.length, sameStore: run.sameStore || null };
}
function velocity(runsByAy, { ays, keep = () => true }) {
  const out = { ays: [], proforma: [], executed: [], beds: {} };
  ays.forEach((a, yi) => {
    out.ays.push({ year: a.year, id: a.id || null, label: a.label || `AY ${a.year}-${a.year + 1}`, start: a.start || ayStartDate(a.year), selected: yi === 0 });
    for (const basis of ["proforma", "executed"]) {
      const run = runsByAy[`${a.year}:${basis}`];
      if (!run) continue;
      const start = dayNum(a.start || ayStartDate(a.year));
      for (const r of run.placement.leaseResults.values()) {
        if (r.status !== "placed" || r.year.carried) continue;
        const p = propertyOf(run, r);
        if (!p || !mainSeg(p) || !keep(p)) continue;
        const d = leaseDateFor(r.lease, basis);
        if (!d) continue;
        out[basis].push([yi, dayNum(d) - start, r.coveredBeds, r2(r.lease.monthlyRent), p.fund, p.marketId, r.lease.typeKey]);
      }
    }
  });
  const first = runsByAy[`${ays[0].year}:proforma`] || runsByAy[`${ays[0].year}:executed`];
  if (first) for (const p of first.inventory.propertiesById.values()) {
    if (!mainSeg(p) || !keep(p)) continue;
    const k = `${p.fund}|${p.marketId}`;
    out.beds[k] = (out.beds[k] || 0) + p.beds;
  }
  return out;
}

// src/shared/rules/weekly.js
var ratio3 = (a, b) => b > 0 ? a / b : null;
var growth3 = (cur, prev) => prev > 0 ? cur / prev - 1 : null;
var r22 = (v) => v == null ? null : Number(Number(v).toFixed(2));
var mainSeg2 = (p) => !!p && (SEGMENTS[p.segment] || SEGMENTS.STUDENT).inOccupancy;
var typeLabel2 = (k) => (LEASE_TYPES[k] || {}).label || "Unknown";
var D = (iso) => dayNum(iso);
var F = (n) => n == null ? null : fromDayNum(n);
var mondayOf = (n) => D(weekStart(F(n)));
function weeklyReport({ ay, basis = "proforma", today, weekOf = null, cur, prior = null, keep = () => true, groupBy: groupBy2 = "market", inactivations = [], ayLabels = {} }) {
  const inv = cur.inventory;
  const inScope2 = (p) => !!p && mainSeg2(p) && keep(p);
  const todayN = D(today);
  const curMonday = mondayOf(todayN);
  let week = weekOf ? D(weekOf) : null;
  week = week == null ? curMonday : Math.min(mondayOf(week), curMonday);
  const weekEnd = week + 6, prevEnd = weekEnd - 7;
  const totalBeds = inv.leaves.reduce((s, l) => s + (inScope2(inv.propertiesById.get(l.propertyId)) ? l.beds : 0), 0);
  const offset = daysBetween(ayStartDate(ay - 1), ayStartDate(ay));
  const hasLy = !!prior;
  const lyShift = hasLy ? Math.round(offset / 7) * 7 : null;
  const counted = [...cur.placement.leaseResults.values()].filter((r) => r.status === "placed" && inScope2(propertyOf(cur, r)));
  const dated = [], undated = [];
  for (const r of counted) {
    const d = leaseDateFor(r.lease, basis);
    if (d) dated.push({ d: D(d), r });
    else undated.push(r);
  }
  dated.sort((a, b) => a.d - b.d);
  const finOf = (r) => r.coveredBeds * Math.min(r.year.months, 12) / 12;
  const priorDated = [];
  if (hasLy) for (const r of prior.placement.leaseResults.values()) {
    if (r.status !== "placed" || !inScope2(propertyOf(cur, r))) continue;
    const d = leaseDateFor(r.lease, basis);
    if (d) priorDated.push({ d: D(d) + offset, r });
  }
  priorDated.sort((a, b) => a.d - b.d);
  const firstMonday = dated.length ? mondayOf(dated[0].d) : week;
  const startMonday = Math.max(Math.min(firstMonday, week), week - 155 * 7);
  const history = [];
  let i = 0, j = 0;
  const cum = { leases: 0, beds: 0, fin: 0, mrev: 0, trev: 0 }, pcum = { leases: 0, beds: 0, mrev: 0, trev: 0 };
  const take = (acc, r) => {
    acc.leases++;
    acc.beds += r.coveredBeds;
    if ("fin" in acc) acc.fin += finOf(r);
    acc.mrev += r.lease.monthlyRent;
    acc.trev += r.year.revenue;
  };
  while (i < dated.length && dated[i].d < startMonday) take(cum, dated[i++].r);
  while (j < priorDated.length && priorDated[j].d < startMonday) take(pcum, priorDated[j++].r);
  for (let w = startMonday; w <= week; w += 7) {
    const end = w + 6;
    const add = { leases: 0, beds: 0, mrev: 0, trev: 0 }, ladd = { leases: 0, beds: 0, mrev: 0, trev: 0 };
    while (i < dated.length && dated[i].d <= end) {
      take(add, dated[i].r);
      take(cum, dated[i++].r);
    }
    while (j < priorDated.length && priorDated[j].d <= end) {
      take(ladd, priorDated[j].r);
      take(pcum, priorDated[j++].r);
    }
    history.push({
      week: F(w),
      weekEnd: F(end),
      newLeases: add.leases,
      newBeds: add.beds,
      newMrev: r22(add.mrev),
      newTrev: r22(add.trev),
      leases: cum.leases,
      occ: cum.beds,
      occPct: ratio3(cum.beds, totalBeds),
      fin: r22(cum.fin),
      finPct: ratio3(cum.fin, totalBeds),
      mrev: r22(cum.mrev),
      trev: r22(cum.trev),
      lyOcc: hasLy ? pcum.beds : null,
      lyOccPct: hasLy ? ratio3(pcum.beds, totalBeds) : null,
      lyMrev: hasLy ? r22(pcum.mrev) : null,
      lyTrev: hasLy ? r22(pcum.trev) : null,
      lyLeases: hasLy ? pcum.leases : null,
      lyNewLeases: hasLy ? ladd.leases : null,
      lyNewBeds: hasLy ? ladd.beds : null,
      lyNewTrev: hasLy ? r22(ladd.trev) : null
    });
  }
  history.forEach((h, k) => {
    const p = history[k - 1];
    h.dOcc = p ? h.occ - p.occ : null;
    h.dOccPct = p && h.occPct != null && p.occPct != null ? h.occPct - p.occPct : null;
    h.dMrev = p ? r22(h.mrev - p.mrev) : null;
    h.dTrev = p ? r22(h.trev - p.trev) : null;
    h.vsLyPct = h.lyOccPct != null && h.occPct != null ? h.occPct - h.lyOccPct : null;
  });
  const sel = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : null;
  const ahead = [];
  if (hasLy) {
    const ayStart = D(ayStartDate(ay));
    const stop = Math.min(Math.max(mondayOf(ayStart) + 28, week + 28), week + 70 * 7);
    let beds = pcum.beds, jj = j;
    for (let w = week + 7; w <= stop; w += 7) {
      const end = w + 6;
      while (jj < priorDated.length && priorDated[jj].d <= end) beds += priorDated[jj++].r.coveredBeds;
      ahead.push([F(w), ratio3(beds, totalBeds)]);
    }
  }
  const inWeek = (n) => n != null && n >= week && n <= weekEnd;
  const asOf = Math.min(todayN, weekEnd);
  const ayLeases = [...cur.placement.leaseResults.values()].filter((r) => (r.lease.statusKey === "EXECUTED" || r.lease.statusKey === "IN_PROCESS") && !r.year.carried && inScope2(propertyOf(cur, r)));
  const priorAyLeases = hasLy ? [...prior.placement.leaseResults.values()].filter((r) => (r.lease.statusKey === "EXECUTED" || r.lease.statusKey === "IN_PROCESS") && !r.year.carried && inScope2(propertyOf(cur, r))) : [];
  const lyPriorSigned = priorAyLeases.filter((r) => r.lease.signedDate).length, lyPriorSent = priorAyLeases.filter((r) => r.lease.sentDate).length;
  const lySentThin = hasLy && lyPriorSent < 0.5 * lyPriorSigned;
  const sentCoverage = { sent: lyPriorSent, signed: lyPriorSigned, thin: lySentThin };
  const lyOf = (r) => {
    if (!hasLy || r.status !== "placed") return null;
    let beds = 0, mrev = 0, hit = 0;
    for (const leaf of r.scope.leaves) {
      const pl = prior.placement.leafResults.get(leaf.key);
      if (pl && pl.occupied) {
        beds += leaf.beds;
        mrev += pl.monthly;
        hit++;
      }
    }
    return hit ? { beds, mrev: r22(mrev), rentBed: beds > 0 ? r22(mrev / beds) : null, partial: hit < r.scope.leaves.length } : null;
  };
  const leaseRow = (r) => {
    const p = propertyOf(cur, r), beds = r.status === "placed" ? r.coveredBeds : null, mrev = r.lease.monthlyRent, ly = lyOf(r), rentBed = beds > 0 ? r22(mrev / beds) : null;
    return {
      id: r.lease.id,
      name: r.lease.name,
      fund: p ? fundLabel(p.fund) : "",
      market: p ? p.marketLabel : "",
      marketId: p ? p.marketId : null,
      property: p ? p.name : "",
      propertyId: p ? p.id : null,
      linked: linkedName(cur, r),
      type: typeLabel2(r.lease.typeKey),
      status: r.lease.statusKey,
      beds,
      people: r.lease.tenantCount,
      mrev,
      trev: r.status === "placed" ? r22(r.year.revenue) : null,
      rentBed,
      lyBeds: ly ? ly.beds : null,
      lyMrev: ly ? ly.mrev : null,
      lyRentBed: ly ? ly.rentBed : null,
      lyPartial: ly ? !!ly.partial : false,
      rentBedPct: ly && ly.rentBed > 0 && rentBed != null ? rentBed / ly.rentBed - 1 : null,
      sent: r.lease.sentDate,
      signed: r.lease.signedDate,
      note: r.status === "excluded" ? `Excluded: ${r.code}` : r.status === "skipped" ? "Not on this basis" : ""
    };
  };
  const rollup2 = (list) => {
    const t = { leases: list.length, beds: 0, mrev: 0, trev: 0, lyLeases: 0, lyBeds: 0, lyMrev: 0 };
    for (const r of list) {
      t.beds += r.beds || 0;
      t.mrev += r.mrev || 0;
      t.trev += r.trev || 0;
      if (r.lyRentBed != null) {
        t.lyLeases++;
        t.lyBeds += r.lyBeds || 0;
        t.lyMrev += r.lyMrev || 0;
      }
    }
    t.mrev = r22(t.mrev);
    t.trev = r22(t.trev);
    t.lyMrev = r22(t.lyMrev);
    t.rentBed = t.beds > 0 ? r22(t.mrev / t.beds) : null;
    t.lyRentBed = t.lyBeds > 0 ? r22(t.lyMrev / t.lyBeds) : null;
    t.rentBedPct = t.lyRentBed > 0 && t.rentBed != null ? t.rentBed / t.lyRentBed - 1 : null;
    t.bedsPct = t.lyBeds > 0 ? t.beds / t.lyBeds - 1 : null;
    return t;
  };
  const openAt = (r, end, shift) => {
    const sent = D(r.lease.sentDate), signed = D(r.lease.signedDate);
    if (sent == null || sent + shift > end) return false;
    return signed == null ? r.lease.statusKey === "IN_PROCESS" : signed + shift > end;
  };
  const inProcess = [];
  for (const r of ayLeases) {
    const noSent = r.lease.sentDate == null && r.lease.statusKey === "IN_PROCESS" && week === curMonday;
    if (!openAt(r, weekEnd, 0) && !noSent) continue;
    const row = leaseRow(r);
    const sent = D(r.lease.sentDate);
    row.days = sent == null ? null : asOf - sent;
    if (noSent) row.note = "No Lease Sent Date";
    inProcess.push(row);
  }
  inProcess.sort((a, b) => (b.days == null ? -1 : b.days) - (a.days == null ? -1 : a.days));
  const pipeline = {
    now: inProcess.filter((r) => r.days != null).length,
    noSent: inProcess.filter((r) => r.days == null).length,
    over21: inProcess.filter((r) => r.days != null && r.days > 21).length,
    prev: ayLeases.filter((r) => openAt(r, prevEnd, 0)).length,
    ly: hasLy ? priorAyLeases.filter((r) => openAt(r, weekEnd, lyShift)).length : null,
    lyThin: lySentThin
  };
  const byProp = (a, b) => String(a.property).localeCompare(String(b.property), void 0, { numeric: true });
  const executed = ayLeases.filter((r) => r.lease.statusKey === "EXECUTED" && inWeek(D(r.lease.signedDate))).map(leaseRow).sort((a, b) => String(a.signed).localeCompare(String(b.signed)) || byProp(a, b));
  const sentThisWeek = ayLeases.filter((r) => inWeek(D(r.lease.sentDate))).map(leaseRow).sort((a, b) => String(a.sent).localeCompare(String(b.sent)) || byProp(a, b));
  const priorWeek = (dateOf) => {
    if (!hasLy) return null;
    const t = { leases: 0, beds: 0, mrev: 0, trev: 0 };
    for (const r of priorAyLeases) {
      const d = D(dateOf(r.lease));
      if (d == null || d + lyShift < week || d + lyShift > weekEnd) continue;
      t.leases++;
      t.beds += r.status === "placed" ? r.coveredBeds : 0;
      t.mrev += r.lease.monthlyRent;
      t.trev += r.status === "placed" ? r.year.revenue : 0;
    }
    t.mrev = r22(t.mrev);
    t.trev = r22(t.trev);
    t.rentBed = t.beds > 0 ? r22(t.mrev / t.beds) : null;
    return t;
  };
  const priorOpen = () => {
    if (!hasLy) return null;
    const t = { leases: 0, beds: 0, mrev: 0, trev: 0 };
    for (const r of priorAyLeases) {
      if (!openAt(r, weekEnd, lyShift)) continue;
      t.leases++;
      t.beds += r.status === "placed" ? r.coveredBeds : 0;
      t.mrev += r.lease.monthlyRent;
      t.trev += r.status === "placed" ? r.year.revenue : 0;
    }
    t.mrev = r22(t.mrev);
    t.trev = r22(t.trev);
    t.rentBed = t.beds > 0 ? r22(t.mrev / t.beds) : null;
    return t;
  };
  const sectionYoY = (list, dateOf, lyRows) => {
    const ty = rollup2(list), ly = lyRows ? lyRows() : priorWeek(dateOf);
    return {
      ty,
      ly,
      dLeases: ly ? ty.leases - ly.leases : null,
      dBeds: ly ? ty.beds - ly.beds : null,
      leasesPct: ly && ly.leases > 0 ? ty.leases / ly.leases - 1 : null,
      bedsPct: ly && ly.beds > 0 ? ty.beds / ly.beds - 1 : null,
      rentBedPct: ly && ly.rentBed > 0 && ty.rentBed != null ? ty.rentBed / ly.rentBed - 1 : null,
      dRentBed: ly && ly.rentBed != null && ty.rentBed != null ? r22(ty.rentBed - ly.rentBed) : null,
      trevPct: ly && ly.trev > 0 ? ty.trev / ly.trev - 1 : null
    };
  };
  const groupKey = groupBy2 === "fund" ? (p) => fundLabel(p.fund) : (p) => p.marketLabel;
  const groupId = groupBy2 === "fund" ? (p) => p.fund : (p) => p.marketId;
  const groups = /* @__PURE__ */ new Map();
  const grp = (p) => {
    const k = groupKey(p);
    if (!groups.has(k)) groups.set(k, { name: k, id: groupId(p), beds: 0, occ: 0, prevOcc: 0, lyOcc: 0, newBeds: 0, newLeases: 0, lyNewBeds: 0, trev: 0, lyTrev: 0, inProcess: 0 });
    return groups.get(k);
  };
  for (const p of inv.propertiesById.values()) if (inScope2(p)) grp(p).beds += p.beds;
  for (const { d, r } of dated) {
    if (d > weekEnd) continue;
    const g = grp(propertyOf(cur, r));
    g.occ += r.coveredBeds;
    g.trev += r.year.revenue;
    if (d <= prevEnd) g.prevOcc += r.coveredBeds;
    if (d >= week) {
      g.newBeds += r.coveredBeds;
      g.newLeases++;
    }
  }
  for (const { d, r } of priorDated) {
    if (d > weekEnd) continue;
    const g = grp(propertyOf(cur, r));
    g.lyOcc += r.coveredBeds;
    g.lyTrev += r.year.revenue;
    if (d >= week) g.lyNewBeds += r.coveredBeds;
  }
  for (const r of ayLeases) if (openAt(r, weekEnd, 0)) grp(propertyOf(cur, r)).inProcess++;
  const byGroup = [...groups.values()].filter((g) => g.beds > 0 || g.occ > 0).map((g) => ({
    ...g,
    trev: r22(g.trev),
    lyTrev: hasLy ? r22(g.lyTrev) : null,
    occPct: ratio3(g.occ, g.beds),
    prevOccPct: ratio3(g.prevOcc, g.beds),
    lyOccPct: hasLy ? ratio3(g.lyOcc, g.beds) : null,
    lyOcc: hasLy ? g.lyOcc : null,
    lyNewBeds: hasLy ? g.lyNewBeds : null,
    dOccPct: g.beds > 0 ? (g.occ - g.prevOcc) / g.beds : null,
    vsLyPct: hasLy && g.beds > 0 ? (g.occ - g.lyOcc) / g.beds : null,
    trevPace: hasLy ? growth3(g.trev, g.lyTrev) : null
  })).sort((a, b) => a.name.localeCompare(b.name));
  const inactivated = (inactivations || []).filter((e) => inWeek(D(String(e.changed || "").slice(0, 10)))).map((e) => {
    const p = inv.propertiesById.get(String(e.property_id));
    if (!p || !keep(p)) return null;
    const linked = e.unit_name || "";
    const beds = e.beds != null ? Number(e.beds) : null;
    return { id: String(e.id), name: e.name, ay: ayLabels[String(e.ay)] || "", market: p.marketLabel, property: p.name, propertyId: p.id, linked, beds, mrev: Number(e.monthly_rent) || 0, changed: e.changed, changedBy: e.changed_by || "", stillInactive: e.inactive_now !== "F" };
  }).filter(Boolean).sort((a, b) => String(b.changed).localeCompare(String(a.changed)));
  const firstSeen = [];
  for (const r of ayLeases) for (const s of [r.lease.signedDate, r.lease.sentDate]) {
    const d = D(s);
    if (d != null) firstSeen.push(d);
  }
  const earliest = firstSeen.length ? Math.max(mondayOf(Math.min(...firstSeen)), curMonday - 155 * 7) : curMonday - 25 * 7;
  const weekOptions = [];
  for (let w = curMonday; w >= earliest; w -= 7) weekOptions.push({ value: F(w), label: `${F(w)} – ${F(w + 6)}` });
  const cmpAsOf = Math.min(todayN, weekEnd);
  const monthStartN = D(F(cmpAsOf).slice(0, 8) + "01");
  const priorRaw = hasLy ? priorDated.map((x) => ({ d: x.d - offset, r: x.r })) : [];
  const span = (rows, from, to) => {
    const o = { beds: 0, leases: 0, trev: 0, mrev: 0 };
    for (const x of rows) if ((from == null || x.d >= from) && x.d <= to) {
      o.beds += x.r.coveredBeds;
      o.leases++;
      o.trev += x.r.year.revenue;
      o.mrev += x.r.lease.monthlyRent;
    }
    o.trev = r22(o.trev);
    o.mrev = r22(o.mrev);
    o.occPct = ratio3(o.beds, totalBeds);
    return o;
  };
  const pair = (label, from, to, cumulative) => {
    const ty = span(dated, from, to), ly = hasLy ? span(priorRaw, from == null ? null : from - lyShift, to - lyShift) : null;
    return {
      label,
      from: from == null ? null : F(from),
      to: F(to),
      lyFrom: hasLy && from != null ? F(from - lyShift) : null,
      lyTo: hasLy ? F(to - lyShift) : null,
      cumulative: !!cumulative,
      ty,
      ly,
      d: ly ? { beds: ty.beds - ly.beds, leases: ty.leases - ly.leases, trev: r22(ty.trev - ly.trev), occPts: ty.occPct != null && ly.occPct != null ? ty.occPct - ly.occPct : null } : null,
      pct: ly ? { beds: growth3(ty.beds, ly.beds), leases: growth3(ty.leases, ly.leases), trev: growth3(ty.trev, ly.trev) } : null
    };
  };
  const cmp = {
    hasLy,
    lyShiftDays: hasLy ? lyShift : null,
    asOf: F(cmpAsOf),
    undatedBeds: undated.reduce((a, r) => a + r.coveredBeds, 0),
    undatedLeases: undated.length,
    countedBeds: cum.beds,
    partial: week === curMonday && cmpAsOf < weekEnd,
    week: pair("This week to date", week, cmpAsOf, false),
    month: pair("This month to date", monthStartN, cmpAsOf, false),
    year: pair("This academic year to date", null, cmpAsOf, true)
  };
  const pwMonthStart = D(F(prevEnd).slice(0, 8) + "01");
  cmp.pw = { week: pair("Prior week", week - 7, prevEnd, false), month: pair("Month to prior week end", pwMonthStart, prevEnd, false), year: pair("Academic year to prior week end", null, prevEnd, true) };
  return {
    ay,
    basis,
    today,
    week: F(week),
    weekEnd: F(weekEnd),
    isCurrent: week === curMonday,
    weekOptions,
    totalBeds,
    history,
    sel,
    prev,
    hasPrior: hasLy,
    shiftDays: lyShift,
    offsetDays: offset,
    groupBy: groupBy2 === "fund" ? "fund" : "market",
    byGroup,
    pipeline,
    lyWeek: hasLy ? F(week - offset) : null,
    lyWeekEnd: hasLy ? F(weekEnd - offset) : null,
    cmp,
    chart: { pts: history.slice(-60).map((h) => [h.week, h.occPct, h.lyOccPct]), ahead, ayStart: ayStartDate(ay) },
    undated: { leases: undated.length, beds: undated.reduce((s, r) => s + r.coveredBeds, 0), mrev: r22(undated.reduce((s, r) => s + r.lease.monthlyRent, 0)) },
    inProcess,
    executed,
    sentThisWeek,
    inactivated,
    sentYoY: { ...sectionYoY(sentThisWeek, (l) => l.sentDate), sentBased: true, coverage: sentCoverage, volumeThin: lySentThin },
    execYoY: sectionYoY(executed, (l) => l.signedDate),
    inProcessYoY: { ...sectionYoY(inProcess, null, priorOpen), sentBased: true, coverage: sentCoverage, volumeThin: lySentThin }
  };
}

// src/shared/rules/index.js
function ayLookup(academicYears = []) {
  const m = {};
  for (const a of academicYears) {
    const y = ayYearFromLabel(a.name);
    if (y != null && a.isinactive !== "T") m[String(a.id)] = y;
  }
  return m;
}
function lookupsFromLists(lists = {}) {
  const out = { leaseTypeIds: {}, leaseStatusIds: {}, stageIds: {}, unmatched: [] };
  for (const v of lists.customlist_serp_lease_type_list || []) {
    const k = leaseTypeKey(v.name, null);
    if (k) out.leaseTypeIds[String(v.id)] = k;
    else out.unmatched.push({ list: "lease_type", ...v });
  }
  for (const v of lists.customlist_serp_lease_status || []) {
    const k = leaseStatusKey(v.name, null);
    if (k && k !== "OTHER") out.leaseStatusIds[String(v.id)] = k;
    else out.unmatched.push({ list: "lease_status", ...v });
  }
  for (const v of lists.customlist_ad_leasing_stage || []) {
    const k = foldStage(v.name, {});
    if (k) out.stageIds[String(v.id)] = k;
    else out.unmatched.push({ list: "leasing_stage", ...v });
  }
  return out;
}
var num3 = (v) => v == null || v === "" ? null : Number(v);
function normalizeTargets(targets = [], ayYears = {}) {
  return targets.filter((t) => t.isinactive !== "T").map((t) => ({
    id: String(t.id),
    unitId: t.unit == null ? null : String(t.unit),
    propertyId: t.property == null ? null : String(t.property),
    ay: ayYears[String(t.ay)] ?? null,
    beds: num3(t.beds),
    targetPerBed: num3(t.target_per_bed),
    targetMonthly: num3(t.target_monthly),
    settlePerBed: num3(t.settle_per_bed),
    settleMonthly: num3(t.settle_monthly),
    prevYearPerBed: num3(t.prev_year_per_bed),
    nextAvailable: t.next_available || null
  }));
}
function prepare(fixture, opts = {}) {
  const ayYears = ayLookup(fixture.academic_years);
  if (!opts.leaseTypeIds && fixture.lists) opts = { ...opts, ...lookupsFromLists(fixture.lists) };
  const inventory = buildInventory({ properties: fixture.properties, units: fixture.units }, opts);
  const leases = (fixture.leases || []).map((raw) => normalizeLease(raw, { ayYears, leaseTypeIds: opts.leaseTypeIds, leaseStatusIds: opts.leaseStatusIds }));
  const targets = normalizeTargets(fixture.targets, ayYears);
  return { inventory, leases, targets, ayYears };
}
function runEngine(fixture, { ay, basis = DEFAULT_BASIS, flags = FEATURE_FLAGS, prepared = null, withPrior = true } = {}) {
  const prep = prepared || prepare(fixture);
  const place = (year) => {
    const placement = placeLeases({ inventory: prep.inventory, leases: prep.leases, ay: year, basis, flags });
    const targetIssues = applyTargets(prep.inventory, placement.leafResults, prep.targets, year);
    return { placement, targetIssues };
  };
  const priorP = withPrior ? place(ay - 1) : null;
  const curP = place(ay);
  const sameStore = markSameStore(prep.inventory, curP.placement, priorP ? priorP.placement : null);
  const cur = rollup(prep.inventory, curP.placement, priorP ? priorP.placement : null);
  const prior = priorP ? rollup(prep.inventory, priorP.placement, null) : null;
  const comparison = prior ? {
    total: compareMetrics(cur.summary.student, prior.summary.student),
    byMarket: cur.summary.byMarketTotal.map((m) => ({ marketId: m.marketId, delta: compareMetrics(m.metrics, (prior.summary.byMarketTotal.find((x) => x.marketId === m.marketId) || {}).metrics) }))
  } : null;
  return {
    ay,
    basis,
    flags,
    inventory: prep.inventory,
    leases: prep.leases,
    targets: prep.targets,
    ayYears: prep.ayYears,
    placement: curP.placement,
    targetIssues: curP.targetIssues,
    tree: cur.tree,
    summary: cur.summary,
    exceptions: curP.placement.exceptions,
    tenantDoubles: curP.placement.tenantDoubles,
    sameStore,
    prior: prior ? { ay: ay - 1, summary: prior.summary, tree: prior.tree, placement: priorP.placement } : null,
    comparison
  };
}

// src/server/scoping.js
function inScope(scope, marketId) {
  return scope.all || scope.markets.has(marketId);
}
function keepFor(scope, { fund = null, marketId = null } = {}) {
  return (p) => !!p && inScope(scope, p.marketId) && (!fund || p.fund === fund) && (!marketId || p.marketId === marketId);
}
function scopedSummary(result, scope, { fund = null, marketId = null } = {}) {
  const rows = result.summary.byMarket.filter((r) => inScope(scope, r.marketId) && (!fund || r.fund === fund) && (!marketId || r.marketId === marketId));
  const sum = (key) => finish(rows.reduce((m, r) => addMetrics(m, r[key]), emptyMetrics()));
  const byMarket = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!byMarket.has(r.marketId)) byMarket.set(r.marketId, { marketId: r.marketId, market: r.market, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() });
    const t = byMarket.get(r.marketId);
    addMetrics(t.metrics, r.metrics);
    addMetrics(t.str, r.str);
    addMetrics(t.commercial, r.commercial);
  }
  const byFund = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!byFund.has(r.fund)) byFund.set(r.fund, { fund: r.fund, metrics: emptyMetrics(), str: emptyMetrics(), commercial: emptyMetrics() });
    const t = byFund.get(r.fund);
    addMetrics(t.metrics, r.metrics);
    addMetrics(t.str, r.str);
    addMetrics(t.commercial, r.commercial);
  }
  const fin = (t) => ({ ...t, metrics: round(finish(t.metrics)), str: round(finish(t.str)), commercial: round(finish(t.commercial)) });
  return { student: round(sum("metrics")), str: round(sum("str")), commercial: round(sum("commercial")), byMarket: [...byMarket.values()].map(fin), byFund: [...byFund.values()].map(fin) };
}
function scopedTree(result, scope, { fund = null, marketId = null } = {}) {
  const out = [];
  const visit = (n, parentKey, depth) => {
    if (n.kind === "property" && n.isParent && !n.metrics.beds && !n.metrics.activeLeases && !n.metrics.excludedLeases) return;
    const row = { key: n.key, parent: parentKey, depth, kind: n.kind, id: n.id, name: n.name, metrics: compact(n.metrics), childCount: n.children.length };
    if (n.segment && n.segment !== "STUDENT") row.segment = n.segment;
    if (n.leaf) row.leaf = compactLeaf(n.leaf);
    if ((n.kind === "fund" || n.kind === "market") && (n.str.beds || n.commercial.monthly)) {
      row.str = compact(n.str);
      row.commercial = compact(n.commercial);
    }
    out.push(row);
    for (const c of n.children) visit(c, n.key, depth + 1);
  };
  for (const f of result.tree) {
    if (fund && f.id !== fund) continue;
    const markets = f.children.filter((m) => inScope(scope, m.id) && (!marketId || m.id === marketId));
    if (!markets.length) continue;
    visit({ ...f, children: markets }, null, 0);
  }
  return out;
}
var KEEP_ZERO = /* @__PURE__ */ new Set(["beds", "occupied", "vacant"]);
var KEYS = [
  "beds",
  "occupied",
  "vacant",
  "occPct",
  "finOccPct",
  "monthly",
  "annual",
  "rentPerBed",
  "rentPerPerson",
  "people",
  "activeLeases",
  "excludedLeases",
  "pOccupied",
  "pOccPct",
  "occDelta",
  "pMonthly",
  "mrevYoY",
  "pRentBed",
  "ssBeds",
  "ssCur",
  "ssPrior",
  "ssYoY",
  "targetMonthly",
  "targetPerBed",
  "actVsTarget",
  "targetVacant",
  "settleMonthly",
  "prevRentPerBed"
];
function compact(m) {
  const r = round(m);
  const out = {};
  for (const k of KEYS) if (r[k] != null && !(r[k] === 0 && !KEEP_ZERO.has(k))) out[k] = r[k];
  if (r.byType) {
    if (r.byType.WH) out.occWH = r.byType.WH;
    if (r.byType.UNIT) out.occUnit = r.byType.UNIT;
    if (r.byType.BED) out.occBed = r.byType.BED;
  }
  return out;
}
function compactLeaf(l) {
  const out = { type: l.typeLabel, leases: l.leases };
  if (l.start) out.start = l.start;
  if (l.end) out.end = l.end;
  if (l.months) out.months = l.months;
  if (l.sequential) out.sequential = true;
  if (l.carriedOnly) out.carried = true;
  if (l.sameStore) out.ss = true;
  else if (l.ssWhy) out.ssWhy = l.ssWhy;
  if (l.prior && l.prior.occupied) out.prior = { monthly: Number(l.prior.monthly.toFixed(2)), leases: l.prior.leases };
  return out;
}
function propertyIdsInScope(inventory, scope) {
  const ids2 = [];
  for (const p of inventory.propertiesById.values()) if (inScope(scope, p.marketId)) ids2.push(p.id);
  return ids2;
}

// src/server/routes/bootstrap.js
function routeBootstrap(ctx) {
  ctx.probeAll();
  const lookups = lookupsFromLists(ctx.dao.portfolio.lists());
  return {
    session: { userId: ctx.scope.userId, name: ctx.scope.name, isAdmin: ctx.scope.isAdmin, today: ctx.today },
    scope: { all: ctx.scope.all, marketIds: ctx.scope.marketIds, reason: ctx.scope.reason, warnings: ctx.scope.warnings },
    academicYears: ctx.ays(),
    currentAy: ctx.currentAy(),
    defaultAy: ctx.currentAy() + 1,
    markets: MARKETS.filter((m) => ctx.inScope(m.id)).map((m) => m.id),
    funds: FUND_ORDER,
    ids: { stage: lookups.stageIds, leaseType: lookups.leaseTypeIds, leaseStatus: lookups.leaseStatusIds, unmatched: lookups.unmatched },
    flags: ctx.flags,
    degraded: ctx.schema.degraded
  };
}
function routeLists(ctx) {
  const lists = ctx.dao.portfolio.lists();
  const live = (k) => (lists[k] || []).filter((x) => x.isinactive !== "T").map((x) => ({ id: String(x.id), name: x.name }));
  const inv = ctx.load().prepared.inventory;
  const properties = [...inv.propertiesById.values()].filter((p) => ctx.inScope(p.marketId)).map((p) => ({ id: p.id, name: p.name, market: p.marketId, units: p.units.map((id) => {
    const u = inv.unitsById.get(id);
    return { id: u.id, name: u.name, beds: u.beds, bedrooms: u.bedrooms.map((b) => ({ id: b.id, name: b.name })) };
  }) })).sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
  return { markets: MARKETS.filter((m) => ctx.inScope(m.id)).map((m) => ({ id: m.id, label: m.label, calendar: m.calendar })), properties, schools: live("customlist_serp_schools"), hearUs: live("customlist_serp_hear_us_list"), cities: live("customlist_serp_cities"), stageList: (lists.customlist_ad_leasing_stage || []).map((x) => ({ id: String(x.id), name: x.name, inactive: x.isinactive === "T" })), tenantStatuses: ctx.dao.people.statusList().filter((s) => s.entitytype === "CUSTOMER") };
}

// src/server/routes/reporting.js
function routeSummary(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const run = ctx.run(ay, basis);
  const cur = ctx.scopedSummary(run, sel);
  const prior = run.prior ? ctx.scopedSummary({ summary: run.prior.summary }, sel) : null;
  const extras = summaryExtras(run, { keep: ctx.keep(sel), today: ctx.today, basis });
  return {
    ay,
    basis,
    selection: sel,
    today: ctx.today,
    currentAy: ctx.currentAy(),
    headline: { beds: cur.student.beds, occupied: cur.student.occupied, occPct: cur.student.occPct, preleasePct: ay > ctx.currentAy() ? cur.student.occPct : null, monthly: cur.student.monthly },
    student: cur.student,
    str: cur.str,
    commercial: cur.commercial,
    byFund: cur.byFund,
    byMarket: cur.byMarket,
    prior: prior ? { student: prior.student, byMarket: prior.byMarket } : null,
    deltas: { total: compareMetrics(cur.student, prior ? prior.student : null), byMarket: cur.byMarket.map((m) => ({ marketId: m.marketId, delta: compareMetrics(m.metrics, prior ? (prior.byMarket.find((x) => x.marketId === m.marketId) || {}).metrics : null) })) },
    ...extras,
    degraded: ctx.schema.degraded
  };
}
function routePortfolio(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const run = ctx.run(ay, basis);
  const extras = summaryExtras(run, { keep: ctx.keep(sel), today: ctx.today, basis });
  return { ay, basis, priorAy: run.prior ? run.prior.ay : null, nodes: ctx.scopedTree(run, sel), vacancy: extras.vacancy, total: extras.kpi.total, propertyCount: extras.propertyCount, sameStore: extras.sameStore, degraded: ctx.schema.degraded };
}
function routeWeekly(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), sel = ctx.selection();
  const run = ctx.run(ay, basis);
  const inact = ctx.dao.portfolio.inactivations();
  const ayLabels = Object.fromEntries(ctx.ays().map((a) => [a.id, a.label]));
  const report = weeklyReport({ ay, basis, today: ctx.today, weekOf: toISO(ctx.params.week) || null, cur: run, prior: run.prior, keep: ctx.keep(sel), groupBy: ctx.params.groupBy === "fund" || sel.marketId && ctx.params.groupBy !== "market" ? "fund" : "market", inactivations: inact.rows, ayLabels });
  return { ay, basis, selection: sel, priorAy: run.prior ? run.prior.ay : null, ayEnd: ayEndDate(ay), inactivationsAvailable: inact.available, ...report, degraded: ctx.schema.degraded };
}
function routeVelocity(ctx) {
  const ay = ctx.selectedAy(), sel = ctx.selection();
  const known = ctx.ays();
  const ays = [ay, ay - 1, ay - 2, ay - 3].map((y) => known.find((a) => a.year === y)).filter(Boolean);
  const runs = {};
  for (const a of ays) for (const basis of ["proforma", "executed"]) runs[`${a.year}:${basis}`] = ctx.run(a.year, basis, false);
  return { ay, selection: sel, ...velocity(runs, { ays, keep: ctx.keep(sel) }) };
}

// src/shared/rules/views.js
var PIPELINE_SORTS = ["property", "unit", "beds", "propertyBeds", "stage", "daysInStage", "tours", "target", "lastOffer", "followup", "available", "monthlyRent", "needsAction", "signed", "market"];
var UNIT_BEDS = [["1", (b) => b === 1], ["2", (b) => b === 2], ["3", (b) => b === 3], ["4", (b) => b === 4], ["5", (b) => b === 5], ["6+", (b) => b >= 6]];
var HOUSE_BEDS = [["1-4", (b) => b >= 1 && b <= 4], ["5-8", (b) => b >= 5 && b <= 8], ["9-12", (b) => b >= 9 && b <= 12], ["13+", (b) => b >= 13]];
function applyPipelineView(rows, q = {}) {
  let out = rows;
  if (q.fund) out = out.filter((r) => r.fund === q.fund);
  if (q.market) out = out.filter((r) => r.market === q.market);
  if (q.stage) {
    const set = new Set(String(q.stage).split(",").filter(Boolean));
    if (set.size) out = out.filter((r) => set.has(r.stage));
  }
  if (q.availability === "free") out = out.filter((r) => r.free > 0);
  else if (q.availability === "full") out = out.filter((r) => r.free === 0);
  if (q.unitBeds) {
    const f = (UNIT_BEDS.find((x) => x[0] === String(q.unitBeds)) || [])[1];
    if (f) out = out.filter((r) => f(r.beds));
  }
  if (q.houseBeds) {
    const f = (HOUSE_BEDS.find((x) => x[0] === String(q.houseBeds)) || [])[1];
    if (f) out = out.filter((r) => f(r.propertyBeds || 0));
  }
  if (q.tours === "none") out = out.filter((r) => r.tours === 0);
  else if (q.tours === "some") out = out.filter((r) => r.tours > 0);
  if (q.needsAction === "1" || q.needsAction === true) out = out.filter((r) => r.needsAction);
  if (q.breach === "1" || q.breach === true) out = out.filter((r) => r.breach);
  if (q.mentions) {
    const me = String(q.mentions);
    out = out.filter((r) => (r.mentions || []).includes(me));
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    out = out.filter((r) => `${r.property} ${r.unit} ${r.expectedTenants || ""} ${r.notes || ""} ${r.rrUnitId || ""} ${(r.leases || []).map((l) => l.name).join(" ")} ${r.priorTenants || ""}`.toLowerCase().includes(needle));
  }
  const sort = PIPELINE_SORTS.includes(q.sort) ? q.sort : "property";
  const dir = q.dir === "desc" ? -1 : 1;
  const val = (r) => ({ property: r.property, unit: r.unit, beds: r.beds, propertyBeds: r.propertyBeds || 0, stage: r.stage, daysInStage: r.daysInStage ?? -1, tours: r.tours, target: r.targetMonthly ?? -1, lastOffer: r.lastOffer ?? -1, followup: r.followup || "", available: r.free, monthlyRent: r.monthlyRent ?? -1, needsAction: r.needsAction ? 1 : 0, signed: r.signed || "", market: r.market })[sort];
  out = out.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), void 0, { numeric: true });
    return c * dir || a.property.localeCompare(b.property, void 0, { numeric: true }) || a.unit.localeCompare(b.unit, void 0, { numeric: true });
  });
  const total = out.length, totalBeds = out.reduce((s, r) => s + r.beds, 0);
  const pageSize = Math.min(500, Math.max(25, Number(q.pageSize) || 100)), page = Math.max(0, Number(q.page) || 0);
  const stageCounts = {}, stageBeds = {};
  let breachCount = 0, needsActionCount = 0, noStatus = 0;
  for (const r of out) {
    stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1;
    stageBeds[r.stage] = (stageBeds[r.stage] || 0) + r.beds;
    if (r.breach) breachCount++;
    if (r.needsAction) needsActionCount++;
    if (r.draftLease) noStatus++;
  }
  return { total, totalBeds, page, pageSize, rows: out.slice(page * pageSize, (page + 1) * pageSize), stageCounts, stageBeds, breachCount, needsActionCount, noStatus };
}

// src/server/routes/pipeline.js
var typeLabel3 = (k) => (LEASE_TYPES[k] || {}).label || "Unknown";
function parseMentions(v) {
  return v == null || v === "" ? [] : String(v).split(/[,\s]+/).filter(Boolean);
}
function buildPipelineRows(ctx, ay, basis) {
  const r = ctx.run(ay, basis);
  const inv = r.inventory;
  const ayId = ctx.ayIdFor(ay);
  const { rows: stageRows, missing } = ctx.dao.pipeline.stageRows(ayId ? [ayId] : []);
  const stageByUnit = /* @__PURE__ */ new Map();
  for (const s of stageRows) stageByUnit.set(String(s.unit), s);
  const targetByUnit = /* @__PURE__ */ new Map(), nextTargetByUnit = /* @__PURE__ */ new Map();
  for (const t of r.targets) {
    if (!t.unitId) continue;
    if (t.ay === ay) targetByUnit.set(t.unitId, t);
    else if (t.ay === ay + 1) nextTargetByUnit.set(t.unitId, t);
  }
  const notesByRow = /* @__PURE__ */ new Map();
  for (const n of ctx.dao.pipeline.notesForAy(ayId)) {
    const k = String(n.status_row);
    if (!notesByRow.has(k)) notesByRow.set(k, []);
    notesByRow.get(k).push({ id: String(n.id), date: toISO(n.note_date) || toISO(n.created), author: n.author_name || String(n.author || ""), text: n.text || "", mentions: parseMentions(n.mentions) });
  }
  const lookups = ctx.load().lookups;
  const out = [];
  const segment = ctx.params.segment === "str" ? "STR" : "STUDENT";
  const prior = r.prior ? r.prior.placement : null;
  for (const u of inv.unitNodes) {
    const p = inv.propertiesById.get(u.propertyId);
    if (!p || !ctx.inScope(p.marketId)) continue;
    if (p.segment === "COMMERCIAL") continue;
    if (p.segment === "STR" !== (segment === "STR")) continue;
    const leaves = u.leaves.map((l) => r.placement.leafResults.get(l.key));
    const taken = leaves.filter((l) => l.occupied).reduce((s2, l) => s2 + l.leaf.beds, 0);
    const leaseIds = [...new Set(leaves.flatMap((l) => l.placements.map((pl) => pl.leaseId)))];
    const leases = leaseIds.map((id) => r.placement.leaseResults.get(id)).filter(Boolean);
    const governing = leases.find((l) => l.lease.statusKey === "EXECUTED") || leases.find((l) => l.lease.statusKey === "IN_PROCESS") || leases[0] || null;
    const draft = !leases.length ? [...r.placement.leaseResults.values()].find((x) => x.code === "NO_STATUS" && !x.year.carried && (x.scope.unitId === u.id || u.propertyOnly && x.scope.propertyId === p.id && !x.scope.unitId)) || null : null;
    const s = stageByUnit.get(u.id) || null;
    const stageKey = s ? effectiveStage({ stage: s.stage_name || lookups.stageIds[String(s.stage)] || s.stage, manualStage: lookups.stageIds[String(s.manual_stage)] || s.manual_stage, stageSource: String(s.stage_source) === "2" || s.stage_source_name === "Lease" ? "lease" : "manual" }) : governing ? governing.lease.statusKey === "EXECUTED" ? "FULLY_EXECUTED" : "LEASE_OUT" : draft ? "READY_FOR_LEASE" : "NONE";
    const stageSource = s ? String(s.stage_source) === "2" ? "lease" : "manual" : governing ? "lease" : null;
    const stageDate = s ? toISO(s.stage_date) : governing ? governing.lease.statusKey === "EXECUTED" ? governing.lease.signedDate : governing.lease.sentDate : null;
    const t = targetByUnit.get(u.id) || null, nt = nextTargetByUnit.get(u.id) || null;
    const targetMonthly = t ? t.targetMonthly ?? (t.targetPerBed != null ? t.targetPerBed * u.beds : null) : null;
    const settleMonthly = t ? t.settleMonthly ?? (t.settlePerBed != null ? t.settlePerBed * u.beds : null) : null;
    const nextTargetMonthly = nt ? nt.targetMonthly ?? (nt.targetPerBed != null ? nt.targetPerBed * u.beds : null) : null;
    const monthlyRent = governing ? governing.lease.monthlyRent : null;
    let priorRent = null, priorOcc = 0, priorTenantIds = [];
    if (prior) {
      for (const l of u.leaves) {
        const pl = prior.leafResults.get(l.key);
        if (pl && pl.occupied) {
          priorRent = (priorRent || 0) + pl.monthly;
          priorOcc += l.beds;
          for (const pid of pl.placements.map((x) => x.leaseId)) {
            const lr = prior.leaseResults.get(pid);
            if (lr) priorTenantIds.push(...lr.lease.tenantIds);
          }
        }
      }
    }
    priorTenantIds = [...new Set(priorTenantIds)];
    const notes = s ? notesByRow.get(String(s.id)) || [] : [];
    const followup = s ? toISO(s.followup) : null;
    const editable = !!u.id && !u.propertyOnly && stageSource !== "lease";
    const twoYear = governing && governing.lease.isTwoYear ? { year: governing.year.carried ? 2 : 1, of: governing.lease.years.length } : null;
    out.push({
      key: u.id,
      unitId: u.propertyOnly ? null : u.id,
      propertyId: p.id,
      property: p.name,
      unit: u.propertyOnly ? "(whole property)" : u.name,
      market: p.marketId,
      marketLabel: p.marketLabel,
      fund: p.fund,
      segment: p.segment,
      beds: u.beds,
      propertyBeds: p.beds,
      propertyUnits: p.units.length,
      free: u.beds - taken,
      taken,
      bedroomCount: u.bedrooms.length,
      bedrooms: u.bedrooms.map((b) => ({ id: b.id, name: b.name, beds: b.beds, free: !(r.placement.leafResults.get(b.key) || { occupied: 0 }).occupied })),
      occupiedBy: leaves.some((l) => l.occupied) ? new Set(leaves.flatMap((l) => l.types || [])).size > 1 ? "Mixed" : leafTypeLabel(leaves.find((l) => l.occupied)) : "Vacant",
      occWH: leaves.reduce((s2, l) => s2 + (l.typeKey === "WH" ? l.occupied : 0), 0),
      occUnit: leaves.reduce((s2, l) => s2 + (l.typeKey === "UNIT" ? l.occupied : 0), 0),
      occBed: leaves.reduce((s2, l) => s2 + (l.typeKey === "BED" ? l.occupied : 0), 0),
      stage: stageKey,
      stageSource,
      stageDate,
      daysInStage: daysInStage(stageDate, ctx.today),
      editable,
      rowId: s ? String(s.id) : null,
      version: s ? String(s.lastmodified) : null,
      missingStatusRow: !s && !u.propertyOnly,
      tours: 0,
      lastTour: null,
      // §5.6: filled once the tour link field exists (schema.degraded says so)
      targetMonthly,
      targetPerBed: targetMonthly != null && u.beds ? targetMonthly / u.beds : null,
      settleMonthly,
      settlePerBed: settleMonthly != null && u.beds ? settleMonthly / u.beds : null,
      nextTargetMonthly,
      nextTargetPerBed: nextTargetMonthly != null && u.beds ? nextTargetMonthly / u.beds : null,
      monthlyRent,
      signedPerBed: monthlyRent != null && u.beds ? monthlyRent / u.beds : null,
      breach: monthlyRent != null && settleMonthly > 0 && monthlyRent < settleMonthly,
      vsTarget: monthlyRent != null && targetMonthly ? monthlyRent - targetMonthly : null,
      vsTargetPerBed: monthlyRent != null && targetMonthly && u.beds ? (monthlyRent - targetMonthly) / u.beds : null,
      sent: governing ? governing.lease.sentDate : null,
      signed: governing ? governing.lease.signedDate : null,
      leaseStart: governing ? governing.lease.start : null,
      leaseEnd: governing ? governing.lease.end : null,
      twoYear,
      priorRent: priorRent == null ? null : Number(priorRent.toFixed(2)),
      priorOcc,
      priorTenantCount: priorTenantIds.length,
      priorTenantIds,
      lastOffer: s ? s.last_offer : null,
      expectedTenants: s ? s.expected_tenants : null,
      followup,
      notes: s ? s.notes : null,
      leaseTerms: s && s.lease_terms ? safeJson(s.lease_terms) : null,
      noteCount: notes.length,
      lastNote: notes.length ? notes[notes.length - 1] : null,
      mentions: [...new Set(notes.flatMap((n) => n.mentions))],
      needsAction: editable && (stageKey === "NONE" || !!followup && followup <= ctx.today),
      leases: leases.map((l) => ({ id: l.lease.id, name: l.lease.name, type: l.lease.typeKey, typeLabel: typeLabel3(l.lease.typeKey), status: l.lease.statusKey, start: l.lease.start, end: l.lease.end, monthly: l.lease.monthlyRent, sent: l.lease.sentDate, signed: l.lease.signedDate, tenants: l.lease.tenantCount, placed: l.status === "placed", code: l.code })),
      draftLease: draft ? { id: draft.lease.id, name: draft.lease.name, type: draft.lease.typeKey, monthly: draft.lease.monthlyRent } : null,
      rrUnitId: u.rrUnitId
    });
  }
  return { rows: out, missing, stageRowCount: stageRows.length, priorAy: r.prior ? r.prior.ay : null };
}
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}
function routePipeline(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), q = ctx.params;
  const built = buildPipelineRows(ctx, ay, basis);
  const sel = ctx.selection();
  const view = applyPipelineView(built.rows, { ...q, fund: sel.fund, market: sel.marketId, mentions: q.mentions === "me" ? String(ctx.scope.userId) : q.mentions });
  return { ay, basis, priorAy: built.priorAy, selection: sel, today: ctx.today, me: String(ctx.scope.userId), ...view, stageRowCount: built.stageRowCount, missingStatusRows: built.rows.filter((r) => r.missingStatusRow).length, missingFields: built.missing, degraded: ctx.schema.degraded };
}

// src/server/routes/unitHistory.js
function routeUnitHistory(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis();
  const key = String(ctx.params.unit || "");
  const row = buildPipelineRows(ctx, ay, basis).rows.find((r) => r.key === key);
  if (!row) return { error: `unit ${key} not found in your markets`, meta: { status: 404 } };
  const ays = ctx.ays();
  const label = (y) => (ays.find((a) => a.year === y) || {}).label || `AY ${y}-${y + 1}`;
  const years = [];
  if (row.priorRent != null || ctx.ays().some((a) => a.year === ay - 1)) years.push({ year: ay - 1, label: label(ay - 1), monthly: row.priorRent, perBed: row.priorRent != null && row.priorOcc ? row.priorRent / row.priorOcc : null, status: row.priorRent != null ? `Signed · ${row.priorOcc} of ${row.beds} beds` : "No lease on this unit", kind: "prior" });
  years.push({ year: ay, label: label(ay), monthly: row.targetMonthly, perBed: row.targetPerBed, actual: row.monthlyRent, status: row.monthlyRent != null ? `Signed ${row.monthlyRent}` : row.stage === "NONE" ? "Not started" : row.stage, kind: "current" });
  if (ays.some((a) => a.year === ay + 1)) years.push({ year: ay + 1, label: label(ay + 1), monthly: row.nextTargetMonthly, perBed: row.nextTargetPerBed, status: row.nextTargetMonthly == null ? "Targets not set yet" : "Target", kind: "next" });
  const lookups = ctx.load().lookups;
  const stageName = (id) => {
    const k = lookups.stageIds[String(id)];
    return (STAGES.find((s) => s.key === k) || {}).label || (id == null ? "" : String(id));
  };
  const log2 = row.rowId ? ctx.dao.pipeline.stageLog([row.rowId]).map((l) => ({ id: String(l.id), date: toISO(l.log_date), from: stageName(l.from_stage), to: stageName(l.to_stage), source: String(l.source) === "2" ? "lease" : "manual", user: l.user_id == null ? null : String(l.user_id) })) : [];
  const notes = row.rowId ? ctx.dao.pipeline.notes([row.rowId]).map((n) => ({ id: String(n.id), date: toISO(n.note_date) || toISO(n.created), author: n.author_name || String(n.author || ""), text: n.text || "", mentions: n.mentions == null ? [] : String(n.mentions).split(/[,\s]+/).filter(Boolean) })) : [];
  const priorTenants = row.priorTenantIds.length ? ctx.dao.people.byIds(row.priorTenantIds).map((c) => ({ id: String(c.id), name: [c.firstname, c.lastname].filter(Boolean).join(" ") || c.entityid, email: c.email || null })) : [];
  return {
    ay,
    basis,
    unit: { key: row.key, unitId: row.unitId, name: row.unit, propertyId: row.propertyId, property: row.property, market: row.market, marketLabel: row.marketLabel, beds: row.beds, free: row.free, bedrooms: row.bedrooms, occupiedBy: row.occupiedBy, occWH: row.occWH, occUnit: row.occUnit, occBed: row.occBed, leaseStart: row.leaseStart, leaseEnd: row.leaseEnd },
    years,
    settleMonthly: row.settleMonthly,
    settlePerBed: row.settlePerBed,
    breach: row.breach,
    lastOffer: row.lastOffer,
    expectedTenants: row.expectedTenants,
    followup: row.followup,
    stage: row.stage,
    stageSource: row.stageSource,
    stageDate: row.stageDate,
    daysInStage: row.daysInStage,
    sent: row.sent,
    signed: row.signed,
    twoYear: row.twoYear,
    leases: row.leases,
    draftLease: row.draftLease,
    log: log2,
    notes,
    legacyNotes: row.notes,
    priorTenants,
    priorAyLabel: label(ay - 1)
  };
}

// src/server/routes/team.js
function routeTeam(ctx) {
  const team = ctx.dao.people.team();
  return { me: String(ctx.scope.userId), team, available: team.length > 0 };
}

// src/server/routes/people.js
function ids(v) {
  return v == null || v === "" ? [] : String(v).split(/[,\s]+/).filter(Boolean);
}
function readyToAttach(t, { leaseProperty = null, leaseAy = null } = {}) {
  const props = ids(t.property), ays = ids(t.ay);
  const reasons = [];
  if (!props.length) reasons.push("no property set");
  if (!ays.length) reasons.push("no academic year set");
  if (leaseProperty && props.length && !props.includes(String(leaseProperty))) reasons.push(`property does not include the lease's property`);
  if (leaseAy && ays.length && !ays.includes(String(leaseAy))) reasons.push(`academic year does not include the lease's year`);
  return { ready: reasons.length === 0, reasons };
}
function routeTenants(ctx) {
  const q = ctx.params;
  const inv = ctx.load().prepared.inventory;
  const filters = {
    q: q.q || null,
    stage: "CUSTOMER",
    statusIds: ids(q.status),
    propertyIds: ids(q.property),
    ayIds: ids(q.ayId),
    missingProperty: q.view === "needs-attention" || q.missingProperty === "1",
    missingAy: q.missingAy === "1",
    scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope()
  };
  if (q.view === "needs-attention") {
    filters.missingProperty = false;
    filters.missingAy = false;
    filters.needsAttention = true;
  }
  const pageSize = Math.min(500, Math.max(25, Number(q.pageSize) || 100)), page = Math.max(0, Number(q.page) || 0);
  let result;
  if (filters.needsAttention) {
    const a = ctx.dao.people.tenants({ filters: { ...filters, missingProperty: true }, sort: q.sort, page: 0, pageSize: 1e3 });
    const b = ctx.dao.people.tenants({ filters: { ...filters, missingAy: true }, sort: q.sort, page: 0, pageSize: 1e3 });
    const seen = /* @__PURE__ */ new Set();
    const rows2 = [];
    for (const r of a.rows.concat(b.rows)) if (!seen.has(r.id)) {
      seen.add(r.id);
      rows2.push(r);
    }
    result = { rows: rows2.slice(page * pageSize, (page + 1) * pageSize), total: rows2.length, page, pageSize };
  } else result = ctx.dao.people.tenants({ filters, sort: q.sort, page, pageSize });
  const custIds = result.rows.map((r) => r.id);
  const leaseLinks = custIds.length ? ctx.dao.people.leaseLinks(custIds) : [];
  const leasesByCust = /* @__PURE__ */ new Map();
  for (const l of leaseLinks) {
    if (!leasesByCust.has(String(l.customer))) leasesByCust.set(String(l.customer), []);
    leasesByCust.get(String(l.customer)).push(String(l.lease));
  }
  const dupEmails = new Set(ctx.dao.people.duplicates().map((d) => d.email));
  const leaseCtx = { leaseProperty: q.leaseProperty || null, leaseAy: q.leaseAy || null };
  const rows = result.rows.map((t) => {
    const propIds = ids(t.property), ayIds = ids(t.ay);
    return {
      id: String(t.id),
      name: [t.firstname, t.lastname].filter(Boolean).join(" ") || t.entityid,
      email: t.email,
      phone: t.phone || t.mobilephone,
      status: t.status_name,
      statusId: t.entitystatus,
      properties: propIds.map((p) => ({ id: p, name: (inv.propertiesById.get(p) || {}).name || p, market: (inv.propertiesById.get(p) || {}).marketId || null })),
      academicYears: ayIds.map((a) => ({ id: a, label: (ctx.ays().find((x) => x.id === a) || {}).label || a })),
      leases: leasesByCust.get(String(t.id)) || [],
      ready: readyToAttach(t, leaseCtx),
      created: toISO(t.datecreated),
      version: String(t.lastmodifieddate || ""),
      desiredLocation: t.desired_location,
      school: t.school,
      duplicate: t.duplicate === "T" || t.email && dupEmails.has(String(t.email).toLowerCase())
    };
  });
  return { total: result.total, page: result.page, pageSize: result.pageSize, rows, statuses: ctx.dao.people.statusList().filter((s) => s.entitytype === "CUSTOMER"), degraded: ctx.schema.degraded };
}
function routeLeads(ctx) {
  return { error: "Leads workspace is not designed yet: the §5.5.0 lead discovery write-up (docs/LEAD-DISCOVERY.md) is awaiting review.", status: 501, meta: { status: 501 } };
}

// src/shared/rules/quality.js
var mainSeg3 = (p) => !!p && (SEGMENTS[p.segment] || SEGMENTS.STUDENT).inOccupancy;
var RECORD_ISSUES = {
  ORPHAN_BEDROOM: { issue: "Bedroom record whose parent unit is missing or inactive", handling: "Treated as its own unit so its beds still count", fix: "Reactivate the parent unit or move the bedroom under the right unit." },
  UNIT_ZERO_BEDS: { issue: "Unit has no bedroom records and no bed count", handling: "Counts as 0 beds", fix: "Set Number of Beds on the unit, or add its bedroom records." },
  UNIT_BED_COUNT_DIFFERS: { issue: "Unit bed count differs from its bedroom records", handling: "Bedroom records win", fix: "Correct Number of Beds on the unit or on the bedrooms." },
  BEDROOM_PROPERTY_MISMATCH: { issue: "Bedroom points at a different property than its unit", handling: "The unit's property is used", fix: "Correct the Property on the bedroom record." },
  BEDROOM_PROPERTY_INHERITED: { issue: "Bedroom has no Property", handling: "Inherits the unit's property", fix: "Set the Property on the bedroom record." },
  PROPERTY_ONLY_LEAF: { issue: "Property has no unit records", handling: "Its own bedroom count is used as one leaf", fix: "Create the Units/Bedrooms records so leases can link to them." },
  PARENT_PROPERTY_MISSING: { issue: "Parent property is missing or inactive", handling: "Treated as a top-level property", fix: "Reactivate the parent or clear the Parent field." },
  FUND_UNMAPPED: { issue: "Subsidiary does not map to a fund", handling: 'Shown under "Unmapped fund"', fix: "Add the subsidiary to the fund rules (constants.js) or correct the Subsidiary on the property." },
  MARKET_UNMAPPED: { issue: "City does not map to a market", handling: 'Shown under "Unmapped city"; never in a market lock', fix: "Set the City on the property to one of the market spellings." },
  UNIT_PROPERTY_MISSING: { issue: "Unit points at a missing or inactive property", handling: "Unit is dropped from the inventory", fix: "Correct the Property on the unit." },
  TARGET_NO_UNIT: { issue: "Academic Year Details row has no active unit", handling: "Target not used", fix: "Set the Unit on the Academic Year Details row or inactivate it." },
  TARGET_DUPLICATE: { issue: "Unit has more than one Academic Year Details row", handling: "Latest row used", fix: "Inactivate the duplicate Academic Year Details row." }
};
function recordQuality(run, { keep = () => true } = {}) {
  const inv = run.inventory;
  const out = [];
  const push = (code, x, kind, recordId, record2) => {
    const meta = RECORD_ISSUES[code];
    if (!meta) return;
    const p = inv.propertiesById.get(String(x.propertyId || x.unitId && (inv.unitsById.get(String(x.unitId)) || {}).propertyId || ""));
    if (p && !keep(p)) return;
    if (!p && !keep({ fund: null, marketId: "unknown" })) return;
    out.push({ code, issue: meta.issue, handling: meta.handling, fix: meta.fix, kind, recordId: recordId ? String(recordId) : null, record: record2, property: p ? p.name : "", propertyId: p ? p.id : null, market: p ? p.marketLabel : "", detail: x.detail || "" });
  };
  for (const x of inv.issues) {
    if (x.code === "ORPHAN_BEDROOM" || x.code === "UNIT_ZERO_BEDS" || x.code === "UNIT_BED_COUNT_DIFFERS" || x.code === "UNIT_PROPERTY_MISSING") push(x.code, x, "unit", x.unitId, (inv.unitsById.get(String(x.unitId)) || {}).name || `Unit #${x.unitId}`);
    else if (x.code === "BEDROOM_PROPERTY_MISMATCH" || x.code === "BEDROOM_PROPERTY_INHERITED") push(x.code, x, "unit", x.bedroomId, (inv.bedroomsById.get(String(x.bedroomId)) || {}).name || `Bedroom #${x.bedroomId}`);
    else push(x.code, x, "property", x.propertyId, (inv.propertiesById.get(String(x.propertyId)) || {}).name || `Property #${x.propertyId}`);
  }
  for (const x of run.targetIssues || []) push(x.code, x, "details", x.targetId, `Details #${x.targetId}`);
  return out;
}
function leaseQuality(run, { keep = () => true, today, ayEnd } = {}) {
  const t = dayNum(today), end = dayNum(ayEnd);
  const out = [];
  for (const r of run.placement.leaseResults.values()) {
    if (r.year.carried) continue;
    const p = propertyOf(run, r);
    if (p && !keep(p)) continue;
    const l = r.lease;
    const push = (code, issue, handling, fix, detail) => out.push({ code, issue, handling, fix, detail: detail || "", kind: "lease", recordId: l.id, record: l.name, property: p ? p.name : "", propertyId: p ? p.id : null, market: p ? p.marketLabel : "", linked: linkedName(run, r), mrev: l.monthlyRent, status: l.statusKey });
    const signed = dayNum(l.signedDate);
    if (l.statusKey === "EXECUTED" && signed == null) push("EXEC_NO_SIGNED", "Fully Executed lease has no Lease Signed Date", "Counted in totals; left out of the weekly history", "Enter the Lease Signed Date.");
    if (l.statusKey === "IN_PROCESS" && !l.sentDate) push("INPROC_NO_SENT", "In Process lease has no Lease Sent Date", "Left out of the pro-forma weekly history and days-in-process", "Enter the Lease Sent Date.");
    if (l.termMismatch) push("TERM_MISMATCH", "Lease Duration says two years but the dates cover one", "Counted in a single academic year, following the dates", "Correct the Lease End Date, or the Lease Duration by Months.", `Duration ${l.durationField} mo, dates ${l.dateMonths} mo`);
    if (l.statusKey === "NONE") push("NO_STATUS", "Lease Status is blank", "Left out of the leasing statistics entirely until a status is set", "Set Lease Status to In Process once the lease goes out, or Fully Executed once it is signed.");
    if (signed != null && t != null && signed > t) push("SIGNED_FUTURE", "Lease Signed Date is in the future", "Weekly history uses it as entered", "Correct the Lease Signed Date.", `Signed ${l.signedDate}`);
    else if (signed != null && end != null && signed > end) push("SIGNED_AFTER_AY", "Lease Signed Date is after the academic year ends", "Weekly history uses it as entered", "Correct the Lease Signed Date or the Academic Year.", `Signed ${l.signedDate}`);
    if (l.statusKey === "OTHER") push("UNKNOWN_STATUS", "Lease Status is not Fully Executed or In Process", "Skipped on both bases", "Set a recognised Lease Status.", `Status value ${l.statusRaw}`);
  }
  return out;
}
function tenantQuality(run, { keep = () => true, customersById = /* @__PURE__ */ new Map() } = {}) {
  const out = [];
  const byTenant = /* @__PURE__ */ new Map();
  for (const r of run.placement.leaseResults.values()) {
    if (r.year.carried || r.status === "skipped" || r.lease.statusKey === "NONE") continue;
    const p = propertyOf(run, r);
    if (!p || !mainSeg3(p) || !keep(p)) continue;
    const l = r.lease;
    const base = { kind: "lease", recordId: l.id, record: l.name, property: p.name, propertyId: p.id, market: p.marketLabel, linked: linkedName(run, r), mrev: l.monthlyRent };
    const ids2 = l.tenantIds, n = l.tenantCount;
    if (!ids2.length) out.push({ ...base, code: "NO_TENANTS", issue: "Lease has no tenant records linked", detail: `Number of Tenants ${n}`, sev: 1, fix: n ? `Add the ${n} tenant record${n === 1 ? "" : "s"} to the lease's Tenants field.` : "Add the tenants to the Tenants field and set Number of Tenants.", related: [] });
    else if (ids2.length !== n) out.push({ ...base, code: "TENANT_COUNT", issue: "Number of Tenants does not match linked tenants", detail: `Number of Tenants ${n} · linked ${ids2.length}`, sev: 1, fix: `Set Number of Tenants to ${ids2.length}, or link the missing / remove the extra tenant records.`, related: ids2.slice(0, 12).map((id) => ({ kind: "tenant", id, name: nameOf(customersById, id) })) });
    for (const id of ids2) {
      if (!byTenant.has(id)) byTenant.set(id, []);
      byTenant.get(id).push({ r, p });
    }
  }
  for (const [id, list] of byTenant) {
    const c = customersById.get(String(id)) || null;
    const first = list[0];
    const base = { kind: "tenant", recordId: String(id), record: nameOf(customersById, id), property: first.p.name, propertyId: first.p.id, market: first.p.marketLabel, linked: linkedName(run, first.r), mrev: null };
    const leaseRef = ({ r }) => ({ kind: "lease", id: r.lease.id, name: r.lease.name });
    if (list.length > 1) {
      const places = list.map(({ r, p }) => `${p.name}${linkedName(run, r) ? ` — ${linkedName(run, r)}` : ""}`);
      const mkts = [...new Set(list.map(({ p }) => p.marketLabel))];
      const dupRent = list.reduce((s, { r }) => s + r.lease.monthlyRent, 0) - list[0].r.lease.monthlyRent;
      out.push({ ...base, code: "TENANT_MULTI", issue: "Tenant is on more than one active lease in this AY", sev: 2, detail: `${list.length} leases · ${places.join(" | ")}${mkts.length > 1 ? ` · ${mkts.join(" + ")}` : ""}`, places, markets: mkts, mrev: Number(dupRent.toFixed(2)), dupLeases: list.length, fix: "Keep the tenant on the correct lease and remove them from the others (or inactivate the duplicate lease).", related: list.map(leaseRef) });
    }
    if (c && c.isinactive === "T") out.push({ ...base, code: "TENANT_INACTIVE", issue: "Tenant record is inactive but on an active lease", detail: "", sev: 1, fix: "Reactivate the tenant record, or remove the tenant from the lease.", related: list.map(leaseRef) });
    if (c && !c.email) out.push({ ...base, code: "TENANT_NO_EMAIL", issue: "Tenant has no email address", detail: "", sev: 0, fix: "Add an email address on the tenant record.", related: list.map(leaseRef) });
  }
  return out;
}
function nameOf(map, id) {
  const c = map.get(String(id));
  return c ? c.name || `Tenant #${id}` : `Tenant #${id}`;
}

// src/server/routes/exceptions.js
function routeExceptions(ctx, _body, { full = true } = {}) {
  const r = ctx.run();
  const inv = r.inventory;
  const sel = ctx.selection(), keep = ctx.keep(sel);
  const nameOf2 = (m, id) => (m.get(String(id)) || {}).name || null;
  const propIn = (id) => {
    const p = inv.propertiesById.get(String(id));
    return p ? keep(p) : ctx.scope.all;
  };
  const rows = r.exceptions.filter((e) => propIn(e.propertyId)).map((e) => ({ ...e, property: nameOf2(inv.propertiesById, e.propertyId), unit: nameOf2(inv.unitsById, e.unitId), bedroom: nameOf2(inv.bedroomsById, e.bedroomId), market: (inv.propertiesById.get(String(e.propertyId)) || {}).marketId, meaning: EXCEPTION_CODES[e.code].meaning, action: EXCEPTION_CODES[e.code].action }));
  const groups = EXCEPTION_ORDER.map((code) => ({ code, ...EXCEPTION_CODES[code], rows: rows.filter((x) => x.code === code) })).filter((g) => g.rows.length);
  const doubles = r.tenantDoubles.filter((d) => d.leases.some((l) => propIn(l.propertyId))).map((d) => ({ ...d, leases: d.leases.map((l) => ({ ...l, property: nameOf2(inv.propertiesById, l.propertyId), unit: nameOf2(inv.unitsById, l.unitId), market: (inv.propertiesById.get(String(l.propertyId)) || {}).marketId })) }));
  const out = { ay: ctx.selectedAy(), basis: ctx.basis(), selection: sel, count: rows.filter((x) => x.excludes || x.code === "TENANT_DOUBLE").length, total: rows.length, groups, tenantDoubles: doubles, overlapRule: ctx.flags.requireOverlapForCollision };
  if (!full) return out;
  const { blocking, blockingTotal } = blockingByReason(r, { keep });
  const records = recordQuality(r, { keep });
  const leases = leaseQuality(r, { keep, today: ctx.today, ayEnd: ayEndDate(ctx.selectedAy()) });
  const tenantIds = /* @__PURE__ */ new Set();
  for (const x of r.placement.leaseResults.values()) {
    if (x.year.carried || x.status === "skipped" || x.lease.statusKey === "NONE") continue;
    const p = inv.propertiesById.get(x.scope.propertyId || x.lease.propertyId);
    if (p && keep(p)) for (const t of x.lease.tenantIds) tenantIds.add(t);
  }
  const customersById = /* @__PURE__ */ new Map();
  if (tenantIds.size) for (const c of ctx.dao.people.byIds([...tenantIds])) customersById.set(String(c.id), { id: String(c.id), name: [c.firstname, c.lastname].filter(Boolean).join(" ") || c.entityid, email: c.email || null, isinactive: c.isinactive });
  const tenants = tenantQuality(r, { keep, customersById });
  return { ...out, blocking: blocking.map((g) => ({ ...g, label: EXCEPTION_CODES[g.code].label, meaning: EXCEPTION_CODES[g.code].meaning, fix: EXCEPTION_CODES[g.code].action })), blockingTotal, records, leaseQuality: leases, tenantQuality: tenants, advisoryCount: records.length + leases.length + tenants.length };
}

// src/server/routes/today.js
function routeToday(ctx) {
  const ay = ctx.selectedAy();
  const { rows } = buildPipelineRows(ctx, ay, ctx.basis());
  const tomorrow = addDays(ctx.today, 1);
  const followups = rows.filter((r) => r.followup && r.followup <= tomorrow).sort((a, b) => a.followup.localeCompare(b.followup));
  const stale = rows.filter((r) => r.stage !== "NONE" && r.stageSource !== "lease" && (r.daysInStage || 0) > STALE_STAGE_DAYS).sort((a, b) => b.daysInStage - a.daysInStage);
  const ex = routeExceptions(ctx, null, { full: false });
  const blocked = ctx.dao.people.tenants({ filters: { stage: "CUSTOMER", missingProperty: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() }, page: 0, pageSize: 25 });
  const blockedAy = ctx.dao.people.tenants({ filters: { stage: "CUSTOMER", missingAy: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() }, page: 0, pageSize: 25 });
  return {
    ay,
    today: ctx.today,
    followups: { count: followups.length, rows: followups.slice(0, 50) },
    tours: { count: 0, rows: [], note: "tour link field not yet created (§5.6)" },
    stale: { count: stale.length, rows: stale.slice(0, 50), thresholdDays: STALE_STAGE_DAYS },
    leads: { count: 0, rows: [], note: "leads workspace pending §5.5.0 review" },
    blockedTenants: { missingProperty: blocked.total, missingAy: blockedAy.total, sample: blocked.rows.slice(0, 10).map((t) => ({ id: String(t.id), name: [t.firstname, t.lastname].filter(Boolean).join(" "), desiredLocation: t.desired_location })) },
    exceptions: { count: ex.count, byCode: ex.groups.map((g) => ({ code: g.code, label: g.label, severity: g.severity, n: g.rows.length })) }
  };
}

// src/server/routes/savedViews.js
function routeSavedViews(ctx, body) {
  const have = ctx.schema.probe(SAVED_VIEW.TYPE, [SAVED_VIEW.JSON]).get(SAVED_VIEW.JSON) !== false;
  if (!have) return { views: [], degraded: "saved views record not created yet (see SETUP-CHECKLIST)" };
  if (body) {
    const v = body.view || {};
    const change = { changeId: body.changeId, recordType: SAVED_VIEW.TYPE, recordId: v.id || null, fields: { [SAVED_VIEW.OWNER]: ctx.scope.userId, [SAVED_VIEW.WORKSPACE]: String(v.workspace || ""), [SAVED_VIEW.NAME]: String(v.name || "").slice(0, 80), name: String(v.name || "").slice(0, 80), [SAVED_VIEW.JSON]: JSON.stringify(v.state || {}), [SAVED_VIEW.IS_DEFAULT]: !!v.isDefault, [SAVED_VIEW.SHARED_MARKETS]: (v.sharedMarkets || []).filter((m) => ctx.inScope(m)).join(","), ...body.delete ? { isinactive: true } : {} } };
    if (v.id) {
      const owner = ctx.sq.one(`SELECT ${SAVED_VIEW.OWNER} AS owner FROM ${SAVED_VIEW.TYPE} WHERE id = ?`, [Number(v.id)]);
      if (!owner || String(owner.owner) !== String(ctx.scope.userId)) return { error: "not your view", meta: { status: 403 } };
    }
    return ctx.writes.apply([change], ctx.scope);
  }
  const mine = ctx.sq.few(`SELECT id, ${SAVED_VIEW.WORKSPACE} AS workspace, ${SAVED_VIEW.NAME} AS name, ${SAVED_VIEW.JSON} AS state, ${SAVED_VIEW.IS_DEFAULT} AS is_default, ${SAVED_VIEW.SHARED_MARKETS} AS shared, ${SAVED_VIEW.OWNER} AS owner FROM ${SAVED_VIEW.TYPE} WHERE isinactive = 'F' AND (${SAVED_VIEW.OWNER} = ? OR ${SAVED_VIEW.SHARED_MARKETS} IS NOT NULL)`, [ctx.scope.userId]);
  const views = mine.filter((v) => String(v.owner) === String(ctx.scope.userId) || String(v.shared || "").split(",").some((m) => ctx.inScope(m.trim()))).map((v) => ({ id: String(v.id), workspace: v.workspace, name: v.name, state: safe(v.state), isDefault: v.is_default === "T" || v.is_default === true, sharedMarkets: String(v.shared || "").split(",").filter(Boolean), mine: String(v.owner) === String(ctx.scope.userId) }));
  return { views };
}
function safe(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

// src/server/routes/write.js
function routeWrite(ctx, body) {
  const changes = Array.isArray(body && body.changes) ? body.changes.slice(0, 200) : [];
  if (!changes.length) return { results: [], deferred: [], error: "no changes" };
  return ctx.writes.apply(changes, ctx.scope);
}

// src/server/routes/leaseDialog.js
function routeLeaseDialog(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis();
  const unitId = String(ctx.params.unit || "");
  const r = ctx.run(ay, basis);
  const inv = r.inventory;
  const u = inv.unitsById.get(unitId);
  if (!u) return { error: `unit ${unitId} not found`, meta: { status: 404 } };
  const p = inv.propertiesById.get(u.propertyId);
  if (!p || !ctx.inScope(p.marketId)) return { error: "outside your markets", meta: { status: 403 } };
  const targetFor = (unit) => {
    const t = r.targets.find((x) => x.ay === ay && x.unitId === unit.id);
    return t ? t.targetMonthly ?? (t.targetPerBed != null ? t.targetPerBed * unit.beds : null) : null;
  };
  const leafFree = (leaf) => !(r.placement.leafResults.get(leaf.key) || { occupied: 0 }).occupied;
  const prior = ctx.run(ay - 1, basis);
  const priorLeaseIds = [...new Set(u.leaves.flatMap((l) => (prior.placement.leafResults.get(l.key) || { placements: [] }).placements.map((pl) => pl.leaseId)))];
  const priorTenantIds = [...new Set(priorLeaseIds.flatMap((id) => (prior.placement.leaseResults.get(id) || { lease: { tenantIds: [] } }).lease.tenantIds))];
  const names = priorTenantIds.length ? ctx.dao.people.byIds(priorTenantIds).map((c) => [c.firstname, c.lastname].filter(Boolean).join(" ")).filter(Boolean) : [];
  const market = MARKETS.find((m) => m.id === p.marketId) || null;
  const lookups = ctx.load().lookups;
  return {
    ay,
    ayId: ctx.ayIdFor(ay),
    ayNextId: ctx.ayIdFor(ay + 1),
    basis,
    property: { id: p.id, name: p.name, marketId: p.marketId, calendar: market ? market.calendar : null, units: p.units.map((id) => {
      const x = inv.unitsById.get(id);
      return { id: x.id, name: x.name, beds: x.beds, targetMonthly: targetFor(x) };
    }) },
    unit: { id: u.id, name: u.name, beds: u.beds, targetMonthly: targetFor(u), bedrooms: u.bedrooms.map((b) => ({ id: b.id, name: b.name, beds: b.beds, free: leafFree(b) })) },
    priorTenantNames: names,
    ids: { leaseType: invert(lookups.leaseTypeIds), groupType: groupTypeIds(ctx) }
  };
}
function invert(m) {
  const o = {};
  for (const [id, key] of Object.entries(m || {})) o[key] = id;
  return o;
}
function groupTypeIds(ctx) {
  const list = ctx.dao.portfolio.lists().customlist_lease_group_type || [];
  const o = {};
  for (const v of list) {
    const n = String(v.name).toLowerCase();
    o[n.startsWith("new") ? "NEW" : n.startsWith("transfer") ? "TRANSFER" : n.startsWith("renew") ? "RENEWAL" : n] = String(v.id);
  }
  return o;
}

// src/server/routes/notes.js
function routeNotes(ctx) {
  const rowId = String(ctx.params.row || "");
  if (!rowId) return { error: "row required", meta: { status: 400 } };
  const row = ctx.sq.one(`SELECT id, custrecord_ad_uas_property AS property, custrecord_ad_uas_notes AS notes FROM customrecord_ad_unit_ay_status WHERE id = ?`, [Number(rowId)]);
  if (!row) return { error: "row not found", meta: { status: 404 } };
  if (!ctx.inScope(ctx.marketOfProperty(row.property))) return { error: "outside your markets", meta: { status: 403 } };
  const notes = ctx.dao.pipeline.notes([rowId]).map((n) => ({ id: String(n.id), date: toISO(n.note_date) || toISO(n.created), author: n.author_name || String(n.author || ""), text: n.text || "", mentions: n.mentions || null }));
  return { rowId, legacy: row.notes || null, notes };
}

// src/server/shell.js
var ASSET_PARAMS = { js: "custscript_al_client_js", css: "custscript_al_client_css" };
function renderShell(ctx) {
  const boot = routeBootstrap(ctx);
  const json = JSON.stringify(boot).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
  const js = assetUrl(ctx, "js"), css = assetUrl(ctx, "css");
  const build = buildId();
  const inline = css ? inlineCss(ctx) : null;
  const styleTag = inline != null ? `<style id="al-css" data-build="${build}">${inline}</style>` : css ? `<link rel="stylesheet" href="${css}">` : "";
  return `<!doctype html><html lang="en" data-theme="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="al-build" content="${build}"><title>Amicus Leasing</title><style>html,body{margin:0;background:#fff;color:#111;font:14px/1.4 system-ui,sans-serif}@media(prefers-color-scheme:dark){html,body{background:#121417;color:#e6e8eb}}#root{min-height:100vh}.al-boot{padding:24px;max-width:720px}</style>${styleTag}</head><body><div id="root"><div class="al-boot" id="al-boot">Loading Amicus Leasing…</div></div><script type="application/json" id="al-bootstrap">${json}</script><script>window.__AL_SERVER_BUILD=${JSON.stringify(build)};</script>${js ? `<script src="${js}" defer onerror="document.getElementById('al-boot').textContent='The client bundle could not be loaded from ${js.replace(/'/g, "")} — open the browser console (F12) for the reason.'"></script>` : `<script>document.getElementById('al-boot').textContent='Client bundle not configured: set the script parameters custscript_al_client_js / custscript_al_client_css to the File Cabinet ids of amicus_leasing_app.js / .css (see SETUP-CHECKLIST).';</script>`}<script>setTimeout(function(){var b=document.getElementById('al-boot');if(b&&b.textContent.indexOf('Loading')===0)b.textContent='The client bundle loaded but did not start. Open the browser console (F12) and send the first error line.';},8000);</script></body></html>`;
}
function buildId() {
  return true ? String("4a4f19937275") : "dev";
}
function inlineCss(ctx) {
  try {
    const id = fileId(ctx, "css");
    if (!id) return null;
    const text = ctx.N.file.load({ id }).getContents();
    if (typeof text !== "string" || !text.trim()) return null;
    return text.replace(/<\/(style)/gi, "<\\/$1");
  } catch (e) {
    ctx.log && ctx.log.audit && ctx.log.audit({ title: "stylesheet not inlined", details: `${e && e.name}: ${e && e.message}` });
    return null;
  }
}
function assetUrl(ctx, kind) {
  const id = fileId(ctx, kind);
  if (!id) return null;
  const p = ctx.params || {};
  const keep = ["script", "deploy", "compid", "whence"].filter((k) => p[k] != null && p[k] !== "").map((k) => `${k}=${encodeURIComponent(p[k])}`);
  const v = buildId() === "dev" ? id : buildId();
  return `/app/site/hosting/scriptlet.nl?${keep.join("&")}&route=asset&kind=${kind}&v=${v}`;
}
function fileId(ctx, kind) {
  try {
    const id = ctx.N.runtime.getCurrentScript().getParameter({ name: ASSET_PARAMS[kind] });
    return id ? Number(id) : null;
  } catch (e) {
    return null;
  }
}
function serveAsset(ctx, context) {
  const plain = (text) => {
    try {
      context.response.setHeader({ name: "Content-Type", value: "text/plain; charset=utf-8" });
    } catch (e) {
    }
    context.response.write(text);
  };
  const kind = String((ctx.params || {}).kind || "").toLowerCase();
  let id = null;
  try {
    id = fileId(ctx, kind);
    if (!ASSET_PARAMS[kind] || !id) {
      plain(`asset "${kind}" is not configured: set ${ASSET_PARAMS[kind] || "kind=js|css"} on the deployment`);
      return;
    }
    const f = ctx.N.file.load({ id });
    try {
      context.response.setHeader({ name: "Cache-Control", value: "private, max-age=3600" });
    } catch (e) {
    }
    if (typeof context.response.writeFile === "function") {
      context.response.writeFile({ file: f, isInline: true });
      return;
    }
    context.response.setHeader({ name: "Content-Type", value: kind === "css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8" });
    context.response.write(f.getContents());
  } catch (e) {
    ctx.log && ctx.log.error && ctx.log.error({ title: `asset ${kind} failed`, details: `${ASSET_PARAMS[kind]}=${id}: ${e && e.name}: ${e && e.message}
${e && e.stack}` });
    plain(`asset "${kind}" (file ${id}) failed: ${e && e.name}: ${e && e.message}`);
  }
}

// src/server/app.js
function createApp(N) {
  const log2 = N.log;
  const schema = createSchema({ query: N.query, log: log2, cache: N.cache ? safeCache(N.cache) : null });
  const sq = createSuiteQL({ query: N.query, log: log2 });
  const dao = { portfolio: createPortfolioDao({ sq, schema }), pipeline: createPipelineDao({ sq, schema }), people: createPeopleDao({ sq, schema }) };
  const auth = createAuth({ runtime: N.runtime, sq, schema, log: log2 });
  function makeCtx(context) {
    const params = context.request.parameters || {};
    const scope = auth.resolve();
    const today = toISO(/* @__PURE__ */ new Date());
    const flags = { ...FEATURE_FLAGS, requireOverlapForCollision: readFlag(N.runtime, "custscript_al_overlap_rule", FEATURE_FLAGS.requireOverlapForCollision) };
    let portfolio = null;
    const runs = /* @__PURE__ */ new Map();
    let ayRows = null;
    const ctx = {
      N,
      sq,
      dao,
      schema,
      auth,
      scope,
      params,
      today,
      flags,
      log: log2,
      ays() {
        if (!ayRows) ayRows = dao.portfolio.academicYears().filter((a) => a.isinactive !== "T" && ayYearFromLabel(a.name) != null).map((a) => ({ id: String(a.id), year: ayYearFromLabel(a.name), label: a.name, short: ayShort(ayYearFromLabel(a.name)), start: toISO(a.start_date), end: toISO(a.end_date) })).sort((a, b) => a.year - b.year);
        return ayRows;
      },
      ayIdFor(year) {
        const a = ctx.ays().find((x) => x.year === year);
        return a ? a.id : null;
      },
      currentAy() {
        return ayForDate(today);
      },
      selectedAy() {
        const y = Number(params.ay);
        return Number.isFinite(y) && y > 2e3 ? y : ctx.currentAy();
      },
      basis() {
        return params.basis === "executed" ? "executed" : "proforma";
      },
      /** Load everything the engine needs for the AYs in play (selected, prior, next). */
      load() {
        if (portfolio) return portfolio;
        const years = [ctx.selectedAy() - 1, ctx.selectedAy(), ctx.selectedAy() + 1];
        const ayIds = years.map((y) => ctx.ayIdFor(y)).filter(Boolean);
        const lists = dao.portfolio.lists();
        const fixture = { properties: dao.portfolio.properties(), units: dao.portfolio.units(), leases: dao.portfolio.leases(null), targets: dao.portfolio.targets(ayIds), academic_years: dao.portfolio.academicYears(), lists };
        portfolio = { fixture, prepared: prepare(fixture, lookupsFromLists(lists)), lookups: lookupsFromLists(lists), ayIds };
        return portfolio;
      },
      /** One engine run per AY × basis per request; the prior year rides along (withPrior) so YoY, pace and same-store need no second call. */
      run(ay = ctx.selectedAy(), basis = ctx.basis(), withPrior = true) {
        const k = `${ay}:${basis}:${withPrior ? 1 : 0}`;
        if (runs.has(k)) return runs.get(k);
        if (withPrior && runs.has(`${ay}:${basis}:0`)) runs.delete(`${ay}:${basis}:0`);
        const p = ctx.load();
        const r = runEngine(p.fixture, { ay, basis, flags, prepared: p.prepared, withPrior });
        runs.set(k, r);
        return r;
      },
      keep(sel = ctx.selection()) {
        return keepFor(scope, sel);
      },
      marketOfProperty(propertyId) {
        const p = ctx.load().prepared.inventory.propertiesById.get(String(propertyId));
        return p ? p.marketId : null;
      },
      scopedSummary: (r, sel) => scopedSummary(r, scope, sel),
      scopedTree: (r, sel) => scopedTree(r, scope, sel),
      inScope: (m) => inScope(scope, m),
      propertyIdsInScope: () => propertyIdsInScope(ctx.load().prepared.inventory, scope),
      selection() {
        return { fund: params.fund || null, marketId: params.market && inScope(scope, params.market) ? params.market : null };
      },
      probeAll() {
        for (const fn of [dao.portfolio.probe, dao.pipeline.probe, dao.people.probe]) {
          try {
            fn();
          } catch (e) {
            log2.error({ title: "probeAll", details: e && e.message });
          }
        }
      }
    };
    ctx.writes = createWrites({ record: N.record, sq, runtime: N.runtime, log: log2, schema, auth, marketOf: (type, id, fields) => marketOf(ctx, type, id, fields), stageIdFor: (key) => {
      for (const [id, k] of Object.entries(ctx.load().lookups.stageIds)) if (k === key) return Number(id);
      return null;
    } });
    return ctx;
  }
  const routes = { bootstrap: routeBootstrap, lists: routeLists, summary: routeSummary, portfolio: routePortfolio, weekly: routeWeekly, velocity: routeVelocity, pipeline: routePipeline, unithistory: routeUnitHistory, team: routeTeam, tenants: routeTenants, leads: routeLeads, exceptions: routeExceptions, today: routeToday, savedviews: routeSavedViews, write: routeWrite, leasedialog: routeLeaseDialog, notes: routeNotes };
  function handle(context) {
    const route = String((context.request.parameters || {}).route || "").toLowerCase();
    const method = context.request.method;
    if (!route) {
      const ctx = makeCtx(context);
      context.response.write(renderShell(ctx));
      return;
    }
    if (route === "asset") {
      serveAsset({ N, params: context.request.parameters || {}, log: log2 }, context);
      return;
    }
    const started = Date.now();
    let status = 200, body;
    try {
      const fn = routes[route];
      if (!fn) {
        status = 404;
        body = { error: `unknown route ${route}` };
      } else if (route === "write" && method !== "POST") {
        status = 405;
        body = { error: "POST only" };
      } else {
        const ctx = makeCtx(context);
        if (method === "POST" && (context.request.headers || {})["X-Requested-With"] !== "AmicusLeasing" && (context.request.headers || {})["x-requested-with"] !== "AmicusLeasing") {
          status = 403;
          body = { error: "missing X-Requested-With header" };
        } else body = fn(ctx, method === "POST" ? parseBody(context.request.body) : null);
      }
    } catch (e) {
      status = 500;
      body = { error: "server error", message: e && e.message, code: e && e.code };
      log2.error({ title: `route ${route} failed`, details: e && e.stack || String(e) });
    }
    body = body || {};
    if (body.meta && body.meta.status) status = body.meta.status;
    body.meta = { ...body.meta || {}, route, ms: Date.now() - started, status };
    context.response.setHeader({ name: "Content-Type", value: "application/json; charset=utf-8" });
    context.response.setHeader({ name: "Cache-Control", value: "no-store" });
    context.response.write(JSON.stringify(body));
  }
  return { handle, schema, auth, dao };
}
function marketOf(ctx, type, id, fields) {
  const sq = ctx.sq;
  if (type === UAS.TYPE) {
    if (id == null) {
      if (fields[UAS.PROPERTY]) return ctx.marketOfProperty(fields[UAS.PROPERTY]);
      const u = ctx.load().prepared.inventory.unitsById.get(String(fields[UAS.UNIT]));
      return u ? ctx.marketOfProperty(u.propertyId) : null;
    }
    const r = sq.one(`SELECT ${UAS.PROPERTY} AS property FROM ${UAS.TYPE} WHERE id = ?`, [Number(id)]);
    return r ? ctx.marketOfProperty(r.property) : null;
  }
  if (type === "customrecord_ad_uas_note") {
    const r = sq.one(`SELECT s.${UAS.PROPERTY} AS property, s.${UAS.UNIT} AS unit FROM ${UAS.TYPE} s WHERE s.id = ?`, [Number(fields.custrecord_ad_note_status)]);
    if (!r) return null;
    if (r.property) return ctx.marketOfProperty(r.property);
    const u = ctx.load().prepared.inventory.unitsById.get(String(r.unit));
    return u ? ctx.marketOfProperty(u.propertyId) : null;
  }
  if (type === LEASE.TYPE) {
    const prop = fields[LEASE.PROPERTY] ?? (id ? (sq.one(`SELECT ${LEASE.PROPERTY} AS property FROM ${LEASE.TYPE} WHERE id = ?`, [Number(id)]) || {}).property : null);
    return ctx.marketOfProperty(prop);
  }
  if (type === CUSTOMER.TYPE) {
    const assigned = Array.isArray(fields[CUSTOMER.PROPERTY]) ? fields[CUSTOMER.PROPERTY] : [];
    for (const p of assigned) {
      const m = ctx.marketOfProperty(p);
      if (!ctx.inScope(m)) return m || "unknown";
    }
    const links = sq.few(`SELECT maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone = ?`, [Number(id)]);
    if (!links.length) return ctx.scope.all ? "unknown" : ctx.scope.marketIds[0] || null;
    for (const l of links) {
      const m = ctx.marketOfProperty(l.property);
      if (ctx.inScope(m)) return m;
    }
    return ctx.marketOfProperty(links[0].property);
  }
  if (type === TOUR.TYPE) {
    const unit = fields[TOUR.UNIT];
    if (!unit) return null;
    const inv = ctx.load().prepared.inventory;
    const u = inv.unitsById.get(String(unit)) || inv.bedroomsById.get(String(unit)) && inv.unitsById.get(inv.bedroomsById.get(String(unit)).unitId);
    return u ? ctx.marketOfProperty(u.propertyId) : null;
  }
  if (type === SAVED_VIEW.TYPE) return ctx.scope.all ? "unknown" : ctx.scope.marketIds[0] || null;
  return null;
}
function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch (e) {
    return {};
  }
}
function readFlag(runtime2, name, dflt) {
  try {
    const v = runtime2.getCurrentScript().getParameter({ name });
    if (v == null || v === "") return dflt;
    return v === true || v === "T" || v === "true";
  } catch (e) {
    return dflt;
  }
}
function safeCache(cacheMod) {
  try {
    return cacheMod.getCache({ name: "amicus_leasing_schema", scope: cacheMod.Scope.PROTECTED });
  } catch (e) {
    return null;
  }
}

// src/server/suitelet.js
var app = null;
function onRequest(context) {
  if (!app) app = createApp({ query: import_query.default, record: import_record.default, runtime: import_runtime.default, log: import_log.default, file: import_file.default, cache: import_cache.default });
  app.handle(context);
}

  if (typeof module.exports.onRequest !== 'function') throw new Error('bundle does not export onRequest');
  return module.exports;
});
