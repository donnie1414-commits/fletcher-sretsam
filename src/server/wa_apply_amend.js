/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @NModuleScope SameAccount
 *
 * Apply Lease Amendment — customscript_ad_wa_apply_amend (docs/LEASE-CHANGES-BUILD.md).
 * Called by the Lease Amendment workflow when an amendment reaches Signed (or Approved, if the script parameter
 * "Apply on approval" is ticked). Runs the amendment's stored plan through the same executor and write module as the
 * Leasing Hub, so the hub and the workflow can never disagree about what "apply" does. Safe to run twice.
 * Returns "APPLIED", "ALREADY", or "FAILED: <reason>" for the workflow to branch on (store it in a workflow field).
 * Built by tools/build.js into dist/ad_wa_apply_amend.js.
 */
import query from 'N/query';
import record from 'N/record';
import runtime from 'N/runtime';
import log from 'N/log';
import { createSchema } from './schema.js';
import { createSuiteQL } from './dao/suiteql.js';
import { createWrites } from './writes.js';
import { createLeaseChange } from './leaseChange.js';

export function onAction(context) {
  const id = context.newRecord && context.newRecord.id;
  if (!id) return 'FAILED: no amendment record';
  const sq = createSuiteQL({ query, log });
  const schema = createSchema({ query, log, cache: null });
  const user = runtime.getCurrentUser();
  // The workflow decides who may apply (its approval states); market scope is not re-checked here.
  const scope = { userId: user && user.id, name: user && user.name, all: true, marketIds: [] };
  const auth = { can: () => true, resolve: () => scope };
  const stageIds = {};
  const writes = createWrites({ record, sq, runtime, log, schema, auth, marketOf: () => 'workflow', stageIdFor: (key) => stageIds[key] || null });
  let applyOnApproval = false; try { const v = runtime.getCurrentScript().getParameter({ name: 'custscript_ad_wa_apply_on_approval' }); applyOnApproval = v === true || v === 'T'; } catch (e) { applyOnApproval = false; }
  const lc = createLeaseChange({ sq, writes, log, applyOnApproval });
  const r = lc.apply(scope, id);
  log.audit({ title: `apply amendment ${id}`, details: JSON.stringify({ ok: r.ok, already: !!r.already, resultLeaseId: r.resultLeaseId || null, warnings: r.warnings || [], todo: r.todo || [], error: r.error || null }).slice(0, 3900) });
  return r.ok ? (r.already ? 'ALREADY' : 'APPLIED') : `FAILED: ${r.error || 'unknown'}`.slice(0, 300);
}
