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
    case 'summary': case 'portfolio': case 'weekly': case 'exceptions': case 'today': return pick(`${route}-${combo}`);
    case 'pipeline': { const full = await pick(`pipeline-${combo}`); return { ...full, ...applyPipelineView(full.rows, params) }; }
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
export function recordUrl(type, id) {
  if (!id) return null;
  const rectype = { unit: 1058, property: 1057, lease: 1056, status: 1465 }[type];
  if (rectype) return `/app/common/custom/custrecordentry.nl?rectype=${rectype}&id=${id}`;
  if (type === 'customer') return `/app/common/entity/custjob.nl?id=${id}`;
  return null;
}
