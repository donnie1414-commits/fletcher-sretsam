/**
 * Wiring: resolve permissions, run queries, run the engine, return JSON. Thin by design (§4).
 * createApp(N) → { handle(context) }   where N = { query, record, runtime, log, file, url, cache, encode, crypto }
 */
import { createSchema } from './schema.js';
import { createSuiteQL } from './dao/suiteql.js';
import { createPortfolioDao } from './dao/portfolio.js';
import { createPipelineDao } from './dao/pipeline.js';
import { createPeopleDao } from './dao/people.js';
import { createToursDao } from './dao/tours.js';
import { createAuth } from './auth.js';
import { createWrites } from './writes.js';
import { prepare, runEngine, lookupsFromLists } from '../shared/rules/index.js';
import { normalizeLease } from '../shared/rules/lease.js';
import { overlappingLeases } from '../shared/rules/leaseDialog.js';
import { leaseScopeRow } from './routes/leaseDialog.js';
import { ayForDate, toISO, ayYearFromLabel, ayShort } from '../shared/rules/dates.js';
import { scopedSummary, scopedTree, inScope, propertyIdsInScope, keepFor } from './scoping.js';
import { routeBootstrap, routeLists } from './routes/bootstrap.js';
import { routeSummary, routePortfolio, routeWeekly, routeVelocity } from './routes/reporting.js';
import { routeUnitHistory } from './routes/unitHistory.js';
import { routeTeam } from './routes/team.js';
import { routePipeline } from './routes/pipeline.js';
import { routeTenants, routeLeads } from './routes/people.js';
import { routeTours, outcomeIdFor } from './routes/tours.js';
import { routeExceptions } from './routes/exceptions.js';
import { routeToday } from './routes/today.js';
import { routeSavedViews } from './routes/savedViews.js';
import { routeWrite } from './routes/write.js';
import { routeLeaseDialog } from './routes/leaseDialog.js';
import { routeNotes } from './routes/notes.js';
import { renderShell, serveAsset } from './shell.js';
import { MARKETS, UAS, LEASE, CUSTOMER, TOUR, SAVED_VIEW, FEATURE_FLAGS, LEAD } from '../shared/constants.js';

