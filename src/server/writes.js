/**
 * §5.9 / §3.9 — the ONLY module that writes records.
 *
 *  - Field-level allowlist per record type; everything else is denied, including by a client that asks nicely.
 *  - Every write is gated by the market resolver on the record's OWN market, recomputed server-side.
 *  - Idempotent and reconcilable: each change carries a client change id and the version it was read at.
 *    A replayed change id returns the stored result; a stale version is rejected with the current values.
 *  - Per-row results; the caller keeps failures dirty and visible.
 *  - Audit: who, when, record, field, before → after, change id.
 *  - Governance: stops before the reserve and returns the rest as 'deferred'.
 *  - Lease Tenants multiselect: pre-screen the whole set against the Property/AY filter, and
 *    capture-and-restore around any Academic Year or Property change (§5.5.1 rules 2 and 3).
 */
import { UAS, UAS_NOTE, LEASE, CUSTOMER, TOUR, TOUR_OUTCOMES, LEAD, LEAD_STATUS_IDS, SAVED_VIEW, AUDIT, GOVERNANCE, foldStage, stageByKey, STAGE_OWNER } from '../shared/constants.js';
import { validateHumanStageChange } from '../shared/rules/stages.js';

/** record type → { create: bool, fields: Set(field ids) } */
export const ALLOWLIST = Object.freeze({
  // create = provisioning a missing unit × AY row (the v2 "provisioning gap"): unit, AY, property and name are creation-only
  [UAS.TYPE]: { create: true, fields: new Set([UAS.STAGE, UAS.MANUAL_STAGE, UAS.STAGE_SOURCE, UAS.STAGE_DATE, UAS.LAST_OFFER, UAS.FOLLOWUP, UAS.EXPECTED_TENANTS, UAS.LEASE_TERMS, UAS.UNIT, UAS.AY, UAS.PROPERTY, 'name']) },
  [UAS_NOTE.TYPE]: { create: true, fields: new Set(['custrecord_ad_note_status', 'custrecord_ad_note_text', 'custrecord_ad_note_date', 'custrecord_ad_note_author', 'custrecord_ad_note_mentions', 'name']) },
  [LEASE.TYPE]: { create: true, fields: new Set([LEASE.UNIT, LEASE.PROPERTY, 'custrecord_serp_lease_type_test', LEASE.START, LEASE.END, LEASE.AY, LEASE.STATUS, 'isinactive', LEASE.TENANTS,
    // creation-only fields (lease dialog): checked in applyCreate, never on update
    'name', 'custrecord_serp_lease_duration_options', LEASE.MONTHLY_RENT, 'custrecord_serp_rent_actual_total', LEASE.TENANT_COUNT, 'custrecord_serp_group_type', 'custrecord_rent_target_per_bed', 'custrecord_serp_watersewer_included', 'custrecord_serp_gaselectric_included', 'custrecord_serp_additional_provisions', 'custrecord_serp_academic_start_date', 'custrecord_academic_end_date']) },
  // create = a new lead from the hub (A-22): the identity fields are creation-only; updates stay limited to the triage fields
  [CUSTOMER.TYPE]: { create: true, fields: new Set(['entitystatus', CUSTOMER.PROPERTY, CUSTOMER.AY, 'custentity12', 'custentity9', 'custentity3', 'custentity_desired_location', 'custentity_serp_notes', 'custentity_serp_howdid_you_hear_about_us', 'custentity_serp_schools', LEAD.UNITS, ...LEAD.CREATE_FIELDS]) },
  [TOUR.TYPE]: { create: true, fields: new Set(['title', 'startdate', 'starttime', 'endtime', 'timedevent', 'accesslevel', 'company', 'organizer', 'location', 'message', 'status', TOUR.UNIT, TOUR.OUTCOME, TOUR.AY]) },
  // App-owned record (§4.2 saved views): not in the §5.9 table, declared here explicitly rather than smuggled in.
  [SAVED_VIEW.TYPE]: { create: true, fields: new Set([SAVED_VIEW.OWNER, SAVED_VIEW.WORKSPACE, SAVED_VIEW.NAME, SAVED_VIEW.JSON, SAVED_VIEW.IS_DEFAULT, SAVED_VIEW.SHARED_MARKETS, 'isinactive', 'name']) },
});
const UAS_CREATE_ONLY = new Set([UAS.UNIT, UAS.AY, UAS.PROPERTY, 'name']);
const CUSTOMER_CREATE_ONLY = new Set(LEAD.CREATE_FIELDS);
const LEASE_UPDATE_FIELDS = new Set([LEASE.UNIT, LEASE.PROPERTY, 'custrecord_serp_lease_type_test', LEASE.START, LEASE.END, LEASE.AY, LEASE.STATUS, 'isinactive', LEASE.TENANTS]);
const TENANT_WIPING_FIELDS = new Set([LEASE.AY, LEASE.PROPERTY]);

