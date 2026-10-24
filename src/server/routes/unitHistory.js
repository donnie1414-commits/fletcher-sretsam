/** §6.3 — the per-row leasing-history drawer: rent by academic year, settle floor, beds available, stage log, notes, prior tenants. One unit, fetched on open. */
import { toISO } from '../../shared/rules/dates.js';
import { buildPipelineRows } from './pipeline.js';
import { STAGES } from '../../shared/constants.js';
export function routeUnitHistory(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis();
  const key = String(ctx.params.unit || '');
  const row = buildPipelineRows(ctx, ay, basis).rows.find((r) => r.key === key);
  if (!row) return { error: `unit ${key} not found in your markets`, meta: { status: 404 } };
  const ays = ctx.ays();
  const label = (y) => (ays.find((a) => a.year === y) || {}).label || `AY ${y}-${y + 1}`;
  const years = [];
  if (row.priorRent != null || ctx.ays().some((a) => a.year === ay - 1)) years.push({ year: ay - 1, label: label(ay - 1), monthly: row.priorRent, perBed: row.priorRent != null && row.priorOcc ? row.priorRent / row.priorOcc : null, status: row.priorRent != null ? `Signed · ${row.priorOcc} of ${row.beds} beds` : 'No lease on this unit', kind: 'prior' });
  years.push({ year: ay, label: label(ay), monthly: row.targetMonthly, perBed: row.targetPerBed, actual: row.monthlyRent, status: row.monthlyRent != null ? `Signed ${row.monthlyRent}` : (row.stage === 'NONE' ? 'Not started' : row.stage), kind: 'current' });
  if (ays.some((a) => a.year === ay + 1)) years.push({ year: ay + 1, label: label(ay + 1), monthly: row.nextTargetMonthly, perBed: row.nextTargetPerBed, status: row.nextTargetMonthly == null ? 'Targets not set yet' : 'Target', kind: 'next' });
  const lookups = ctx.load().lookups;
  const stageName = (id) => { const k = lookups.stageIds[String(id)]; return (STAGES.find((s) => s.key === k) || {}).label || (id == null ? '' : String(id)); };
  const log = row.rowId ? ctx.dao.pipeline.stageLog([row.rowId]).map((l) => ({ id: String(l.id), date: toISO(l.log_date), from: stageName(l.from_stage), to: stageName(l.to_stage), source: String(l.source) === '2' ? 'lease' : 'manual', user: l.user_id == null ? null : String(l.user_id) })) : [];
  const notes = row.rowId ? ctx.dao.pipeline.notes([row.rowId]).map((n) => ({ id: String(n.id), date: toISO(n.note_date) || toISO(n.created), author: n.author_name || String(n.author || ''), text: n.text || '', mentions: n.mentions == null ? [] : String(n.mentions).split(/[,\s]+/).filter(Boolean) })) : [];
  const priorTenants = row.priorTenantIds.length ? ctx.dao.people.byIds(row.priorTenantIds).map((c) => ({ id: String(c.id), name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.entityid, email: c.email || null })) : [];
  return { ay, basis, unit: { key: row.key, unitId: row.unitId, name: row.unit, propertyId: row.propertyId, property: row.property, market: row.market, marketLabel: row.marketLabel, beds: row.beds, free: row.free, bedrooms: row.bedrooms, occupiedBy: row.occupiedBy, occWH: row.occWH, occUnit: row.occUnit, occBed: row.occBed, leaseStart: row.leaseStart, leaseEnd: row.leaseEnd },
    years, settleMonthly: row.settleMonthly, settlePerBed: row.settlePerBed, breach: row.breach, lastOffer: row.lastOffer, expectedTenants: row.expectedTenants, followup: row.followup,
    stage: row.stage, stageSource: row.stageSource, stageDate: row.stageDate, daysInStage: row.daysInStage, sent: row.sent, signed: row.signed, twoYear: row.twoYear, leases: row.leases, draftLease: row.draftLease, log, notes, legacyNotes: row.notes, priorTenants, priorAyLabel: label(ay - 1) };
}
