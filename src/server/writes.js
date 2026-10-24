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
import { UAS, UAS_NOTE, LEASE, CUSTOMER, TOUR, SAVED_VIEW, AUDIT, GOVERNANCE, foldStage, stageByKey, STAGE_OWNER } from '../shared/constants.js';
import { validateHumanStageChange } from '../shared/rules/stages.js';

/** record type → { create: bool, fields: Set(field ids) } */
export const ALLOWLIST = Object.freeze({
  // create = provisioning a missing unit × AY row (the v2 "provisioning gap"): unit, AY, property and name are creation-only
  [UAS.TYPE]: { create: true, fields: new Set([UAS.STAGE, UAS.MANUAL_STAGE, UAS.STAGE_SOURCE, UAS.STAGE_DATE, UAS.LAST_OFFER, UAS.FOLLOWUP, UAS.EXPECTED_TENANTS, UAS.LEASE_TERMS, UAS.UNIT, UAS.AY, UAS.PROPERTY, 'name']) },
  [UAS_NOTE.TYPE]: { create: true, fields: new Set(['custrecord_ad_note_status', 'custrecord_ad_note_text', 'custrecord_ad_note_date', 'custrecord_ad_note_author', 'custrecord_ad_note_mentions', 'name']) },
  [LEASE.TYPE]: { create: true, fields: new Set([LEASE.UNIT, LEASE.PROPERTY, 'custrecord_serp_lease_type_test', LEASE.START, LEASE.END, LEASE.AY, LEASE.STATUS, 'isinactive', LEASE.TENANTS,
    // creation-only fields (lease dialog): checked in applyCreate, never on update
    'name', 'custrecord_serp_lease_duration_options', LEASE.MONTHLY_RENT, 'custrecord_serp_rent_actual_total', LEASE.TENANT_COUNT, 'custrecord_serp_group_type', 'custrecord_rent_target_per_bed', 'custrecord_serp_watersewer_included', 'custrecord_serp_gaselectric_included', 'custrecord_serp_additional_provisions', 'custrecord_serp_academic_start_date', 'custrecord_academic_end_date']) },
  [CUSTOMER.TYPE]: { create: false, fields: new Set(['entitystatus', CUSTOMER.PROPERTY, CUSTOMER.AY, 'custentity12', 'custentity9', 'custentity3', 'custentity_desired_location', 'custentity_serp_notes', 'custentity_serp_howdid_you_hear_about_us', 'custentity_serp_schools']) },
  [TOUR.TYPE]: { create: true, fields: new Set(['title', 'startdate', 'starttime', 'endtime', 'company', 'organizer', 'location', 'message', 'status', TOUR.UNIT, TOUR.OUTCOME, TOUR.AY]) },
  // App-owned record (§4.2 saved views): not in the §5.9 table, declared here explicitly rather than smuggled in.
  [SAVED_VIEW.TYPE]: { create: true, fields: new Set([SAVED_VIEW.OWNER, SAVED_VIEW.WORKSPACE, SAVED_VIEW.NAME, SAVED_VIEW.JSON, SAVED_VIEW.IS_DEFAULT, SAVED_VIEW.SHARED_MARKETS, 'isinactive', 'name']) },
});
const UAS_CREATE_ONLY = new Set([UAS.UNIT, UAS.AY, UAS.PROPERTY, 'name']);
const LEASE_UPDATE_FIELDS = new Set([LEASE.UNIT, LEASE.PROPERTY, 'custrecord_serp_lease_type_test', LEASE.START, LEASE.END, LEASE.AY, LEASE.STATUS, 'isinactive', LEASE.TENANTS]);
const TENANT_WIPING_FIELDS = new Set([LEASE.AY, LEASE.PROPERTY]);

export class WriteError extends Error { constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); } }

/**
 * createWrites({ record, sq, runtime, log, schema, auth, marketOf, clock })
 *   marketOf(recordType, recordId, fields) → marketId | null  (resolves the record's OWN market)
 *   clock() → ISO timestamp (injected so tests are deterministic)
 */
