/**
 * Lease-change executor (docs/LEASE-CHANGES-BUILD.md). Turns a plan from shared/rules/leaseChange.js into allowlisted
 * writes, and keeps the Lease Amendment row in step. One code path for the Suitelet (the hub's "Change lease") and the
 * Workflow Action Script that applies a signed amendment (src/server/wa_apply_amend.js).
 *
 * Idempotent: every write carries a change id derived from the amendment (or the request) and the step number, so an
 * apply that stopped half way (governance, a NetSuite error) can be run again and replays the finished steps.
 * Degrades: a list value or chain field that does not exist yet is left out and reported, never guessed.
 */
import { LEASE, LEASE_CHAIN, AMEND, CUSTOMER, UAS } from '../shared/constants.js';
import { AMEND_TYPES, AMEND_STATUSES, END_REASONS, keyFromLabel, canApply, planChange, scenarioByKey } from '../shared/rules/leaseChange.js';
import { normalizeLease } from '../shared/rules/lease.js';

const GROUP_KEYS = [{ key: 'NEW', label: 'New Group' }, { key: 'TRANSFER', label: 'Transfers' }, { key: 'RENEWAL', label: 'Renewal' }, { key: 'AMENDMENT', label: 'Amendment' }];
const LEASE_TYPE_KEYS = [{ key: 'WH', label: 'Whole House' }, { key: 'UNIT', label: 'Unit' }, { key: 'BED', label: 'Bedroom' }];

