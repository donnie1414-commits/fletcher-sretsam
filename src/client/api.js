/**
 * JSON transport. In NetSuite: fetch(scriptUrl + '&route=…'). In the preview harness window.__AL_PREVIEW
 * answers from precomputed files with the same pure view helpers the server uses.
 */
import { applyPipelineView, applyTenantView } from '../shared/rules/views.js';

const cache = new Map();
let bootstrap = null;
export function getBootstrap() {
  if (bootstrap) return bootstrap;
  const el = document.getElementById('al-bootstrap');
  bootstrap = el ? JSON.parse(el.textContent) : null;
  return bootstrap;
}
export const isPreview = () => !!window.__AL_PREVIEW;
function scriptBase() { const u = new URL(window.location.href); u.hash = ''; return u.toString(); }

async function previewGet(route, params) {
  const pv = window.__AL_PREVIEW;
  const load = async (name) => { const key = `file:${name}`; if (!cache.has(key)) cache.set(key, fetch(`${pv.base}${name}.json`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); })); return cache.get(key); };
  const ay = params.ay || pv.defaultAy, basis = params.basis || 'proforma';
  const combo = `${ay}-${basis}`;
  const has = (name) => pv.files.includes(name);
  const pick = (name) => (has(name) ? load(name) : Promise.reject(new Error(`Preview has no data for AY ${ay} ${basis}. Available: ${pv.combos.join(', ')}.`)));
  switch (route) {
    case 'bootstrap': return load('bootstrap');
    case 'lists': return load('lists');
    case 'summary': case 'portfolio': case 'exceptions': case 'today': case 'velocity': return pick(`${route}-${combo}`);
    case 'weekly': {
      // the preview precomputes the current week and the three before it; other weeks fall back to the nearest one
      const wk = params.week ? pv.weeks.filter((w) => w <= params.week).pop() || pv.weeks[pv.weeks.length - 1] : null;
      const base = params.groupBy === 'fund' ? `weekly-${combo}-fund` : `weekly-${combo}`;
      if (wk && has(`${base}-${wk}`)) return load(`${base}-${wk}`);
      const cur = await pick(has(base) ? base : `weekly-${combo}`);
      return params.week && wk !== cur.week ? { ...cur, previewNote: `Preview: only the last ${pv.weeks.length} weeks are precomputed; showing ${cur.week}.` } : cur;
    }
    case 'pipeline': { const full = await pick(`pipeline-${combo}`); return { ...full, ...applyPipelineView(full.rows, { ...params, mentions: params.mentions === 'me' ? full.me : params.mentions }) }; }
    case 'unithistory': {
      const full = await pick(`pipeline-${combo}`); const row = full.rows.find((r) => r.key === String(params.unit));
      if (!row) throw Object.assign(new Error(`unit ${params.unit} not in the preview`), { status: 404 });
      const label = (y) => `AY ${String(y).slice(2)}-${String(y + 1).slice(2)}`;
      return { ay, unit: { key: row.key, unitId: row.unitId, name: row.unit, propertyId: row.propertyId, property: row.property, market: row.market, marketLabel: row.marketLabel, beds: row.beds, free: row.free, bedrooms: row.bedrooms, occupiedBy: row.occupiedBy, occWH: row.occWH, occUnit: row.occUnit, occBed: row.occBed, leaseStart: row.leaseStart, leaseEnd: row.leaseEnd },
        years: [{ year: ay - 1, label: label(ay - 1), monthly: row.priorRent, perBed: row.priorRent != null && row.priorOcc ? row.priorRent / row.priorOcc : null, status: row.priorRent != null ? `Signed · ${row.priorOcc} of ${row.beds} beds` : 'No lease on this unit', kind: 'prior' }, { year: ay, label: label(ay), monthly: row.targetMonthly, perBed: row.targetPerBed, actual: row.monthlyRent, status: row.monthlyRent != null ? 'Signed' : 'Not started', kind: 'current' }, { year: ay + 1, label: label(ay + 1), monthly: row.nextTargetMonthly, perBed: row.nextTargetPerBed, status: row.nextTargetMonthly == null ? 'Targets not set yet' : 'Target', kind: 'next' }],
        settleMonthly: row.settleMonthly, settlePerBed: row.settlePerBed, breach: row.breach, lastOffer: row.lastOffer, expectedTenants: row.expectedTenants, followup: row.followup, stage: row.stage, stageSource: row.stageSource, stageDate: row.stageDate, daysInStage: row.daysInStage, sent: row.sent, signed: row.signed, twoYear: row.twoYear, leases: row.leases, draftLease: row.draftLease, log: [], notes: row.lastNote ? [row.lastNote] : [], legacyNotes: row.notes, priorTenants: Array.from({ length: row.priorTenantCount }, (_, i) => ({ id: row.priorTenantIds[i], name: `Tenant #${row.priorTenantIds[i]} (redacted)` })), priorAyLabel: label(ay - 1) };
    }
    case 'leasedialog': {
      const full = await pick(`pipeline-${combo}`); const row = full.rows.find((r) => r.unitId === String(params.unit));
      if (!row) throw Object.assign(new Error('unit not in the preview'), { status: 404 });
      const boot = await load('bootstrap'); const lists = await load('lists');
      const market = (lists.markets || []).find((m) => m.id === row.market) || null;
      const siblings = full.rows.filter((r) => r.propertyId === row.propertyId && r.unitId);
      const ayRow = boot.academicYears.find((a) => a.year === Number(ay)) || {}, next = boot.academicYears.find((a) => a.year === Number(ay) + 1) || {};
      return { ay: Number(ay), ayId: ayRow.id, ayNextId: next.id, basis, property: { id: row.propertyId, name: row.property, marketId: row.market, calendar: market ? market.calendar : null, units: siblings.map((r) => ({ id: r.unitId, name: r.unit, beds: r.beds, targetMonthly: r.targetMonthly, settleMonthly: r.settleMonthly })) }, unit: { id: row.unitId, name: row.unit, beds: row.beds, targetMonthly: row.targetMonthly, settleMonthly: row.settleMonthly, bedrooms: row.bedrooms }, priorTenantNames: [], ids: { leaseType: Object.fromEntries(Object.entries(boot.ids.leaseType).map(([id, k]) => [k, id])), groupType: { NEW: '1', TRANSFER: '2', RENEWAL: '3' } } };
    }
    case 'notes': { const full = await pick(`pipeline-${combo}`); const row = full.rows.find((r) => r.rowId === String(params.row)); return { rowId: params.row, legacy: row ? row.notes : null, notes: row && row.lastNote ? [row.lastNote] : [] }; }
    case 'team': return { me: '42', team: [], available: false };
    case 'tenants': { const full = await load('tenants'); return { ...full, ...applyTenantView(full.rows, params) }; }
    case 'leads': return { error: 'Leads workspace is not designed yet: the §5.5.0 lead discovery write-up is awaiting review.', meta: { status: 501 } };
    case 'savedviews': { try { return { views: JSON.parse(localStorage.getItem('al.views') || '[]') }; } catch (e) { return { views: [] }; } }
    default: throw new Error(`preview: unknown route ${route}`);
  }
}
export async function api(route, params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const key = route + JSON.stringify(clean);
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    if (isPreview()) return previewGet(route, clean);
    const u = new URL(scriptBase()); u.searchParams.set('route', route); for (const [k, v] of Object.entries(clean)) u.searchParams.set(k, v);
    const res = await fetch(u.toString(), { headers: { 'X-Requested-With': 'AmicusLeasing' }, credentials: 'same-origin' });
    const body = await res.json();
    if (body.error) throw Object.assign(new Error(body.error), { status: body.meta && body.meta.status });
    return body;
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
export function invalidate(prefix) { for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k); }
export async function post(route, body) {
  if (isPreview()) {
    if (route === 'savedviews') { try { let views = JSON.parse(localStorage.getItem('al.views') || '[]'); const v = body.view; if (body.delete) views = views.filter((x) => x.id !== v.id); else if (v.id) views = views.map((x) => (x.id === v.id ? { ...x, ...v } : x)); else views.push({ ...v, id: String(Date.now()), mine: true }); localStorage.setItem('al.views', JSON.stringify(views)); } catch (e) { /* ignore */ } invalidate('savedviews'); return { results: [{ ok: true }] }; }
    return { results: (body.changes || []).map((c) => ({ changeId: c.changeId, ok: false, code: 'PREVIEW', message: 'Preview mode: nothing is written to NetSuite.' })), deferred: [] };
  }
  const u = new URL(scriptBase()); u.searchParams.set('route', route);
  const res = await fetch(u.toString(), { method: 'POST', headers: { 'X-Requested-With': 'AmicusLeasing', 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  return res.json();
}
export function recordUrl(type, id, { edit = false } = {}) {
  if (!id) return null;
  const rectype = { unit: 1058, property: 1057, lease: 1056, status: 1465 }[type];
  if (rectype) return `/app/common/custom/custrecordentry.nl?rectype=${rectype}&id=${id}${edit ? '&e=T' : ''}`;
  if (type === 'customer') return `/app/common/entity/custjob.nl?id=${id}`;
  return null;
}
