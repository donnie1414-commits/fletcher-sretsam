/** §6.3 — rows are the inventory's unit nodes (never a separate query); server-side filter/sort/page. */
import { UAS, LEASE_TYPES } from '../../shared/constants.js';
import { effectiveStage, daysInStage } from '../../shared/rules/stages.js';
import { leafTypeLabel } from '../../shared/rules/metrics.js';
import { toISO, addDays, ayEndDate } from '../../shared/rules/dates.js';
import { tourRows } from './tours.js';
import { applyPipelineView } from '../../shared/rules/views.js';

const typeLabel = (k) => (LEASE_TYPES[k] || {}).label || 'Unknown';
function parseMentions(v) { return v == null || v === '' ? [] : String(v).split(/[,\s]+/).filter(Boolean); }

export function buildPipelineRows(ctx, ay, basis) {
  const r = ctx.run(ay, basis);
  const inv = r.inventory;
  const ayId = ctx.ayIdFor(ay);
  const { rows: stageRows, missing } = ctx.dao.pipeline.stageRows(ayId ? [ayId] : []);
  const stageByUnit = new Map(); for (const s of stageRows) stageByUnit.set(String(s.unit), s);
  const targetByUnit = new Map(), nextTargetByUnit = new Map();
  for (const t of r.targets) { if (!t.unitId) continue; if (t.ay === ay) targetByUnit.set(t.unitId, t); else if (t.ay === ay + 1) nextTargetByUnit.set(t.unitId, t); }
  const notesByRow = new Map();
  for (const n of ctx.dao.pipeline.notesForAy(ayId)) { const k = String(n.status_row); if (!notesByRow.has(k)) notesByRow.set(k, []); notesByRow.get(k).push({ id: String(n.id), date: toISO(n.note_date) || toISO(n.created), author: n.author_name || String(n.author || ''), text: n.text || '', mentions: parseMentions(n.mentions) }); }
  const lookups = ctx.load().lookups;
  const out = [];
  // Tours per unit for this AY: by the AY field when it exists, else by date (a year before AY start through AY end).
  const tourByUnit = new Map();
  try {
    const ayId = ctx.ayIdFor(ay); const have = ctx.dao.tours.fields();
    const raw = ctx.dao.tours.list(have.ay && ayId ? { ayId } : { from: addDays(`${ay}-01-01`, -200), to: ayEndDate(ay) });
    for (const t of tourRows(ctx, raw)) { if (!t.unitId || t.outcome === 'CANCELLED') continue; const cur = tourByUnit.get(t.unitId) || { n: 0, last: null, next: null }; cur.n += 1; if (t.date < ctx.today && (!cur.last || t.date > cur.last)) cur.last = t.date; if (t.date >= ctx.today && (!cur.next || t.date < cur.next)) cur.next = t.date; tourByUnit.set(t.unitId, cur); }
  } catch (e) { ctx.log && ctx.log.error && ctx.log.error({ title: 'pipeline: tours', details: e && e.message }); }
  const segment = ctx.params.segment === 'str' ? 'STR' : 'STUDENT';
  const prior = r.prior ? r.prior.placement : null;
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
    // the lease that governs the row: executed first, then in process, then whichever covers beds
    const governing = leases.find((l) => l.lease.statusKey === 'EXECUTED') || leases.find((l) => l.lease.statusKey === 'IN_PROCESS') || leases[0] || null;
    // a statusless lease on this unit: the deal exists but is out of every statistic (v2 "no status" tag)
    const draft = !leases.length ? [...r.placement.leaseResults.values()].find((x) => x.code === 'NO_STATUS' && !x.year.carried && (x.scope.unitId === u.id || (u.propertyOnly && x.scope.propertyId === p.id && !x.scope.unitId))) || null : null;
    const s = stageByUnit.get(u.id) || null;
    const stageKey = s ? effectiveStage({ stage: s.stage_name || lookups.stageIds[String(s.stage)] || s.stage, manualStage: lookups.stageIds[String(s.manual_stage)] || s.manual_stage, stageSource: String(s.stage_source) === '2' || s.stage_source_name === 'Lease' ? 'lease' : 'manual' }) : (governing ? (governing.lease.statusKey === 'EXECUTED' ? 'FULLY_EXECUTED' : 'LEASE_OUT') : draft ? 'READY_FOR_LEASE' : 'NONE');
    const stageSource = s ? (String(s.stage_source) === '2' ? 'lease' : 'manual') : (governing ? 'lease' : null);
    const stageDate = s ? toISO(s.stage_date) : (governing ? (governing.lease.statusKey === 'EXECUTED' ? governing.lease.signedDate : governing.lease.sentDate) : null);
    const t = targetByUnit.get(u.id) || null, nt = nextTargetByUnit.get(u.id) || null;
    const targetMonthly = t ? (t.targetMonthly ?? (t.targetPerBed != null ? t.targetPerBed * u.beds : null)) : null;
    const settleMonthly = t ? (t.settleMonthly ?? (t.settlePerBed != null ? t.settlePerBed * u.beds : null)) : null;
    const nextTargetMonthly = nt ? (nt.targetMonthly ?? (nt.targetPerBed != null ? nt.targetPerBed * u.beds : null)) : null;
    const monthlyRent = governing ? governing.lease.monthlyRent : null;
    let priorRent = null, priorOcc = 0, priorTenantIds = [];
    if (prior) { for (const l of u.leaves) { const pl = prior.leafResults.get(l.key); if (pl && pl.occupied) { priorRent = (priorRent || 0) + pl.monthly; priorOcc += l.beds; for (const pid of pl.placements.map((x) => x.leaseId)) { const lr = prior.leaseResults.get(pid); if (lr) priorTenantIds.push(...lr.lease.tenantIds); } } } }
    priorTenantIds = [...new Set(priorTenantIds)];
    const notes = s ? notesByRow.get(String(s.id)) || [] : [];
    const followup = s ? toISO(s.followup) : null;
    const editable = !!u.id && !u.propertyOnly && stageSource !== 'lease';
    const twoYear = governing && governing.lease.isTwoYear ? { year: governing.year.carried ? 2 : 1, of: governing.lease.years.length } : null;
    out.push({
      key: u.id, unitId: u.propertyOnly ? null : u.id, propertyId: p.id, property: p.name, unit: u.propertyOnly ? '(whole property)' : u.name, market: p.marketId, marketLabel: p.marketLabel, fund: p.fund, segment: p.segment,
      beds: u.beds, propertyBeds: p.beds, propertyUnits: p.units.length, free: u.beds - taken, taken, bedroomCount: u.bedrooms.length, bedrooms: u.bedrooms.map((b) => ({ id: b.id, name: b.name, beds: b.beds, free: !(r.placement.leafResults.get(b.key) || { occupied: 0 }).occupied })),
      occupiedBy: leaves.some((l) => l.occupied) ? (new Set(leaves.flatMap((l) => l.types || [])).size > 1 ? 'Mixed' : leafTypeLabel(leaves.find((l) => l.occupied))) : 'Vacant',
      occWH: leaves.reduce((s2, l) => s2 + (l.typeKey === 'WH' ? l.occupied : 0), 0), occUnit: leaves.reduce((s2, l) => s2 + (l.typeKey === 'UNIT' ? l.occupied : 0), 0), occBed: leaves.reduce((s2, l) => s2 + (l.typeKey === 'BED' ? l.occupied : 0), 0),
      stage: stageKey, stageSource, stageDate, daysInStage: daysInStage(stageDate, ctx.today), editable,
      rowId: s ? String(s.id) : null, version: s ? String(s.lastmodified) : null, missingStatusRow: !s && !u.propertyOnly,
      tours: (tourByUnit.get(u.id) || {}).n || 0, lastTour: (tourByUnit.get(u.id) || {}).last || null, nextTour: (tourByUnit.get(u.id) || {}).next || null,
      targetMonthly, targetPerBed: targetMonthly != null && u.beds ? targetMonthly / u.beds : null, settleMonthly, settlePerBed: settleMonthly != null && u.beds ? settleMonthly / u.beds : null, nextTargetMonthly, nextTargetPerBed: nextTargetMonthly != null && u.beds ? nextTargetMonthly / u.beds : null,
      monthlyRent, signedPerBed: monthlyRent != null && u.beds ? monthlyRent / u.beds : null, breach: monthlyRent != null && settleMonthly > 0 && monthlyRent < settleMonthly, vsTarget: monthlyRent != null && targetMonthly ? monthlyRent - targetMonthly : null, vsTargetPerBed: monthlyRent != null && targetMonthly && u.beds ? (monthlyRent - targetMonthly) / u.beds : null,
      sent: governing ? governing.lease.sentDate : null, signed: governing ? governing.lease.signedDate : null, leaseStart: governing ? governing.lease.start : null, leaseEnd: governing ? governing.lease.end : null, twoYear,
      priorRent: priorRent == null ? null : Number(priorRent.toFixed(2)), priorOcc, priorTenantCount: priorTenantIds.length, priorTenantIds,
      lastOffer: s ? s.last_offer : null, expectedTenants: s ? s.expected_tenants : null, followup, notes: s ? s.notes : null, leaseTerms: s && s.lease_terms ? safeJson(s.lease_terms) : null,
      noteCount: notes.length, lastNote: notes.length ? notes[notes.length - 1] : null, mentions: [...new Set(notes.flatMap((n) => n.mentions))],
      needsAction: editable && (stageKey === 'NONE' || (!!followup && followup <= ctx.today)),
      leases: leases.map((l) => ({ id: l.lease.id, name: l.lease.name, type: l.lease.typeKey, typeLabel: typeLabel(l.lease.typeKey), status: l.lease.statusKey, start: l.lease.start, end: l.lease.end, monthly: l.lease.monthlyRent, sent: l.lease.sentDate, signed: l.lease.signedDate, tenants: l.lease.tenantCount, placed: l.status === 'placed', code: l.code })),
      draftLease: draft ? { id: draft.lease.id, name: draft.lease.name, type: draft.lease.typeKey, monthly: draft.lease.monthlyRent } : null,
      rrUnitId: u.rrUnitId,
    });
  }
  return { rows: out, missing, stageRowCount: stageRows.length, priorAy: r.prior ? r.prior.ay : null };
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

export function routePipeline(ctx) {
  const ay = ctx.selectedAy(), basis = ctx.basis(), q = ctx.params;
  const built = buildPipelineRows(ctx, ay, basis);
  const sel = ctx.selection();
  const view = applyPipelineView(built.rows, { ...q, fund: sel.fund, market: sel.marketId, mentions: q.mentions === 'me' ? String(ctx.scope.userId) : q.mentions });
  return { ay, basis, priorAy: built.priorAy, selection: sel, today: ctx.today, me: String(ctx.scope.userId), ...view, stageRowCount: built.stageRowCount, missingStatusRows: built.rows.filter((r) => r.missingStatusRow).length, missingFields: built.missing, degraded: ctx.schema.degraded };
}