export function createWrites({ record, sq, runtime, log, schema, auth, marketOf, clock = () => new Date().toISOString() }) {
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
    r.setValue({ fieldId: AUDIT.WHO, value: entry.who }); r.setValue({ fieldId: AUDIT.WHEN, value: entry.when }); r.setValue({ fieldId: AUDIT.RECORD_TYPE, value: entry.recordType });
    r.setValue({ fieldId: AUDIT.RECORD_ID, value: entry.recordId }); r.setValue({ fieldId: AUDIT.FIELD, value: field }); r.setValue({ fieldId: AUDIT.BEFORE, value: entry.before }); r.setValue({ fieldId: AUDIT.AFTER, value: entry.after }); r.setValue({ fieldId: AUDIT.CHANGE_ID, value: entry.changeId });
    r.save(); return 'record';
  }
  const ser = (v) => (v == null ? null : Array.isArray(v) ? v.join(',') : String(v));

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
    }
    if (change.recordType === UAS.TYPE && isCreate && (!fields[UAS.UNIT] || !fields[UAS.AY])) throw new WriteError('BAD_CHANGE', 'a status row needs a unit and an academic year');
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      const v = validateHumanStageChange(fields[UAS.STAGE]);
      if (!v.ok) throw new WriteError('STAGE_LEASE_DRIVEN', v.reason, { field: UAS.STAGE });
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

  function applyUpdate(scope, change, fields) {
    const rec = record.load({ type: change.recordType, id: change.recordId });
    const before = {}; for (const f of Object.keys(fields)) before[f] = rec.getValue({ fieldId: f });
    if (change.version != null) {
      const lm = rec.getValue({ fieldId: 'lastmodified' }) || rec.getValue({ fieldId: 'lastmodifieddate' });
      if (lm && String(lm) !== String(change.version)) throw new WriteError('STALE', 'record changed since it was read', { current: before, version: String(lm) });
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
    for (const [f, v] of Object.entries(fields)) rec.setValue({ fieldId: f, value: Array.isArray(v) ? v.map(Number) : v });
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) {
      rec.setValue({ fieldId: UAS.MANUAL_STAGE, value: fields[UAS.STAGE] }); rec.setValue({ fieldId: UAS.STAGE_SOURCE, value: 1 }); rec.setValue({ fieldId: UAS.STAGE_DATE, value: clock().slice(0, 10) });
    }
    rec.save();
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
    return { ok: true, recordType: change.recordType, recordId: String(change.recordId), before, after: fields, tenants: restored, audit: auditMode[0] };
  }
  function applyCreate(scope, change, fields) {
    if (change.recordType === LEASE.TYPE && fields[LEASE.TENANTS]) {
      const screen = tenantFilterOk(fields[LEASE.PROPERTY], fields[LEASE.AY], fields[LEASE.TENANTS].map(String));
      if (!screen.ok) throw new WriteError('TENANT_FILTER', 'tenants do not match the lease Property/Academic Year', { bad: screen.bad });
    }
    const rec = record.create({ type: change.recordType, isDynamic: false });
    for (const [f, v] of Object.entries(fields)) rec.setValue({ fieldId: f, value: Array.isArray(v) ? v.map(Number) : v });
    if (change.recordType === UAS.TYPE && Object.prototype.hasOwnProperty.call(fields, UAS.STAGE)) { rec.setValue({ fieldId: UAS.MANUAL_STAGE, value: fields[UAS.STAGE] }); rec.setValue({ fieldId: UAS.STAGE_SOURCE, value: 1 }); rec.setValue({ fieldId: UAS.STAGE_DATE, value: clock().slice(0, 10) }); }
    const id = rec.save();
    audit(scope, change, id, '*create*', null, JSON.stringify(fields));
    return { ok: true, created: true, recordType: change.recordType, recordId: String(id), after: fields };
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
        results.push({ changeId: change.changeId, ...r });
      } catch (e) {
        const code = e instanceof WriteError ? e.code : 'ERROR';
        log && log.error && log.error({ title: `write failed ${code}`, details: `${change && change.changeId}: ${e && e.message}` });
        results.push({ changeId: change && change.changeId, ok: false, code, message: e && e.message, ...pick(e, ['field', 'current', 'version', 'bad', 'dropped', 'final']) });
      }
    }
    return { results, deferred };
  }
  return { apply, validateChange, ALLOWLIST, tenantFilterOk };
}
function pick(o, keys) { const out = {}; for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k]; return out; }