export function createApp(N) {
  const log = N.log;
  const schema = createSchema({ query: N.query, log, cache: N.cache ? safeCache(N.cache) : null });
  const sq = createSuiteQL({ query: N.query, log });
  const dao = { portfolio: createPortfolioDao({ sq, schema }), pipeline: createPipelineDao({ sq, schema }), people: createPeopleDao({ sq, schema }), tours: createToursDao({ sq, schema, log }) };
  const auth = createAuth({ runtime: N.runtime, sq, schema, log });

  /** Per-request context: scope, params, lazily loaded portfolio + engine runs. */
  function makeCtx(context) {
    const params = context.request.parameters || {};
    const scope = auth.resolve();
    const today = toISO(new Date());
    const flags = { ...FEATURE_FLAGS, requireOverlapForCollision: readFlag(N.runtime, 'custscript_al_overlap_rule', FEATURE_FLAGS.requireOverlapForCollision) };
    let portfolio = null; const runs = new Map(); let ayRows = null;
    const ctx = {
      N, sq, dao, schema, auth, scope, params, today, flags, log,
      ays() { if (!ayRows) ayRows = dao.portfolio.academicYears().filter((a) => a.isinactive !== 'T' && ayYearFromLabel(a.name) != null).map((a) => ({ id: String(a.id), year: ayYearFromLabel(a.name), label: a.name, short: ayShort(ayYearFromLabel(a.name)), start: toISO(a.start_date), end: toISO(a.end_date) })).sort((a, b) => a.year - b.year); return ayRows; },
      ayIdFor(year) { const a = ctx.ays().find((x) => x.year === year); return a ? a.id : null; },
      currentAy() { return ayForDate(today); },
      selectedAy() { const y = Number(params.ay); return Number.isFinite(y) && y > 2000 ? y : ctx.currentAy(); },
      basis() { return params.basis === 'executed' ? 'executed' : 'proforma'; },
      /** Load everything the engine needs for the AYs in play (selected, prior, next). */
      load() {
        if (portfolio) return portfolio;
        const years = [ctx.selectedAy() - 1, ctx.selectedAy(), ctx.selectedAy() + 1];
        const ayIds = years.map((y) => ctx.ayIdFor(y)).filter(Boolean);
        const lists = dao.portfolio.lists();
        const fixture = { properties: dao.portfolio.properties(), units: dao.portfolio.units(), leases: dao.portfolio.leases(null), targets: dao.portfolio.targets(ayIds), academic_years: dao.portfolio.academicYears(), lists };
        portfolio = { fixture, prepared: prepare(fixture, lookupsFromLists(lists)), lookups: lookupsFromLists(lists), ayIds };
        return portfolio;
      },
      /** One engine run per AY × basis per request; the prior year rides along (withPrior) so YoY, pace and same-store need no second call. */
      run(ay = ctx.selectedAy(), basis = ctx.basis(), withPrior = true) {
        const k = `${ay}:${basis}:${withPrior ? 1 : 0}`; if (runs.has(k)) return runs.get(k);
        if (withPrior && runs.has(`${ay}:${basis}:0`)) runs.delete(`${ay}:${basis}:0`);
        const p = ctx.load(); const r = runEngine(p.fixture, { ay, basis, flags, prepared: p.prepared, withPrior }); runs.set(k, r); return r;
      },
      keep(sel = ctx.selection()) { return keepFor(scope, sel); },
      marketOfProperty(propertyId) { const p = ctx.load().prepared.inventory.propertiesById.get(String(propertyId)); return p ? p.marketId : null; },
      scopedSummary: (r, sel) => scopedSummary(r, scope, sel), scopedTree: (r, sel) => scopedTree(r, scope, sel), inScope: (m) => inScope(scope, m),
      propertyIdsInScope: () => propertyIdsInScope(ctx.load().prepared.inventory, scope),
      selection() { return { fund: params.fund || null, marketId: params.market && inScope(scope, params.market) ? params.market : null }; },
      probeAll() { for (const fn of [dao.portfolio.probe, dao.pipeline.probe, dao.people.probe, dao.tours.probe]) { try { fn(); } catch (e) { log.error({ title: 'probeAll', details: e && e.message }); } } },
    };
    ctx.writes = createWrites({ record: N.record, sq, runtime: N.runtime, log, schema, auth, marketOf: (type, id, fields) => marketOf(ctx, type, id, fields), stageIdFor: (key) => { for (const [id, k] of Object.entries(ctx.load().lookups.stageIds)) if (k === key) return Number(id); return null; },
      outcomeIdFor: (key) => outcomeIdFor(dao.portfolio.lists(), key), tourFields: () => dao.tours.fields(),
      stageOf: (id) => dao.people.stageOf(id), notify: (args) => notifyMentions(N, ctx, args), overlapsFor: (fields) => leaseOverlaps(ctx, fields),
      defaultSubsidiaryId: () => { const subs = dao.portfolio.subsidiaries(); const hit = subs.find((x) => String(x.name).trim().toLowerCase() === LEAD.SUBSIDIARY_NAME.toLowerCase()) || subs.find((x) => x.parent == null); return hit ? Number(hit.id) : null; },
      findByEmail: (email) => dao.people.byEmail(email) });
    return ctx;
  }

  const routes = { bootstrap: routeBootstrap, lists: routeLists, summary: routeSummary, portfolio: routePortfolio, weekly: routeWeekly, velocity: routeVelocity, pipeline: routePipeline, unithistory: routeUnitHistory, team: routeTeam, tenants: routeTenants, leads: routeLeads, tours: routeTours, reprobe: routeReprobe, exceptions: routeExceptions, today: routeToday, savedviews: routeSavedViews, write: routeWrite, leasedialog: routeLeaseDialog, notes: routeNotes };

  function handle(context) {
    const route = String((context.request.parameters || {}).route || '').toLowerCase();
    const method = context.request.method;
    if (!route) { schema.reset(); const ctx = makeCtx(context); context.response.write(renderShell(ctx)); return; } // a full page load re-checks fields and records
    if (route === 'asset') { serveAsset({ N, params: context.request.parameters || {}, log }, context); return; }
    const started = Date.now();
    let status = 200, body;
    try {
      const fn = routes[route];
      if (!fn) { status = 404; body = { error: `unknown route ${route}` }; }
      else if (route === 'write' && method !== 'POST') { status = 405; body = { error: 'POST only' }; }
      else {
        const ctx = makeCtx(context);
        if (method === 'POST' && (context.request.headers || {})['X-Requested-With'] !== 'AmicusLeasing' && (context.request.headers || {})['x-requested-with'] !== 'AmicusLeasing') { status = 403; body = { error: 'missing X-Requested-With header' }; }
        else body = fn(ctx, method === 'POST' ? parseBody(context.request.body) : null);
      }
    } catch (e) {
      status = 500; body = { error: 'server error', message: e && e.message, code: e && e.code };
      log.error({ title: `route ${route} failed`, details: (e && e.stack) || String(e) });
    }
    body = body || {};
    if (body.meta && body.meta.status) status = body.meta.status;
    body.meta = { ...(body.meta || {}), route, ms: Date.now() - started, status };
    context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    context.response.setHeader({ name: 'Cache-Control', value: 'no-store' });
    context.response.write(JSON.stringify(body));
  }
  return { handle, schema, auth, dao };
}