export function createLeaseChange({ sq, writes, log, clock = () => new Date().toISOString(), applyOnApproval = false }) {
  let idsCache = null; const fieldCache = new Map();
  function listMap(table, keys) { const out = {}; try { for (const r of sq.few(`SELECT id, name FROM ${table} WHERE isinactive = 'F'`)) { const k = keyFromLabel(r.name, keys) || (keys === LEASE_TYPE_KEYS ? leaseTypeGuess(r.name) : null); if (k && !out[k]) out[k] = Number(r.id); } } catch (e) { return null; } return out; }
  /** List value ids by key; null for a list that does not exist yet. */
  function ids() {
    if (idsCache) return idsCache;
    let released = null; try { const r = sq.one(`SELECT key AS id FROM entitystatus WHERE LOWER(name) = ? AND inactive = 'F'`, [LEASE_CHAIN.RELEASED_STATUS.toLowerCase()]); released = r ? Number(r.id) : null; } catch (e) { released = null; }
    idsCache = { type: listMap(AMEND.TYPE_LIST, AMEND_TYPES), status: listMap(AMEND.STATUS_LIST, AMEND_STATUSES), endReason: listMap(AMEND.END_REASON_LIST, END_REASONS), group: listMap(LEASE_CHAIN.GROUP_TYPE_LIST, GROUP_KEYS), leaseType: listMap('customlist_serp_lease_type_list', LEASE_TYPE_KEYS), released };
    return idsCache;
  }
  function hasField(table, field) { const k = `${table}.${field}`; if (!fieldCache.has(k)) { let ok = true; try { sq.few(`SELECT ${field} FROM ${table} WHERE ROWNUM <= 1`); } catch (e) { ok = false; } fieldCache.set(k, ok); } return fieldCache.get(k); }
  function amendReady() { return hasField(AMEND.TYPE, AMEND.PLAN) && !!ids().status; }

  /** A lease read fresh (the apply script has no engine), normalized the same way the reports see it. */
  function loadLease(id) {
    const chain = [[LEASE_CHAIN.SUPERSEDES, 'supersedes'], [LEASE_CHAIN.VERSION, 'version'], [LEASE_CHAIN.PROVISIONS, 'provisions']].filter(([f]) => hasField(LEASE.TYPE, f));
    const endReason = hasField(LEASE.TYPE, LEASE_CHAIN.END_REASON) ? `, BUILTIN.DF(${LEASE_CHAIN.END_REASON}) AS end_reason_name` : '';
    const r = sq.one(`SELECT id, name, isinactive, ${LEASE.PROPERTY} AS property, ${LEASE.UNIT} AS unit, ${LEASE_CHAIN.TYPE} AS lease_type, BUILTIN.DF(${LEASE_CHAIN.TYPE}) AS lease_type_name, ${LEASE.STATUS} AS status, BUILTIN.DF(${LEASE.STATUS}) AS status_name, ${LEASE.AY} AS ay, ${LEASE.START} AS start_date, ${LEASE.END} AS end_date, ${LEASE.MONTHLY_RENT} AS monthly_rent, ${LEASE_CHAIN.TOTAL} AS total_rent, ${LEASE.TENANTS} AS tenants, custrecord_serp_lease_sent_date AS sent_date, lastmodified${chain.map(([f, a]) => `, ${f} AS ${a}`).join('')}${endReason} FROM ${LEASE.TYPE} WHERE id = ?`, [Number(id)]);
    if (!r) return null;
    const tenants = sq.few(`SELECT maptwo AS customer FROM ${LEASE.TENANTS_MAP} WHERE mapone = ?`, [Number(id)]).map((x) => String(x.customer));
    const l = normalizeLease({ ...r, tenants: tenants.join(',') }, {});
    l.ayFieldRaw = r.ay != null ? String(r.ay) : null; l.statusRaw = r.status ?? null;
    return l;
  }

  // ---------------- steps → writes ----------------
  function leaseFields(f, refs, warn) {
    const out = {}; const I = ids();
    const set = (field, v, table = LEASE.TYPE) => { if (table === LEASE.TYPE && [LEASE_CHAIN.SUPERSEDES, LEASE_CHAIN.VERSION, LEASE_CHAIN.END_REASON].includes(field) && !hasField(LEASE.TYPE, field)) { warn(`field ${field} is not on the Lease record yet; left out`); return; } out[field] = v; };
    for (const [k, v] of Object.entries(f)) {
      if (k === 'start') set(LEASE.START, v); else if (k === 'end') set(LEASE.END, v);
      else if (k === 'monthly') set(LEASE.MONTHLY_RENT, v); else if (k === 'total') { if (v != null) set(LEASE_CHAIN.TOTAL, v); }
      else if (k === 'months') { if (v != null) set(LEASE_CHAIN.MONTHS, v); }
      else if (k === 'tenants') set(LEASE.TENANTS, v.map(String)); else if (k === 'tenantCount') set(LEASE.TENANT_COUNT, v);
      else if (k === 'provisions') set(LEASE_CHAIN.PROVISIONS, v);
      else if (k === 'inactive') { if (v) set('isinactive', true); }
      else if (k === 'version') set(LEASE_CHAIN.VERSION, v);
      else if (k === 'supersedes') set(LEASE_CHAIN.SUPERSEDES, Number(refs[v] || v));
      else if (k === 'endReason') { const id = I.endReason && I.endReason[v]; if (id) set(LEASE_CHAIN.END_REASON, id); else warn(`end reason "${(END_REASONS.find((x) => x.key === v) || {}).label || v}" is not in ${AMEND.END_REASON_LIST} yet; left out`); }
      else if (k === 'groupType') { const id = I.group && I.group[v]; if (id) set(LEASE_CHAIN.GROUP_TYPE, id); else warn(`group type "${v === 'AMENDMENT' ? 'Amendment' : v}" is not in ${LEASE_CHAIN.GROUP_TYPE_LIST} yet; left out`); }
      else if (k === 'typeKey') { const id = v && I.leaseType && I.leaseType[v]; if (id) set(LEASE_CHAIN.TYPE, id); }
      else if (k === 'unit') set(LEASE.UNIT, v == null ? '' : Number(v)); else if (k === 'property') set(LEASE.PROPERTY, Number(v)); else if (k === 'ay') { if (v != null) set(LEASE.AY, Number(v)); }
      else if (k === 'name') set('name', String(v).slice(0, 300));
      else if (k === 'statusFrom') { const src = loadLease(v); if (src && src.statusRaw != null) set(LEASE.STATUS, Number(src.statusRaw)); }
    }
    return out;
  }
  function runSteps(scope, steps, base) {
    const refs = {}; const warnings = []; const todo = []; const done = [];
    const warn = (m) => warnings.push(m);
    const write = (change) => { const r = writes.apply([change], scope, { internal: true }); if (r.deferred.length) throw stepError('DEFERRED', 'ran out of NetSuite governance; apply again to finish (finished steps are skipped)'); const x = r.results[0]; if (!x.ok) throw stepError(x.code, x.message, x); return x; };
    steps.forEach((s, i) => {
      const cid = (suffix = '') => `${base}:${i}${suffix}`.slice(0, 80);
      if (s.op === 'updateLease') { const leaseId = refs[s.leaseId] || s.leaseId; const fields = leaseFields(s.fields, refs, warn); if (Object.keys(fields).length) write({ changeId: cid(), recordType: LEASE.TYPE, recordId: Number(leaseId), fields }); done.push({ op: s.op, leaseId: String(leaseId), why: s.why }); }
      else if (s.op === 'createLease') { const fields = leaseFields(s.fields, refs, warn); const r = write({ changeId: cid(), recordType: LEASE.TYPE, recordId: null, fields }); refs[s.ref] = r.recordId; done.push({ op: s.op, leaseId: r.recordId, why: s.why }); }
      else if (s.op === 'tenantScope') {
        for (const t of s.tenants || []) {
          const props = sq.few(`SELECT maptwo AS v FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone = ?`, [Number(t)]).map((x) => String(x.v));
          const ays = sq.few(`SELECT maptwo AS v FROM ${CUSTOMER.AY_MAP} WHERE mapone = ?`, [Number(t)]).map((x) => String(x.v));
          const fields = {};
          if (s.propertyId && !props.includes(String(s.propertyId))) fields[CUSTOMER.PROPERTY] = [...props, String(s.propertyId)].map(Number);
          if (s.ayId && !ays.includes(String(s.ayId))) fields[CUSTOMER.AY] = [...ays, String(s.ayId)].map(Number);
          if (Object.keys(fields).length) write({ changeId: cid(`:${t}`), recordType: CUSTOMER.TYPE, recordId: Number(t), fields });
        }
        done.push({ op: s.op, tenants: s.tenants, why: s.why });
      }
      else if (s.op === 'tenantStatus') {
        const id = ids().released;
        if (!id) { warn(`no "${LEASE_CHAIN.RELEASED_STATUS}" customer status yet: ${s.tenants.length} tenant(s) keep their status`); return; }
        for (const t of s.tenants || []) write({ changeId: cid(`:${t}`), recordType: CUSTOMER.TYPE, recordId: Number(t), fields: { entitystatus: id } });
        done.push({ op: s.op, tenants: s.tenants, why: s.why });
      }
      else if (s.op === 'stage') {
        const l = loadLease(refs[s.leaseId] || s.leaseId); if (!l || !l.unitId || !l.ayFieldRaw) { warn('the lease has no unit or academic year: stage left as it is'); return; }
        const row = sq.one(`SELECT id FROM ${UAS.TYPE} WHERE ${UAS.UNIT} = ? AND ${UAS.AY} = ? AND isinactive = 'F'`, [Number(l.unitId), Number(l.ayFieldRaw)]);
        if (row) write({ changeId: cid(), recordType: UAS.TYPE, recordId: Number(row.id), fields: { [UAS.STAGE]: s.stage } });
        else write({ changeId: cid(), recordType: UAS.TYPE, recordId: null, fields: { [UAS.UNIT]: Number(l.unitId), [UAS.AY]: Number(l.ayFieldRaw), [UAS.PROPERTY]: Number(l.propertyId), name: l.name, [UAS.STAGE]: s.stage } });
        done.push({ op: s.op, stage: s.stage, why: s.why });
      }
      else if (s.op === 'manual') todo.push(s.text);
    });
    return { refs, warnings, todo, done };
  }

  // ---------------- amendment rows ----------------
  function amendmentFields(plan, statusKey, scope) {
    const a = plan.amendment; const I = ids(); const f = {};
    const sc = scenarioByKey(plan.scenario);
    f.name = `${a.before.name} · ${sc ? sc.label : plan.scenario}`.slice(0, 300);
    f[AMEND.LEASE] = Number(a.leaseId);
    if (I.type && I.type[plan.mechanism]) f[AMEND.KIND] = I.type[plan.mechanism];
    f[AMEND.STATUS] = I.status[statusKey];
    f[AMEND.SCENARIO] = plan.scenario;
    if (a.effective) f[AMEND.EFFECTIVE] = a.effective;
    if (a.reason) f[AMEND.REASON] = a.reason;
    if (a.tenantsAdded.length) f[AMEND.ADDED] = a.tenantsAdded.map(Number);
    if (a.tenantsRemoved.length) f[AMEND.REMOVED] = a.tenantsRemoved.map(Number);
    if (a.oldRent != null) f[AMEND.OLD_RENT] = a.oldRent;
    if (a.newRent != null) f[AMEND.NEW_RENT] = a.newRent;
    if (a.fee != null) f[AMEND.FEE] = a.fee;
    if (a.provisions) f[AMEND.PROVISIONS] = a.provisions;
    f[AMEND.BEFORE] = JSON.stringify(a.before);
    f[AMEND.PLAN] = JSON.stringify({ v: 1, scenario: plan.scenario, mechanism: plan.mechanism, path: plan.path, steps: plan.steps });
    if (a.otherLeaseId) f[AMEND.OTHER_LEASE] = Number(a.otherLeaseId);
    if (a.targetUnitId) f[AMEND.TARGET_UNIT] = Number(a.targetUnitId);
    if (scope && scope.userId) f[AMEND.REQUESTED_BY] = Number(scope.userId);
    return f;
  }
  function readAmendment(id) {
    const r = sq.one(`SELECT id, name, ${AMEND.LEASE} AS lease, ${AMEND.STATUS} AS status, BUILTIN.DF(${AMEND.STATUS}) AS status_name, ${AMEND.PLAN} AS plan, ${AMEND.RESULT_LEASE} AS result_lease FROM ${AMEND.TYPE} WHERE id = ?`, [Number(id)]);
    if (!r) return null;
    let plan = null; try { plan = JSON.parse(r.plan || 'null'); } catch (e) { plan = null; }
    return { id: String(r.id), name: r.name, leaseId: r.lease != null ? String(r.lease) : null, statusKey: keyFromLabel(r.status_name, AMEND_STATUSES), plan, resultLeaseId: r.result_lease != null ? String(r.result_lease) : null };
  }
  function setAmendment(scope, id, fields, suffix) { return writes.apply([{ changeId: `am${id}:${suffix}:${Date.now().toString(36)}`.slice(0, 80), recordType: AMEND.TYPE, recordId: Number(id), fields }], scope, { internal: true }).results[0]; }

  /**
   * submit(scope, { changeId, leaseId, scenario, input, otherLeaseId, target }) — plan, then either change the unsigned lease
   * now (EDIT / REVISE, logged as an Applied amendment) or file an amendment for approval (AMEND).
   */
  function submit(scope, req, { lease = null, other = null } = {}) {
    lease = lease || loadLease(req.leaseId);
    if (!lease) return { ok: false, error: `lease ${req.leaseId} not found` };
    if (req.otherLeaseId && !other) other = loadLease(req.otherLeaseId);
    const plan = planChange({ scenario: req.scenario, lease, input: req.input || {}, other, target: req.target || null });
    if (!plan.ok) return { ok: false, plan };
    if (req.dryRun) return { ok: true, plan, ready: amendReady() };
    const base = `lc:${String(req.changeId || '').slice(0, 60)}`;
    if (plan.path !== 'AMEND') {
      let run; try { run = runSteps(scope, plan.steps, base); } catch (e) { return { ok: false, plan, error: e && e.message, code: e && e.code, detail: e && (e.bad || e.overlaps) ? { bad: e.bad, overlaps: e.overlaps } : null }; }
      let amendmentId = null;
      if (amendReady()) { const r = writes.apply([{ changeId: `${base}:log`, recordType: AMEND.TYPE, recordId: null, fields: { ...amendmentFields(plan, 'APPLIED', scope), [AMEND.APPLIED]: clock(), [AMEND.RESULT]: summary(run) } }], scope, { internal: true }).results[0]; amendmentId = r.ok ? r.recordId : null; if (!r.ok) run.warnings.push(`the change was made but its log row was not saved: ${r.message}`); }
      else run.warnings.push('the Lease Amendment record is not set up yet: the change was made without a log row');
      return { ok: true, plan, applied: true, amendmentId, ...run };
    }
    if (!amendReady()) return { ok: false, plan, error: 'the Lease Amendment record and its status list are not set up in NetSuite yet (see the build sheet); signed leases cannot be changed until they are' };
    const r = writes.apply([{ changeId: `${base}:am`, recordType: AMEND.TYPE, recordId: null, fields: amendmentFields(plan, 'PENDING', scope) }], scope, { internal: true }).results[0];
    if (!r.ok) return { ok: false, plan, error: r.message, code: r.code };
    return { ok: true, plan, applied: false, amendmentId: r.recordId, status: 'PENDING' };
  }

  /** apply(scope, amendmentId) — run a Signed (or, when allowed, Approved) amendment's stored plan. Safe to repeat. */
  function apply(scope, amendmentId) {
    const a = readAmendment(amendmentId);
    if (!a) return { ok: false, error: `amendment ${amendmentId} not found` };
    if (a.statusKey === 'APPLIED') return { ok: true, already: true, resultLeaseId: a.resultLeaseId };
    if (a.statusKey !== 'FAILED' && !canApply(a.statusKey, { applyOnApproval })) return { ok: false, error: `amendment is ${a.statusKey || 'in an unknown status'}; only a ${applyOnApproval ? 'Signed or Approved' : 'Signed'} amendment can be applied` };
    if (!a.plan || !Array.isArray(a.plan.steps)) return { ok: false, error: 'the amendment carries no plan to apply' };
    try {
      const run = runSteps(scope, a.plan.steps, `am${a.id}`);
      const fields = { [AMEND.STATUS]: ids().status.APPLIED, [AMEND.APPLIED]: clock(), [AMEND.RESULT]: summary(run) };
      const resultLease = run.refs.new || run.refs.new2 || null; if (resultLease) fields[AMEND.RESULT_LEASE] = Number(resultLease);
      const w = setAmendment(scope, a.id, fields, 'applied');
      if (!w.ok) run.warnings.push(`changes applied, but the amendment row could not be marked Applied: ${w.message}`);
      return { ok: true, amendmentId: a.id, resultLeaseId: resultLease, ...run };
    } catch (e) {
      log && log.error && log.error({ title: `apply amendment ${a.id} failed`, details: e && e.message });
      if (ids().status.FAILED) setAmendment(scope, a.id, { [AMEND.STATUS]: ids().status.FAILED, [AMEND.RESULT]: `Failed: ${e && e.message}` }, 'failed');
      return { ok: false, amendmentId: a.id, error: e && e.message, code: e && e.code };
    }
  }
  /** Amendments on a lease (either side of a move), newest first. */
  function list(leaseId) {
    if (!hasField(AMEND.TYPE, AMEND.PLAN)) return [];
    return sq.few(`SELECT id, name, BUILTIN.DF(${AMEND.STATUS}) AS status, BUILTIN.DF(${AMEND.KIND}) AS kind, ${AMEND.SCENARIO} AS scenario, ${AMEND.EFFECTIVE} AS effective, ${AMEND.RESULT_LEASE} AS result_lease, BUILTIN.DF(${AMEND.REQUESTED_BY}) AS requested_by, created FROM ${AMEND.TYPE} WHERE ${AMEND.LEASE} = ? OR ${AMEND.OTHER_LEASE} = ? ORDER BY id DESC`, [Number(leaseId), Number(leaseId)])
      .map((r) => ({ id: String(r.id), name: r.name, status: r.status, statusKey: keyFromLabel(r.status, AMEND_STATUSES), kind: r.kind, scenario: r.scenario, effective: r.effective, resultLeaseId: r.result_lease != null ? String(r.result_lease) : null, requestedBy: r.requested_by, created: r.created }));
  }
  return { submit, apply, list, loadLease, ids, amendReady, hasField, runSteps, applyOnApproval };
}
function leaseTypeGuess(name) { const n = String(name || '').toLowerCase(); return n.includes('whole') || n.includes('house') ? 'WH' : n.includes('bed') ? 'BED' : n.includes('unit') ? 'UNIT' : null; }
function stepError(code, message, extra = {}) { const e = new Error(message); e.code = code; Object.assign(e, extra); return e; }
function summary(run) { return [...run.done.map((d) => `${d.op}${d.leaseId ? ` lease ${d.leaseId}` : ''}${d.tenants ? ` tenants ${d.tenants.join(',')}` : ''}${d.stage ? ` stage ${d.stage}` : ''}`), ...run.warnings.map((w) => `warning: ${w}`), ...run.todo.map((t) => `to do: ${t}`)].join('\n').slice(0, 3900); }
