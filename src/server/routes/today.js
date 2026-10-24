/** §6.1 — the work queue: existing data filtered by "needs me". Assembled last, from everything above. */
import { STALE_STAGE_DAYS } from '../../shared/constants.js';
import { buildPipelineRows } from './pipeline.js';
import { routeExceptions } from './exceptions.js';
import { addDays } from '../../shared/rules/dates.js';
export function routeToday(ctx) {
  const ay = ctx.selectedAy();
  const { rows } = buildPipelineRows(ctx, ay, ctx.basis());
  const tomorrow = addDays(ctx.today, 1);
  const followups = rows.filter((r) => r.followup && r.followup <= tomorrow).sort((a, b) => a.followup.localeCompare(b.followup));
  const stale = rows.filter((r) => r.stage !== 'NONE' && r.stageSource !== 'lease' && (r.daysInStage || 0) > STALE_STAGE_DAYS).sort((a, b) => b.daysInStage - a.daysInStage);
  const ex = routeExceptions(ctx, null, { full: false });
  const blocked = ctx.dao.people.tenants({ filters: { stage: 'CUSTOMER', missingProperty: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() }, page: 0, pageSize: 25 });
  const blockedAy = ctx.dao.people.tenants({ filters: { stage: 'CUSTOMER', missingAy: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() }, page: 0, pageSize: 25 });
  return {
    ay, today: ctx.today,
    followups: { count: followups.length, rows: followups.slice(0, 50) },
    tours: { count: 0, rows: [], note: 'tour link field not yet created (§5.6)' },
    stale: { count: stale.length, rows: stale.slice(0, 50), thresholdDays: STALE_STAGE_DAYS },
    leads: { count: 0, rows: [], note: 'leads workspace pending §5.5.0 review' },
    blockedTenants: { missingProperty: blocked.total, missingAy: blockedAy.total, sample: blocked.rows.slice(0, 10).map((t) => ({ id: String(t.id), name: [t.firstname, t.lastname].filter(Boolean).join(' '), desiredLocation: t.desired_location })) },
    exceptions: { count: ex.count, byCode: ex.groups.map((g) => ({ code: g.code, label: g.label, severity: g.severity, n: g.rows.length })) },
  };
}