/** The record's OWN market, recomputed server-side for every write (§5.9). */
export function marketOf(ctx, type, id, fields) {
  const sq = ctx.sq;
  if (type === UAS.TYPE) { if (id == null) { if (fields[UAS.PROPERTY]) return ctx.marketOfProperty(fields[UAS.PROPERTY]); const u = ctx.load().prepared.inventory.unitsById.get(String(fields[UAS.UNIT])); return u ? ctx.marketOfProperty(u.propertyId) : null; } const r = sq.one(`SELECT ${UAS.PROPERTY} AS property FROM ${UAS.TYPE} WHERE id = ?`, [Number(id)]); return r ? ctx.marketOfProperty(r.property) : null; }
  if (type === 'customrecord_ad_uas_note') { const r = sq.one(`SELECT s.${UAS.PROPERTY} AS property, s.${UAS.UNIT} AS unit FROM ${UAS.TYPE} s WHERE s.id = ?`, [Number(fields.custrecord_ad_note_status)]); if (!r) return null; if (r.property) return ctx.marketOfProperty(r.property); const u = ctx.load().prepared.inventory.unitsById.get(String(r.unit)); return u ? ctx.marketOfProperty(u.propertyId) : null; }
  if (type === LEASE.TYPE) { const prop = fields[LEASE.PROPERTY] ?? (id ? (sq.one(`SELECT ${LEASE.PROPERTY} AS property FROM ${LEASE.TYPE} WHERE id = ?`, [Number(id)]) || {}).property : null); return ctx.marketOfProperty(prop); }
  if (type === CUSTOMER.TYPE) {
    // A tenant's market is any of their properties; a tenant with none belongs to the fixing queue of every scoped user (A-9).
    // Assigned properties must themselves be in scope.
    const assigned = Array.isArray(fields[CUSTOMER.PROPERTY]) ? fields[CUSTOMER.PROPERTY] : [];
    for (const p of assigned) { const m = ctx.marketOfProperty(p); if (!ctx.inScope(m)) return m || 'unknown'; }
    if (id == null) return assigned.length ? ctx.marketOfProperty(assigned[0]) : (ctx.scope.all ? 'unknown' : ctx.scope.marketIds[0] || null); // a new lead: its property's market, else the creator's own
    const links = sq.few(`SELECT maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone = ?`, [Number(id)]);
    if (!links.length) return ctx.scope.all ? 'unknown' : ctx.scope.marketIds[0] || null;
    for (const l of links) { const m = ctx.marketOfProperty(l.property); if (ctx.inScope(m)) return m; }
    return ctx.marketOfProperty(links[0].property);
  }
  if (type === TOUR.TYPE) {
    // A tour's market is its unit's; without a unit (a lead with no property yet) it is the lead's property market, else the organiser's own.
    const unit = fields[TOUR.UNIT] ?? (id ? (sq.one(`SELECT ${TOUR.UNIT} AS unit FROM ${TOUR.TYPE} WHERE id = ?`, [Number(id)]) || {}).unit : null);
    if (unit) { const inv = ctx.load().prepared.inventory; const u = inv.unitsById.get(String(unit)) || (inv.bedroomsById.get(String(unit)) && inv.unitsById.get(inv.bedroomsById.get(String(unit)).unitId)); return u ? ctx.marketOfProperty(u.propertyId) : 'unknown'; }
    const company = fields.company ?? (id ? (sq.one(`SELECT company FROM ${TOUR.TYPE} WHERE id = ?`, [Number(id)]) || {}).company : null);
    if (company && company !== '$prev') { const links = sq.few(`SELECT maptwo AS property FROM ${CUSTOMER.PROPERTY_MAP} WHERE mapone = ?`, [Number(company)]); for (const l of links) { const m = ctx.marketOfProperty(l.property); if (ctx.inScope(m)) return m; } if (links.length) return ctx.marketOfProperty(links[0].property); }
    return ctx.scope.all ? 'unknown' : ctx.scope.marketIds[0] || null;
  }
  if (type === SAVED_VIEW.TYPE) return ctx.scope.all ? 'unknown' : ctx.scope.marketIds[0] || null; // owner-scoped, checked in the route
  return null;
}
/**
 * The active leases a new lease would collide with, read fresh (an earlier change in the same batch may have ended or
 * archived one). Same beds AND overlapping dates (shared rule); a property-wide lease collides with everything there.
 */
