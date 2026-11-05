/**
 * GET ?route=setup — what the hub expects to exist in NetSuite, checked live with the signed-in user's role:
 * every optional field, list and record, the leasing-stage values, and the deployment's overlap parameter.
 * status: 'ok' | 'missing' | 'unknown' (the role cannot read that table, so it cannot be checked from here).
 */
import { UAS, TOUR, LEAD, AUDIT, SAVED_VIEW, MARKET_LOCK, CUSTOMER } from '../../shared/constants.js';
import { lookupsFromLists } from '../../shared/rules/index.js';

const ITEMS = [
  { area: 'Leads', table: CUSTOMER.TYPE, field: LEAD.UNITS, label: 'Units of interest on a lead (Multiple Select → Units/Bedrooms)', need: 'optional', effect: 'Units ticked when adding a lead are kept on the lead for later tours.' },
  { area: 'Tours', table: TOUR.TYPE, field: TOUR.UNIT, label: 'Event › Units toured (Multiple Select → Units/Bedrooms)', need: 'recommended', effect: 'Tours count on the Pipeline per unit.' },
  { area: 'Tours', table: TOUR.TYPE, field: TOUR.AY, label: 'Event › Academic years (Multiple Select → Academic Year)', need: 'recommended', effect: 'Tours count toward the right academic year.' },
  { area: 'Tours', table: TOUR.TYPE, field: TOUR.OUTCOME, label: 'Event › Tour outcome (List → Tour Outcome)', need: 'recommended', effect: 'Completed / No-show / Cancelled / Leased are recorded.' },
  { area: 'Tours', list: TOUR.OUTCOME_LIST, label: 'List: Tour Outcome (Scheduled, Completed, No-show, Cancelled, Leased)', need: 'recommended', effect: 'Needed by the outcome field.' },
  { area: 'Pipeline', table: UAS.TYPE, field: UAS.LEASE_TERMS, label: 'Unit Leasing Status › Lease terms (Long Text)', need: 'optional', effect: 'Lease terms captured before a lease exists are remembered.' },
  { area: 'Pipeline', stage: 'IN_NEGOTIATIONS', label: 'Leasing Stage value: In Negotiations', need: 'required', effect: 'The stage can be saved from the board.' },
  { area: 'Pipeline', stage: 'LEASE_REVISIONS', label: 'Leasing Stage value: Lease Revisions', need: 'required', effect: 'The Revisions button can set the stage.' },
  { area: 'Records', table: AUDIT.TYPE, field: AUDIT.CHANGE_ID, label: 'Record: AD Write Audit (with its 8 fields)', need: 'recommended', effect: 'Change log, and protection against a change being saved twice.', fields: Object.values(AUDIT).filter((f) => f !== AUDIT.TYPE) },
  { area: 'Records', table: SAVED_VIEW.TYPE, field: SAVED_VIEW.JSON, label: 'Record: AD Saved View (with its 6 fields)', need: 'optional', effect: 'Saved views stored in NetSuite and shareable.', fields: Object.values(SAVED_VIEW).filter((f) => f !== SAVED_VIEW.TYPE) },
  { area: 'Access', table: 'employee', field: MARKET_LOCK.EMPLOYEE_FIELD, label: 'Employee › Lease KPI Markets', need: 'required', effect: 'Market lock: who sees which markets.' },
];
export function routeSetup(ctx) {
  ctx.schema.reset();
  const lookups = lookupsFromLists(ctx.dao.portfolio.lists());
  const stageKeys = new Set(Object.values(lookups.stageIds));
  const items = ITEMS.map((it) => {
    let status = 'unknown', detail = null;
    try {
      if (it.stage) status = stageKeys.has(it.stage) ? 'ok' : 'missing';
      else if (it.list) { try { ctx.sq.few(`SELECT id FROM ${it.list} WHERE ROWNUM <= 1`); status = 'ok'; } catch (e) { status = 'missing'; } }
      else {
        // a table the role cannot read at all is "unknown", not "missing"
        let readable = true; try { ctx.sq.few(`SELECT id FROM ${it.table} WHERE ROWNUM <= 1`); } catch (e) { readable = false; }
        if (!readable && it.table !== AUDIT.TYPE && it.table !== SAVED_VIEW.TYPE) { status = 'unknown'; detail = 'your role cannot read this record type'; }
        else if (!readable) status = 'missing';
        else {
          const fields = it.fields || [it.field];
          const have = ctx.schema.probe(it.table, fields);
          const absent = fields.filter((f) => have.get(f) === false);
          status = absent.length ? 'missing' : 'ok';
          if (absent.length && it.fields) detail = `missing fields: ${absent.join(', ')}`;
        }
      }
    } catch (e) { status = 'unknown'; detail = e && e.message; }
    return { area: it.area, label: it.label, id: it.field || it.list || it.stage, need: it.need, effect: it.effect, status, detail };
  });
  items.push({ area: 'Pipeline', label: 'Deployment parameter: Overlap rule (§5.7.1)', id: 'custscript_al_overlap_rule', need: 'recommended', effect: 'Back-to-back leases on one unit in the same year are both counted.', status: ctx.flags.requireOverlapForCollision ? 'ok' : 'missing', detail: ctx.flags.requireOverlapForCollision ? null : 'not ticked on the deployment' });
  return { items, missing: items.filter((x) => x.status === 'missing').length, checkedAt: new Date().toISOString() };
}
