/**
 * GET ?route=setup — what the hub expects to exist in NetSuite, checked live with the signed-in user's role:
 * every optional field, list and record, the leasing-stage values, and the deployment's overlap parameter.
 * status: 'ok' | 'missing' | 'unknown' (the role cannot read that table, so it cannot be checked from here).
 */
import { UAS, TOUR, LEAD, AUDIT, SAVED_VIEW, MARKET_LOCK, CUSTOMER, AMEND, LEASE, LEASE_CHAIN } from '../../shared/constants.js';
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
  // Lease changes (docs/LEASE-CHANGES-BUILD.md)
  { area: 'Lease changes', table: AMEND.TYPE, field: AMEND.PLAN, label: 'Record: Lease Amendment (with its 22 fields)', need: 'required', effect: 'Signed leases can be amended; every change is logged.', fields: Object.entries(AMEND).filter(([k]) => !k.endsWith('_LIST') && k !== 'TYPE').map(([, v]) => v), owned: true },
  { area: 'Lease changes', list: AMEND.TYPE_LIST, label: 'List: Amendment Type (Revise, Supersede, Terminate, Cancel, Transfer, Assignment)', need: 'required', effect: 'Each amendment records how it was applied.' },
  { area: 'Lease changes', list: AMEND.STATUS_LIST, label: 'List: Amendment Status (Draft … Applied, Failed)', need: 'required', effect: 'Approval and apply steps can move the amendment along.' },
  { area: 'Lease changes', list: AMEND.END_REASON_LIST, label: 'List: Lease End Reason', need: 'required', effect: 'Ended and cancelled leases say why.' },
  { area: 'Lease changes', table: LEASE.TYPE, field: LEASE_CHAIN.SUPERSEDES, label: 'Lease › Supersedes, End reason, Version', need: 'required', effect: 'The lease chain: original → current, and why each one ended.', fields: [LEASE_CHAIN.SUPERSEDES, LEASE_CHAIN.END_REASON, LEASE_CHAIN.VERSION] },
  { area: 'Lease changes', listValue: [LEASE_CHAIN.GROUP_TYPE_LIST, 'amendment'], label: 'Group Type value: Amendment', need: 'recommended', effect: 'A superseding lease is marked as an amendment, not new leasing.' },
  { area: 'Lease changes', released: true, label: `Customer status: ${LEASE_CHAIN.RELEASED_STATUS} (Customer stage)`, need: 'recommended', effect: 'Released tenants are not mistaken for active tenants.' },
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
      else if (it.listValue) { try { const rows = ctx.sq.few(`SELECT name FROM ${it.listValue[0]} WHERE isinactive = 'F'`); status = rows.some((r) => String(r.name).trim().toLowerCase() === it.listValue[1]) ? 'ok' : 'missing'; } catch (e) { status = 'missing'; } }
      else if (it.released) { try { status = ctx.sq.few(`SELECT key FROM entitystatus WHERE LOWER(name) = ? AND inactive = 'F'`, [LEASE_CHAIN.RELEASED_STATUS.toLowerCase()]).length ? 'ok' : 'missing'; } catch (e) { status = 'unknown'; } }
      else if (it.list) { try { ctx.sq.few(`SELECT id FROM ${it.list} WHERE ROWNUM <= 1`); status = 'ok'; } catch (e) { status = 'missing'; } }
      else {
        // a table the role cannot read at all is "unknown", not "missing"
        let readable = true; try { ctx.sq.few(`SELECT id FROM ${it.table} WHERE ROWNUM <= 1`); } catch (e) { readable = false; }
        if (!readable && it.table !== AUDIT.TYPE && it.table !== SAVED_VIEW.TYPE && !it.owned) { status = 'unknown'; detail = 'your role cannot read this record type'; }
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
    return { area: it.area, label: it.label, id: it.field || it.list || it.stage || (it.listValue ? it.listValue.join(' › ') : null) || (it.released ? 'entitystatus' : null), need: it.need, effect: it.effect, status, detail };
  });
  items.push({ area: 'Pipeline', label: 'Deployment parameter: Overlap rule (§5.7.1)', id: 'custscript_al_overlap_rule', need: 'recommended', effect: 'Back-to-back leases on one unit in the same year are both counted.', status: ctx.flags.requireOverlapForCollision ? 'ok' : 'missing', detail: ctx.flags.requireOverlapForCollision ? null : 'not ticked on the deployment' });
  items.push({ area: 'Lease changes', label: `Deployment parameter: Apply amendments on approval (${LEASE_CHAIN.APPLY_ON_APPROVAL_PARAM})`, id: LEASE_CHAIN.APPLY_ON_APPROVAL_PARAM, need: 'optional', effect: 'Ticked: an Approved amendment can be applied before the addendum is signed. Unticked: only Signed ones.', status: ctx.leaseChange ? 'ok' : 'unknown', detail: 'optional; leave unticked unless management decides otherwise' });
  return { items, missing: items.filter((x) => x.status === 'missing').length, checkedAt: new Date().toISOString() };
}