function leaseOverlaps(ctx, fields) {
  const p = ctx.load(); const inv = p.prepared.inventory;
  const propertyId = fields[LEASE.PROPERTY] != null ? String(fields[LEASE.PROPERTY]) : null;
  if (!propertyId || !fields[LEASE.START] || !fields[LEASE.END]) return [];
  const unitIds = [...inv.propertiesById.get(propertyId)?.units || []]; const bedIds = unitIds.flatMap((u) => (inv.unitsById.get(u) || { bedrooms: [] }).bedrooms.map((b) => b.id));
  const raw = ctx.sq.few(`SELECT id, name, isinactive, ${LEASE.PROPERTY} AS property, ${LEASE.UNIT} AS unit, custrecord_serp_lease_type_test AS lease_type, ${LEASE.STATUS} AS status, ${LEASE.START} AS start_date, ${LEASE.END} AS end_date, lastmodified FROM ${LEASE.TYPE} WHERE isinactive = 'F' AND (${LEASE.PROPERTY} = ${Number(propertyId)}${unitIds.length || bedIds.length ? ` OR ${LEASE.UNIT} IN (${[...unitIds, ...bedIds].map(Number).join(',')})` : ''})`);
  const existing = raw.map((r) => leaseScopeRow(inv, normalizeLease(r, { leaseTypeIds: p.lookups.leaseTypeIds, leaseStatusIds: p.lookups.leaseStatusIds, ayYears: p.prepared.ayYears })));
  const link = fields[LEASE.UNIT] != null && fields[LEASE.UNIT] !== '' ? String(fields[LEASE.UNIT]) : null;
  const scope = !link ? { level: 'property', unitId: null, bedroomIds: [] } : inv.unitsById.has(link) ? { level: 'unit', unitId: link, bedroomIds: [] } : inv.bedroomsById.has(link) ? { level: 'bedroom', unitId: inv.bedroomsById.get(link).unitId, bedroomIds: [link] } : { level: 'unit', unitId: link, bedroomIds: [] };
  return overlappingLeases(toISO(fields[LEASE.START]), toISO(fields[LEASE.END]), existing, scope);
}
/** POST ?route=reprobe — forget the field/record probes and report what is still missing (the banner's "Re-check setup"). */
function routeReprobe(ctx) { ctx.schema.reset(); ctx.probeAll(); return { degraded: ctx.schema.degraded }; }
/**
 * @mention emails: one NetSuite email per mentioned employee, from the author, with the note and a link into the hub.
 * Needs N/email; silently off without it. Returns the number sent.
 */
function notifyMentions(N, ctx, { scope, mentions, note }) {
  if (!N.email || typeof N.email.send !== 'function') return 0;
  const unit = String(note.name || '').split(' — ')[0];
  let link = '';
  try { const sc = N.runtime.getCurrentScript(); const rel = N.url.resolveScript({ scriptId: sc.id, deploymentId: sc.deploymentId, returnExternalUrl: false }); const host = N.url.resolveDomain({ hostType: N.url.HostType.APPLICATION }); link = `https://${host}${rel}#view=pipeline&q=${encodeURIComponent(unit)}`; } catch (e) { link = ''; }
  const who = scope.name || 'A colleague';
  const text = String(note.custrecord_ad_note_text || '');
  let sent = 0;
  for (const id of [...new Set(mentions.map(Number).filter((n) => n > 0 && n !== Number(scope.userId)))]) {
    try { N.email.send({ author: Number(scope.userId), recipients: [id], subject: `${who} mentioned you · ${unit}`, body: `${who} mentioned you in a leasing note on ${unit}:\n\n${text}\n\n${link ? `Open in the Leasing Hub: ${link}` : ''}`.trim() }); sent += 1; }
    catch (e) { ctx.log && ctx.log.error && ctx.log.error({ title: 'mention email failed', details: `${id}: ${e && e.message}` }); }
  }
  return sent;
}
function parseBody(body) { if (!body) return {}; if (typeof body === 'object') return body; try { return JSON.parse(body); } catch (e) { return {}; } }
function readFlag(runtime, name, dflt) { try { const v = runtime.getCurrentScript().getParameter({ name }); if (v == null || v === '') return dflt; return v === true || v === 'T' || v === 'true'; } catch (e) { return dflt; } }
function safeCache(cacheMod) { try { return cacheMod.getCache({ name: 'amicus_leasing_schema', scope: cacheMod.Scope.PROTECTED }); } catch (e) { return null; } }
