/**
 * Pure list-view helpers shared by the server routes and the preview harness: filter, sort, page.
 * The server applies these to the inventory-derived rows (§6.3); the preview applies the same code
 * to precomputed rows in the browser, so both agree by construction.
 */
export const PIPELINE_SORTS = ['property', 'unit', 'beds', 'stage', 'daysInStage', 'tours', 'target', 'lastOffer', 'followup', 'available', 'monthlyRent', 'needsAction', 'signed', 'market'];

export function applyPipelineView(rows, q = {}) {
  let out = rows;
  if (q.fund) out = out.filter((r) => r.fund === q.fund);
  if (q.market) out = out.filter((r) => r.market === q.market);
  if (q.stage) { const set = new Set(String(q.stage).split(',').filter(Boolean)); if (set.size) out = out.filter((r) => set.has(r.stage)); }
  if (q.availability === 'free') out = out.filter((r) => r.free > 0); else if (q.availability === 'full') out = out.filter((r) => r.free === 0);
  if (q.tours === 'none') out = out.filter((r) => r.tours === 0); else if (q.tours === 'some') out = out.filter((r) => r.tours > 0);
  if (q.needsAction === '1' || q.needsAction === true) out = out.filter((r) => r.needsAction);
  if (q.breach === '1' || q.breach === true) out = out.filter((r) => r.breach);
  if (q.mentions) { const me = String(q.mentions); out = out.filter((r) => (r.mentions || []).includes(me)); }
  if (q.q) { const needle = String(q.q).toLowerCase(); out = out.filter((r) => `${r.property} ${r.unit} ${r.expectedTenants || ''} ${r.notes || ''} ${r.rrUnitId || ''} ${(r.leases || []).map((l) => l.name).join(' ')} ${r.priorTenants || ''}`.toLowerCase().includes(needle)); }
  const sort = PIPELINE_SORTS.includes(q.sort) ? q.sort : 'property';
  const dir = q.dir === 'desc' ? -1 : 1;
  const val = (r) => ({ property: r.property, unit: r.unit, beds: r.beds, stage: r.stage, daysInStage: r.daysInStage ?? -1, tours: r.tours, target: r.targetMonthly ?? -1, lastOffer: r.lastOffer ?? -1, followup: r.followup || '', available: r.free, monthlyRent: r.monthlyRent ?? -1, needsAction: r.needsAction ? 1 : 0, signed: r.signed || '', market: r.market })[sort];
  out = out.slice().sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return c * dir || a.property.localeCompare(b.property, undefined, { numeric: true }) || a.unit.localeCompare(b.unit, undefined, { numeric: true }); });
  const total = out.length, totalBeds = out.reduce((s, r) => s + r.beds, 0);
  const pageSize = Math.min(500, Math.max(25, Number(q.pageSize) || 100)), page = Math.max(0, Number(q.page) || 0);
  const stageCounts = {}, stageBeds = {}; let breachCount = 0, needsActionCount = 0, noStatus = 0;
  for (const r of out) { stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1; stageBeds[r.stage] = (stageBeds[r.stage] || 0) + r.beds; if (r.breach) breachCount++; if (r.needsAction) needsActionCount++; if (r.draftLease) noStatus++; }
  return { total, totalBeds, page, pageSize, rows: out.slice(page * pageSize, (page + 1) * pageSize), stageCounts, stageBeds, breachCount, needsActionCount, noStatus };
}

/** Tenant rows as the route shapes them; used by the preview shim only (the server filters in SuiteQL). */
export function applyTenantView(rows, q = {}) {
  let out = rows;
  if (q.view === 'needs-attention') out = out.filter((r) => !r.ready.ready);
  if (q.missingProperty === '1') out = out.filter((r) => r.properties.length === 0);
  if (q.missingAy === '1') out = out.filter((r) => r.academicYears.length === 0);
  if (q.status) { const set = new Set(String(q.status).split(',')); out = out.filter((r) => set.has(String(r.statusId))); }
  if (q.market) out = out.filter((r) => r.properties.some((p) => p.market === q.market) || r.properties.length === 0);
  if (q.q) { const n = String(q.q).toLowerCase(); out = out.filter((r) => `${r.name} ${r.email || ''} ${r.phone || ''} ${r.desiredLocation || ''} ${r.properties.map((p) => p.name).join(' ')}`.toLowerCase().includes(n)); }
  const sort = q.sort || 'name';
  const dir = q.dir === 'desc' ? -1 : 1;
  out = out.slice().sort((a, b) => { const x = sort === 'created' ? a.created || '' : sort === 'status' ? a.status || '' : a.name || ''; const y = sort === 'created' ? b.created || '' : sort === 'status' ? b.status || '' : b.name || ''; return String(x).localeCompare(String(y)) * dir; });
  const pageSize = Math.min(500, Math.max(25, Number(q.pageSize) || 100)), page = Math.max(0, Number(q.page) || 0);
  return { total: out.length, page, pageSize, rows: out.slice(page * pageSize, (page + 1) * pageSize) };
}
