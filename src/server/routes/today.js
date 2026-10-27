/** §6.1 — the work queue: existing data filtered by "needs me". Assembled last, from everything above. */
import { STALE_STAGE_DAYS } from '../../shared/constants.js';
import { buildPipelineRows } from './pipeline.js';
import { routeExceptions } from './exceptions.js';
import { addDays } from '../../shared/rules/dates.js';
import { tourRows, visibleTour } from './tours.js';
import { loadLeads } from './people.js';
import { CALENDAR_URL } from '../../shared/constants.js';
export function routeToday(ctx) {
  const ay = ctx.selectedAy();
  const { rows } = buildPipelineRows(ctx, ay, ctx.basis());
  const tomorrow = addDays(ctx.today, 1);
  const followups = rows.filter((r) => r.followup && r.followup <= tomorrow).sort((a, b) => a.followup.localeCompare(b.followup));
  const stale = rows.filter((r) => r.stage !== 'NONE' && r.stageSource !== 'lease' && (r.daysInStage || 0) > STALE_STAGE_DAYS).sort((a, b) => b.daysInStage - a.daysInStage);
  const ex = routeExceptions(ctx, null, { full: false });
  const blocked = ctx.dao.people.tenants({ filters: { stage: 'CUSTOMER', missingProperty: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() }, page: 0, pageSize: 25 });
  const blockedAy = ctx.dao.people.tenants({ filters: { stage: 'CUSTOMER', missingAy: true, scopePropertyIds: ctx.scope.all ? null : ctx.propertyIdsInScope() }, page: 0, pageSize: 25 });
  // Tours today and tomorrow in my markets (plus my own with no unit yet), and the week ahead for me.
  const weekEnd = addDays(ctx.today, 7);
  const tours = tourRows(ctx, ctx.dao.tours.list({ from: ctx.today, to: weekEnd })).filter((r) => visibleTour(ctx, r) && r.outcome !== 'CANCELLED');
  const soon = tours.filter((r) => r.date <= tomorrow);
  const mine = tours.filter((r) => String(r.organizerId) === String(ctx.scope.userId));
  // Leads with no next action: new inquiries in scope with no property and no tour on the books.
  let leadRows = [];
  try { leadRows = loadLeads(ctx).filter((l) => !l.nextTour && !l.properties.length); } catch (e) { ctx.log && ctx.log.error && ctx.log.error({ title: 'today: leads', details: e && e.message }); }
  return {
    ay, today: ctx.today,
    followups: { count: followups.length, rows: followups.slice(0, 50) },
    tours: { count: soon.length, rows: soon.slice(0, 50), week: mine.length, weekRows: mine.slice(0, 50), available: !ctx.dao.tours.unavailable, note: ctx.dao.tours.unavailable ? 'calendar events are not readable by this role' : null, calendarUrl: CALENDAR_URL, me: String(ctx.scope.userId) },
    stale: { count: stale.length, rows: stale.slice(0, 50), thresholdDays: STALE_STAGE_DAYS },
    leads: { count: leadRows.length, rows: leadRows.slice(0, 25).map((l) => ({ id: l.id, name: l.name, school: l.school, desiredLocation: l.desiredLocation, created: l.created, email: l.email, phone: l.phone })) },
    blockedTenants: { missingProperty: blocked.total, missingAy: blockedAy.total, sample: blocked.rows.slice(0, 10).map((t) => ({ id: String(t.id), name: [t.firstname, t.lastname].filter(Boolean).join(' '), desiredLocation: t.desired_location })) },
    exceptions: { count: ex.count, byCode: ex.groups.map((g) => ({ code: g.code, label: g.label, severity: g.severity, n: g.rows.length })) },
  };
}