/** A multi-value write refused by a single-select field: collapse the offending list to its first value. True when something changed. */
function singleValue(fields, msg) {
  let changed = false;
  for (const f of [TOUR.UNIT, TOUR.AY]) if (Array.isArray(fields[f]) && fields[f].length > 0 && msg.includes(f)) { fields[f] = fields[f][0]; changed = true; }
  return changed;
}
export class WriteError extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); } }

/**
 * createWrites({ record, sq, runtime, log, schema, auth, marketOf, clock })
 *   marketOf(recordType, recordId, fields) → marketId | null  (resolves the record's OWN market)
 *   clock() → ISO timestamp (injected so tests are deterministic)
 */
/** Fields NetSuite stores as dates: the client sends ISO 'YYYY-MM-DD'; record.setValue needs a Date (a string is an INVALID_FLD_VALUE). */
const DATE_FIELDS = new Set([UAS.FOLLOWUP, UAS.STAGE_DATE, LEASE.START, LEASE.END, 'custrecord_ad_note_date', 'custrecord_serp_academic_start_date', 'custrecord_academic_end_date', 'custrecord_serp_lease_sent_date', 'custrecord_effective_date', 'startdate', 'custentity9']);
const TIME_FIELDS = new Set(['starttime', 'endtime']);
/** "HH:MM" on a given ISO date → a local Date carrying that time of day (NetSuite time-of-day fields take a Date). */
export function localTime(hm, isoDate) { if (hm instanceof Date) return hm; const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || '')); if (!m) return hm; const d = localDate(isoDate || '1970-01-01'); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2])); }
export function localDate(v) {
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : v;
}
function nsValue(field, v, ctxDate = null) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(Number);
  if (DATE_FIELDS.has(field)) return localDate(v);
  if (TIME_FIELDS.has(field)) return localTime(v, ctxDate);
  return v;
}

/**
 * createWrites({ record, sq, runtime, log, schema, auth, marketOf, clock, stageIdFor })
 *   stageIdFor(stageKey) → list value internal id | null   (from the schema probe; the board never sends ids)
 */
