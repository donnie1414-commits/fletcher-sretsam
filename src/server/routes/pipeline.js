/** §6.3 — rows are the inventory's unit nodes (never a separate query); server-side filter/sort/page. */
import { foldStage, UAS } from '../../shared/constants.js';
import { effectiveStage, daysInStage } from '../../shared/rules/stages.js';
import { toISO } from '../../shared/rules/dates.js';

export const PIPELINE_SORTS = ['property', 'unit', 'beds', 'stage', 'daysInStage', 'tours', 'target', 'lastOffer', 'followup', 'available'];

export function buildPipelineRows(ctx, ay, basis) {
  const r = ctx.run(ay, basis);
  const inv = r.inventory;
  const ayId = ctx.ayIdFor(ay);
  const { rows: stageRows, missing } = ctx.dao.pipeline.stageRows(ayId ? [ayId] : []);
  const stageByUnit = new Map(); for (const s of stageRows) stageByUnit.set(String(s.unit), s);
  const targetByUnit = new Map(); for (const t of r.targets) if (t.ay === ay && t.unitId) targetByUnit.set(t.unitId, t);
  const lookups = ctx.load().lookups;
  const out = [];
  for (const u of inv.unitNodes) {
    const p = inv.propertiesById.get(u.propertyId);
    if (!p || !ctx.inScope(p.marketId)) continue;
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
  let rows = built.rows;
  const sel = ctx.selection();
  if (sel.fund) rows = rows.filter((r) => r.fund === sel.fund);
  if (sel.marketId) rows = rows.filter((r) => r.market === sel.marketId);
  if (q.stage) { const set = new Set(String(q.stage).split(',')); rows = rows.filter((r) => set.has(r.stage)); }
  if (q.availability === 'free') rows = rows.filter((r) => r.free > 0); else if (q.availability === 'full') rows = rows.filter((r) => r.free === 0);
  if (q.tours === 'none') rows = rows.filter((r) => r.tours === 0); else if (q.tours === 'some') rows = rows.filter((r) => r.tours > 0);
  if (q.q) { const needle = String(q.q).toLowerCase(); rows = rows.filter((r) => `${r.property} ${r.unit} ${r.expectedTenants || ''} ${r.notes || ''}`.toLowerCase().includes(needle)); }
  const sort = PIPELINE_SORTS.includes(q.sort) ? q.sort : 'property';
  const dir = q.dir === 'desc' ? -1 : 1;
  const val = (r) => ({ property: r.property, unit: r.unit, beds: r.beds, stage: r.stage, daysInStage: r.daysInStage ?? -1, tours: r.tours, target: r.targetMonthly ?? -1, lastOffer: r.lastOffer ?? -1, followup: r.followup || '', available: r.free })[sort];
  rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir || a.property.localeCompare(b.property, undefined, { numeric: true }) || a.unit.localeCompare(b.unit, undefined, { numeric: true }); });
  const total = rows.length, totalBeds = rows.reduce((s, r) => s + r.beds, 0);
  const pageSize = Math.min(500, Math.max(25, Number(q.pageSize) || 100)), page = Math.max(0, Number(q.page) || 0);
  const stageCounts = {}; for (const r of rows) stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1;
  return { ay, basis, selection: sel, total, totalBeds, page, pageSize, rows: rows.slice(page * pageSize, (page + 1) * pageSize), stageCounts, stageRowCount: built.stageRowCount, missingFields: built.missing, degraded: ctx.schema.degraded };
}
