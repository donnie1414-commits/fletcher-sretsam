/** §4.2 — saved views per employee, optional share to market teams. Stored in customrecord_ad_saved_view. */
import { SAVED_VIEW } from '../../shared/constants.js';
import { sqlIn } from '../dao/suiteql.js';
export function routeSavedViews(ctx, body) {
  const have = ctx.schema.probe(SAVED_VIEW.TYPE, [SAVED_VIEW.JSON]).get(SAVED_VIEW.JSON) !== false;
  if (!have) return { views: [], degraded: 'saved views record not created yet (see SETUP-CHECKLIST)' };
  if (body) {
    const v = body.view || {};
    const change = { changeId: body.changeId, recordType: SAVED_VIEW.TYPE, recordId: v.id || null, fields: { [SAVED_VIEW.OWNER]: ctx.scope.userId, [SAVED_VIEW.WORKSPACE]: String(v.workspace || ''), [SAVED_VIEW.NAME]: String(v.name || '').slice(0, 80), name: String(v.name || '').slice(0, 80), [SAVED_VIEW.JSON]: JSON.stringify(v.state || {}), [SAVED_VIEW.IS_DEFAULT]: !!v.isDefault, [SAVED_VIEW.SHARED_MARKETS]: (v.sharedMarkets || []).filter((m) => ctx.inScope(m)).join(','), ...(body.delete ? { isinactive: true } : {}) } };
    if (v.id) { const owner = ctx.sq.one(`SELECT ${SAVED_VIEW.OWNER} AS owner FROM ${SAVED_VIEW.TYPE} WHERE id = ?`, [Number(v.id)]); if (!owner || String(owner.owner) !== String(ctx.scope.userId)) return { error: 'not your view', meta: { status: 403 } }; }
    return ctx.writes.apply([change], ctx.scope);
  }
  const mine = ctx.sq.few(`SELECT id, ${SAVED_VIEW.WORKSPACE} AS workspace, ${SAVED_VIEW.NAME} AS name, ${SAVED_VIEW.JSON} AS state, ${SAVED_VIEW.IS_DEFAULT} AS is_default, ${SAVED_VIEW.SHARED_MARKETS} AS shared, ${SAVED_VIEW.OWNER} AS owner FROM ${SAVED_VIEW.TYPE} WHERE isinactive = 'F' AND (${SAVED_VIEW.OWNER} = ? OR ${SAVED_VIEW.SHARED_MARKETS} IS NOT NULL)`, [ctx.scope.userId]);
  const views = mine.filter((v) => String(v.owner) === String(ctx.scope.userId) || String(v.shared || '').split(',').some((m) => ctx.inScope(m.trim()))).map((v) => ({ id: String(v.id), workspace: v.workspace, name: v.name, state: safe(v.state), isDefault: v.is_default === 'T' || v.is_default === true, sharedMarkets: String(v.shared || '').split(',').filter(Boolean), mine: String(v.owner) === String(ctx.scope.userId) }));
  return { views };
}
function safe(s) { try { return JSON.parse(s); } catch (e) { return {}; } }