export function createWrites({ record, sq, runtime, log, schema, auth, marketOf, clock = () => new Date().toISOString(), stageIdFor = null, outcomeIdFor = null, tourFields = null, defaultSubsidiaryId = null, findByEmail = null, stageOf = null, notify = null }) {
  const auditAvailable = () => { try { return schema.probe(AUDIT.TYPE, [AUDIT.CHANGE_ID]).get(AUDIT.CHANGE_ID) !== false; } catch (e) { return false; } };

  function remaining() { try { return runtime.getCurrentScript().getRemainingUsage(); } catch (e) { return Infinity; } }
  function priorResult(changeId) {
    if (!auditAvailable()) return null;
    const row = sq.one(`SELECT ${AUDIT.RECORD_TYPE} AS rt, ${AUDIT.RECORD_ID} AS rid, ${AUDIT.AFTER} AS after FROM ${AUDIT.TYPE} WHERE ${AUDIT.CHANGE_ID} = ? AND ROWNUM <= 1`, [String(changeId)]);
    return row ? { ok: true, replayed: true, recordType: row.rt, recordId: String(row.rid) } : null;
  }
  function audit(scope, change, recordId, field, before, after) {
    const entry = { who: scope.userId, when: clock(), recordType: change.recordType, recordId: String(recordId), field, before: ser(before), after: ser(after), changeId: change.changeId };
    if (!auditAvailable()) { log.audit({ title: 'write (audit record missing)', details: JSON.stringify(entry) }); return 'log-only'; }
    const r = record.create({ type: AUDIT.TYPE });
    r.setValue({ fieldId: AUDIT.WHO, value: entry.who }); r.setValue({ fieldId: AUDIT.WHEN, value: new Date(entry.when) }); // Date/Time field: a Date object, never an ISO string r.setValue({ fieldId: AUDIT.RECORD_TYPE, value: entry.recordType });
    r.setValue({ fieldId: AUDIT.RECORD_ID, value: entry.recordId }); r.setValue({ fieldId: AUDIT.FIELD, value: field }); r.setValue({ fieldId: AUDIT.BEFORE, value: entry.before }); r.setValue({ fieldId: AUDIT.AFTER, value: entry.after }); r.setValue({ fieldId: AUDIT.CHANGE_ID, value: entry.changeId });
    r.save(); return 'record';
  }
  const ser = (v) => (v == null ? null : Array.isArray(v) ? v.join(',') : String(v));

  /**
   * A new lead (A-22): the same record the public Lead Form creates — a person at Tenant-New in the Lead Form's subsidiary —
   * plus the owning agent on Sales Rep. A name or an email is required; an active customer with the same email is reported
   * as DUPLICATE with its id instead of being created twice.
   */
  function prepareLead(change, fields) {
    const name = `${fields.firstname || ''} ${fields.lastname || ''}`.trim();
    if (!name && !fields.email) throw new WriteError('BAD_CHANGE', 'a lead needs a name or an email');
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.email))) throw new WriteError('BAD_CHANGE', 'the email address does not look valid', { field: 'email' });
    if (fields.email && findByEmail) { const hits = findByEmail(fields.email); if (hits.length) throw new WriteError('DUPLICATE', `${[hits[0].firstname, hits[0].lastname].filter(Boolean).join(' ') || 'A customer'} already has this email (customer #${hits[0].id})`, { field: 'email', existingId: String(hits[0].id) }); }
    fields.isperson = 'T'; // a radio field on the entity record: NetSuite rejects a boolean here ("Invalid Field Value true")
    if (fields.entitystatus == null || fields.entitystatus === '') fields.entitystatus = LEAD.STATUS_NEW;
    if (Object.prototype.hasOwnProperty.call(fields, LEAD.UNITS)) { let have = true; try { have = schema.probe(CUSTOMER.TYPE, [LEAD.UNITS]).get(LEAD.UNITS) !== false; } catch (e) { have = true; } if (!have) { delete fields[LEAD.UNITS]; change.dropped = [...(change.dropped || []), LEAD.UNITS]; } }
    if (fields.subsidiary == null || fields.subsidiary === '') { const sub = defaultSubsidiaryId ? defaultSubsidiaryId() : null; if (!sub) throw new WriteError('BAD_CHANGE', `the lead subsidiary "${LEAD.SUBSIDIARY_NAME}" was not found`); fields.subsidiary = sub; }
    if (fields.salesrep == null || fields.salesrep === '') { const u = runtime.getCurrentUser(); if (u && u.id) fields.salesrep = Number(u.id); }
    if (fields.custentity_serp_group_size != null && fields.custentity_serp_group_size !== '' && !(Number(fields.custentity_serp_group_size) >= 0)) throw new WriteError('BAD_CHANGE', 'group size must be a number', { field: 'custentity_serp_group_size' });
  }
  /**
   * A tour (§5.6) is an Event on the organiser's calendar. Defaults: organiser = the signed-in agent, status Confirmed,
   * public access, "Reserve time" on when a start time is given, end = start + 30 min. The outcome arrives as a key and is
   * mapped to the list value id. The three custom fields are dropped (and reported) when they do not exist yet.
   */
  function prepareTour(change, fields, isCreate) {
    if (isCreate && !fields.startdate) throw new WriteError('BAD_CHANGE', 'a tour needs a date', { field: 'startdate' });
    if (isCreate && !fields.title) fields.title = TOUR.TITLE_PREFIX;
    if (isCreate && (fields.organizer == null || fields.organizer === '')) { const u = runtime.getCurrentUser(); if (u && u.id) fields.organizer = Number(u.id); }
    if (isCreate && !fields.status) fields.status = TOUR.STATUS.CONFIRMED;
    if (isCreate && !fields.accesslevel) fields.accesslevel = 'PUBLIC';
    if (fields.starttime) { fields.timedevent = true; if (!fields.endtime) { const [h, m] = String(fields.starttime).split(':').map(Number); const t = h * 60 + m + TOUR.DEFAULT_MINUTES; fields.endtime = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; } }
    if (Object.prototype.hasOwnProperty.call(fields, TOUR.OUTCOME) && fields[TOUR.OUTCOME] !== '' && fields[TOUR.OUTCOME] != null && !/^\d+$/.test(String(fields[TOUR.OUTCOME]))) {
      const key = String(fields[TOUR.OUTCOME]).toUpperCase(); if (!TOUR_OUTCOMES.some((o) => o.key === key)) throw new WriteError('BAD_CHANGE', `unknown tour outcome ${fields[TOUR.OUTCOME]}`, { field: TOUR.OUTCOME });
      const id = outcomeIdFor ? outcomeIdFor(key) : null;
      if (!id) throw new WriteError('OUTCOME_NO_LIST_VALUE', `the outcome "${key}" has no value in the tour outcome list yet (see SETUP-CHECKLIST)`, { field: TOUR.OUTCOME });
      fields[TOUR.OUTCOME] = id; change.outcomeKey = key;
      if (key === 'CANCELLED') fields.status = TOUR.STATUS.CANCELLED;
    }
    const have = tourFields ? tourFields() : { unit: true, outcome: true, ay: true };
    const dropped = [];
    for (const [f, ok] of [[TOUR.UNIT, have.unit], [TOUR.OUTCOME, have.outcome], [TOUR.AY, have.ay]]) if (!ok && Object.prototype.hasOwnProperty.call(fields, f)) { dropped.push(f); delete fields[f]; }
    if (dropped.length) change.dropped = dropped;
    change.tourDate = fields.startdate || null;
  }
  /**
   * A tour moves a LEAD-stage record along: scheduling one takes New / In Contact to Tour Scheduled; a Completed outcome
   * takes Tour Scheduled to Tour Completed. Tenants are never touched. Returns the new status id or null.
   */
  function advanceLead(scope, change, fields, isCreate) {
    const company = fields.company ?? change.company; if (!company || !stageOf) return null;
    const target = isCreate ? LEAD.STATUS_TOUR_SCHEDULED : change.outcomeKey === 'COMPLETED' ? LEAD.STATUS_TOUR_COMPLETED : null;
    if (!target) return null;
    let cur = null; try { cur = stageOf(company); } catch (e) { return null; }
    if (!cur || String(cur.stage).toUpperCase() !== LEAD.STAGE) return null;
    const from = Number(cur.entitystatus);
    const allowed = target === LEAD.STATUS_TOUR_SCHEDULED ? [LEAD.STATUS_NEW, LEAD.STATUS_IN_CONTACT] : [LEAD.STATUS_TOUR_SCHEDULED, LEAD.STATUS_NEW, LEAD.STATUS_IN_CONTACT];
    if (!allowed.includes(from)) return null;
    try {
      const rec = record.load({ type: CUSTOMER.TYPE, id: Number(company) }); rec.setValue({ fieldId: 'entitystatus', value: target }); rec.save();
      audit(scope, { changeId: `${change.changeId}:lead`, recordType: CUSTOMER.TYPE }, company, 'entitystatus', from, target);
      return target;
    } catch (e) { log && log.error && log.error({ title: 'lead status step failed', details: `${company}: ${e && e.message}` }); return null; }
  }
  function validateChange(change) {
    if (!change || typeof change !== 'object') throw new WriteError('BAD_CHANGE', 'change is not an object');
    if (!change.changeId || String(change.changeId).length > 80) throw new WriteError('BAD_CHANGE', 'changeId is required');
    const rule = ALLOWLIST[change.recordType];
    if (!rule) throw new WriteError('DENIED_RECORD', `writes to ${change.recordType} are not allowed`);
    const isCreate = change.recordId == null;
    if (isCreate && !rule.create) throw new WriteError('DENIED_CREATE', `creating ${change.recordType} is not allowed`);
    const fields = change.fields || {};
    for (const f of Object.keys(fields)) {
      if (!rule.fields.has(f)) throw new WriteError('DENIED_FIELD', `field ${f} on ${change.recordType} is not allowed`, { field: f });
      if (!isCreate && change.recordType === LEASE.TYPE && !LEASE_UPDATE_FIELDS.has(f)) throw new WriteError('DENIED_FIELD', `field ${f} may only be set when creating a lease`, { field: f });
      if (!isCreate && change.recordType === UAS.TYPE && UAS_CREATE_ONLY.has(f)) throw new WriteError('DENIED_FIELD', `field ${f} may only be set when provisioning a status row`, { field: f });
      if (!isCreate && change.recordType === CUSTOMER.TYPE && CUSTOMER_CREATE_ONLY.has(f)) throw new WriteError('DENIED_FIELD', `field ${f} may only be set when creating a lead; edit the customer record for changes`, { field: f });
    }
    if (change.recordType === CUSTOMER.TYPE && isCreate) prepareLead(change, fields);
    if (change.recordType === TOUR.TYPE) prepareTour(change, fields, isCreate);
    if (change.recordType === UAS.TYPE && isCreate && (!fields[UAS.UNIT] || !fields[UAS.AY])) throw new WriteError('BAD_CHANGE', 'a status row needs a unit and an academic year');
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      const v = validateHumanStageChange(fields[UAS.STAGE]);
      if (!v.ok) throw new WriteError('STAGE_LEASE_DRIVEN', v.reason, { field: UAS.STAGE });
      // The client sends a stage key or label; NetSuite wants the list value id ("No stage set" clears the field).
      change.stageKey = v.key;
      if (v.key === 'NONE') fields[UAS.STAGE] = '';
      else if (stageIdFor) { const id = stageIdFor(v.key); if (!id) throw new WriteError('STAGE_NO_LIST_VALUE', `the stage "${stageByKey(v.key).label}" has no value in the leasing-stage list yet (see SETUP-CHECKLIST)`, { field: UAS.STAGE }); fields[UAS.STAGE] = id; }
      if (Object.prototype.hasOwnProperty.call(fields, UAS.STAGE_SOURCE) && String(fields[UAS.STAGE_SOURCE]) !== 'manual' && String(fields[UAS.STAGE_SOURCE]) !== '1') throw new WriteError('STAGE_LEASE_DRIVEN', 'the board may only set a manual stage source');
    }
    if (change.recordType === LEASE.TYPE && !isCreate && fields.isinactive === false) throw new WriteError('DENIED_FIELD', 'reactivating a lease is not supported here');
    if (Object.keys(fields).length === 0) throw new WriteError('BAD_CHANGE', 'no fields');
    return { isCreate, fields };
  }

  // ---- lease tenants: pre-screen + capture/restore (§5.5.1) ----
  function tenantFilterOk(leaseProperty, leaseAy, tenantIds) {
    if (!tenantIds.length) return { ok: true, bad: [] };
    const props = sq.inChunks(tenantIds, (c) => sq.few(`SELECT mapone AS customer, maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone IN (${c.map(Number).join(',')})`));
    const ays = sq.inChunks(tenantIds, (c) => sq.few(`SELECT mapone AS customer, maptwo AS ay FROM ${CUSTOMER.AY_MAP} WHERE mapone IN (${c.map(Number).join(',')})`));
    const bad = [];
    for (const t of tenantIds) {
      const hasP = props.some((r) => String(r.customer) === String(t) && String(r.property) === String(leaseProperty));
      const hasA = ays.some((r) => String(r.customer) === String(t) && String(r.ay) === String(leaseAy));
      if (!hasP || !hasA) bad.push({ tenantId: String(t), missingProperty: !hasP, missingAy: !hasA });
    }
    return { ok: bad.length === 0, bad };
  }
  function currentTenants(leaseId) { return sq.few(`SELECT maptwo AS customer FROM MAP_customrecord_serp_lease_record_custrecord_serp_tenants_ WHERE mapone = ?`, [Number(leaseId)]).map((r) => String(r.customer)).sort(); }

  function versionOf(type, id) {
    const col = type === CUSTOMER.TYPE || type === TOUR.TYPE ? 'lastmodifieddate' : 'lastmodified';
    try { const r = sq.one(`SELECT ${col} AS v FROM ${type} WHERE id = ?`, [Number(id)]); return r ? r.v : null; } catch (e) { return null; }
  }
  function applyUpdate(scope, change, fields) {
    const rec = record.load({ type: change.recordType, id: change.recordId });
    const before = {}; for (const f of Object.keys(fields)) before[f] = rec.getValue({ fieldId: f });
    if (change.recordType === TOUR.TYPE) { try { change.company = rec.getValue({ fieldId: 'company' }); } catch (e) { change.company = null; } }
    if (change.version != null && change.version !== '') {
      // Same read on both sides: the client's version came from SuiteQL, so compare against SuiteQL, not record.getValue's Date.
      const lm = versionOf(change.recordType, change.recordId) ?? (rec.getValue({ fieldId: 'lastmodified' }) || rec.getValue({ fieldId: 'lastmodifieddate' }) || null);
      if (lm != null && !sameVersion(lm, change.version)) throw new WriteError('STALE', 'record changed since it was read — reload the tab', { current: before, version: String(lm) });
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
        if (!screen.ok) throw new WriteError('TENANT_FILTER', 'one or more tenants do not match the lease Property/Academic Year; nothing was written', { bad: screen.bad });
      }
    }
    for (const [f, v] of Object.entries(fields)) rec.setValue({ fieldId: f, value: nsValue(f, v, change.tourDate || before.startdate || null) });
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      rec.setValue({ fieldId: UAS.MANUAL_STAGE, value: nsValue(UAS.MANUAL_STAGE, fields[UAS.STAGE]) }); rec.setValue({ fieldId: UAS.STAGE_SOURCE, value: 1 }); rec.setValue({ fieldId: UAS.STAGE_DATE, value: change.stageKey === 'NONE' ? '' : localDate(clock().slice(0, 10)) });
    }
    try { rec.save(); }
    catch (e) {
      if (change.recordType === TOUR.TYPE && singleValue(fields, String((e && e.message) || e))) { const again = record.load({ type: change.recordType, id: change.recordId }); for (const [f, v] of Object.entries(fields)) again.setValue({ fieldId: f, value: nsValue(f, v, change.tourDate || null) }); again.save(); change.singleValued = true; }
      else throw e;
    }
    let restored = null;
    if (captured) {
      // NetSuite re-sources the filtered multiselect on save and may drop values: verify and write back (§5.5.1 rule 3)
      const after = currentTenants(change.recordId);
      if (after.join(',') !== captured.join(',')) {
        const again = record.load({ type: LEASE.TYPE, id: change.recordId });
        again.setValue({ fieldId: LEASE.TENANTS, value: captured.map(Number) }); again.save();
        const verify = currentTenants(change.recordId);
        restored = { dropped: captured.filter((t) => !after.includes(t)), restoredOk: verify.join(',') === captured.join(','), final: verify };
        if (!restored.restoredOk) throw new WriteError('TENANTS_LOST', 'Tenants were dropped by NetSuite on save and could not be restored', restored);
      } else restored = { dropped: [], restoredOk: true, final: after };
    }
    const auditMode = [];
    for (const f of Object.keys(fields)) auditMode.push(audit(scope, change, change.recordId, f, before[f], fields[f]));
    return { ok: true, recordType: change.recordType, recordId: String(change.recordId), before, after: fields, tenants: restored, audit: auditMode[0], ...(change.dropped ? { dropped: change.dropped } : {}), ...(change.singleValued ? { singleValued: true } : {}) };
  }
  function applyCreate(scope, change, fields) {
    if (change.recordType === LEASE.TYPE && fields[LEASE.TENANTS]) {
      const screen = tenantFilterOk(fields[LEASE.PROPERTY], fields[LEASE.AY], fields[LEASE.TENANTS].map(String));
      if (!screen.ok) throw new WriteError('TENANT_FILTER', 'tenants do not match the lease Property/Academic Year', { bad: screen.bad });
    }
    // A customer at a LEAD-stage status is created as NetSuite's Lead record (same entity table, stage LEAD).
    const type = change.recordType === CUSTOMER.TYPE && LEAD_STATUS_IDS.has(Number(fields.entitystatus)) ? 'lead' : change.recordType;
    const build = (fs) => {
      const rec = record.create({ type, isDynamic: false });
      for (const [f, v] of Object.entries(fs)) rec.setValue({ fieldId: f, value: nsValue(f, v, change.tourDate || null) });
      if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fs, UAS.STAGE)) { rec.setValue({ fieldId: UAS.MANUAL_STAGE, value: nsValue(UAS.MANUAL_STAGE, fs[UAS.STAGE]) }); rec.setValue({ fieldId: UAS.STAGE_SOURCE, value: 1 }); rec.setValue({ fieldId: UAS.STAGE_DATE, value: change.stageKey === 'NONE' ? '' : localDate(clock().slice(0, 10)) }); }
      return rec;
    };
    let id;
    try { id = build(fields).save(); }
    catch (e) {
      const msg = String((e && e.message) || e);
      // The agent is not flagged as a Sales Rep on their employee record: save the lead without the owner rather than fail.
      if (change.recordType === CUSTOMER.TYPE && fields.salesrep && /sales ?rep/i.test(msg)) { delete fields.salesrep; change.dropped = [...(change.dropped || []), 'salesrep']; id = build(fields).save(); }
      // The tour's unit / AY field was created single-select: keep the first value (the full list is still in the notes tag).
      else if (change.recordType === TOUR.TYPE && singleValue(fields, msg)) { id = build(fields).save(); change.singleValued = true; }
      else throw e;
    }
    audit(scope, change, id, '*create*', null, JSON.stringify(fields));
    return { ok: true, created: true, recordType: change.recordType, recordId: String(id), after: fields, ...(change.dropped ? { dropped: change.dropped } : {}), ...(change.singleValued ? { singleValued: true } : {}) };
  }

  /**
   * apply(changes[], scope) → { results: [{changeId, ok, …}], deferred: [changeId…] }
   * Never throws for a per-row problem; the row's result carries code + message.
   */
  function apply(changes, scope) {
    const results = [], deferred = [];
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (remaining() < GOVERNANCE.RESERVE) { deferred.push(...changes.slice(i).map((c) => c && c.changeId)); break; }
      try {
        const prior = priorResult(change && change.changeId);
        if (prior) { results.push({ changeId: change.changeId, ...prior }); continue; }
        const { isCreate, fields } = validateChange(change);
        // '$prev' links a change to the record the previous change in this batch created (a note on a freshly provisioned status row)
        for (const [f, v] of Object.entries(fields)) if (v === '$prev') { const prev = results[results.length - 1]; if (!prev || !prev.ok || !prev.recordId) throw new WriteError('BAD_CHANGE', `${f} refers to the previous change, which did not create a record`); fields[f] = Number(prev.recordId); }
        const market = marketOf(change.recordType, change.recordId, fields);
        if (!auth.can(scope, market)) throw new WriteError('DENIED_MARKET', `record is in market "${market || 'unknown'}" which is outside your scope`);
        const r = isCreate ? applyCreate(scope, change, fields) : applyUpdate(scope, change, fields);
        if (change.recordType === TOUR.TYPE) { const step = advanceLead(scope, change, fields, isCreate); if (step) r.leadStatus = step; }
        if (change.recordType === UAS_NOTE.TYPE && isCreate && notify && Array.isArray(fields.custrecord_ad_note_mentions) && fields.custrecord_ad_note_mentions.length) { try { r.notified = notify({ scope, mentions: fields.custrecord_ad_note_mentions, note: fields, recordId: r.recordId }); } catch (e) { log && log.error && log.error({ title: 'mention notify failed', details: e && e.message }); r.notified = false; } }
        results.push({ changeId: change.changeId, ...r });
      } catch (e) {
        const code = e instanceof WriteError ? e.code : 'ERROR';
        log && log.error && log.error({ title: `write failed ${code}`, details: `${change && change.changeId}: ${e && e.message}` });
        results.push({ changeId: change && change.changeId, ok: false, code, message: e && e.message, ...pick(e, ['field', 'current', 'version', 'bad', 'dropped', 'final', 'existingId']) });
      }
    }
    return { results, deferred };
  }
  return { apply, validateChange, ALLOWLIST, tenantFilterOk };
}
/** Versions are modified stamps in whatever form the read produced (SuiteQL text, ISO, Date). Equal when they name the same day and, if both carry a time, the same minute. */
export function sameVersion(a, b) {
  const norm = (v) => { if (v == null) return null; const s = v instanceof Date ? v.toISOString() : String(v); const iso = localDate(s) instanceof Date ? localDate(s) : null; let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s); if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null }; m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap]m)?)?/i.exec(s); if (m) { let h = m[4] ? Number(m[4]) : null; if (h != null && m[6]) { const pm = m[6].toLowerCase() === 'pm'; h = (h % 12) + (pm ? 12 : 0); } return { day: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, time: h == null ? null : `${String(h).padStart(2, '0')}:${m[5]}` }; } void iso; return { day: s, time: null }; };
  const x = norm(a), y = norm(b);
  if (!x || !y) return true;
  if (x.day !== y.day) return false;
  return !x.time || !y.time || x.time === y.time;
}
function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k]; return out; }
