/** §6.3 — rows are the inventory's unit nodes (never a separate query); server-side filter/sort/page. */
import { foldStage, UAS } from '../../shared/constants.js';
import { effectiveStage, daysInStage } from '../../shared/rules/stages.js';
import { toISO } from '../../shared/rules/dates.js';
import { applyPipelineView } from '../../shared/rules/views.js';

export function buildPipelineRows(ctx, ay, basis) {
  const r = ctx.run(ay, basis);
  const inv = r.inventory;
  const ayId = ctx.ayIdFor(ay);
  const { rows: stageRows, missing } = ctx.dao.pipeline.stageRows(ayId ? [ayId] : []);
  const stageByUnit = new Map(); for (const s of stageRows) stageByUnit.set(String(s.unit), s);
  const targetByUnit = new Map(); for (const t of r.targets) if (t.ay === ay && t.unitId) targetByUnit.set(t.unitId, t);
  const lookups = ctx.load().lookups;
  const out = [];
  const segment = ctx.params.segment === 'str' ? 'STR' : 'STUDENT';
  for (const u of inv.unitNodes) {
    const p = inv.propertiesById.get(u.propertyId);
    if (!p || !ctx.inScope(p.marketId)) continue;
    // §6.3 invariant: pipeline rows are the KPI denominator. Commercial units are never leasing rows;
    // short-term rentals are their own segment (?segment=str), kept out of the student denominator.
    if (p.segment === 'COMMERCIAL') continue;
    if ((p.segment === 'STR') !== (segment === 'STR')) continue;
    const leaves = u.leaves.map((l) => r.placement.leafResults.get(l.key));
    const taken = leaves.filter((l) => l.occupied).reduce((s, l) => s + l.leaf.beds, 0);
    const leaseIds = [...new Set(leaves.flatMap((l) => l.placements.map((pl) => pl.leaseId)))];
    const leases = leaseIds.map((id) => r.placement.leaseResults.get(id)).filter(Boolean);
    const s = stageByUnit.get(u.id) || null;
    const stageKey = s ? effectiveStage({ stage: s.stage_name || lookups.stageIds[String(s.stage)] || s.stage, manualStage: lookups.stageIds[String(s.manual_stage)] || s.manual_stage, stageSource: String(s.stage_source) === '2' || s.stage_source_name === 'Lease' ? 'lease' : 'manual' }) : 'NONE';
    const t = targetByUnit.get(u.id) || null;
    const targetMonthly = t ? (t.targetMonthly ?? (t.targetPerBed != null ? t.targetPerBed * u.beds : null)) : null;
    out.push({
      key: u.id, unitId: u.propertyOnly ? null : u.id, propertyId: p.id, property: p.name, unit: u.propertyOnly ? '(whole property)' : u.name, market: p.marketId, fund: p.fund, segment: p.segment,
      beds: u.beds, free: u.beds - taken, taken, bedroomCount: u.bedrooms.length,
      stage: stageKey, stageSource: s ? (String(s.stage_source) === '2' ? 'lease' : 'manual') : null, stageDate: s ? toISO(s.stage_date) : null, daysInStage: s ? daysInStage(toISO(s.stage_date), ctx.today) : null,
      rowId: s ? String(s.id) : null, version: s ? String(s.lastmodified) : null,
      tours: 0, lastTour: null, // §5.6: filled once the tour link field exists (schema.degraded says so)
      targetMonthly, targetPerBed: targetMonthly != null && u.beds ? targetMonthly / u.beds : null,
      lastOffer: s ? s.last_offer : null, expectedTenants: s ? s.expected_tenants : null, followup: s ? toISO(s.followup) : null, notes: s ? s.notes : null, leaseTerms: s && s.lease_terms ? safeJson(s.lease_terms) : null,
      leases: leases.map((l) => ({ id: l.lease.id, name: l.lease.name, type: l.lease.typeKey, status: l.lease.statusKey, start: l.lease.start, end: l.lease.end, monthly: l.lease.monthlyRent, placed: l.status === 'placed', code: l.code })),
      rrUnitId: u.rrUnitId,
    });
  }
  return { rows: out, missing, stageRowCount: stageRows.length };
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

export function routePipeline(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), q = ctx.params;
  const built = buildPipelineRows(ctx, ay, basis);
  const sel = ctx.selection();
  const view = applyPipelineView(built.rows, { ...q, fund: sel.fund, market: sel.marketId });
  return { ay, basis, selection: sel, ...view, stageRowCount: built.stageRowCount, missingFields: built.missing, degraded: ctx.schema.degraded };
}
