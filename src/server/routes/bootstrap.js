import { MARKETS, FUND_ORDER } from '../../shared/constants.js';
import { lookupsFromLists } from '../../shared/rules/index.js';

/**
 * The bootstrap block: session, academic years, markets, funds, permitted scope, the list ids the probe
 * learned, flags and degradation. Kept to ~2 KB — labels, stages, exception texts and the theme are NOT
 * sent: both sides import them from shared/constants.js (§3.4).
 */
export function routeBootstrap(ctx) {
  ctx.probeAll();
  const lookups = lookupsFromLists(ctx.dao.portfolio.lists());
  return {
    session: { userId: ctx.scope.userId, name: ctx.scope.name, isAdmin: ctx.scope.isAdmin, today: ctx.today },
    scope: { all: ctx.scope.all, marketIds: ctx.scope.marketIds, reason: ctx.scope.reason, warnings: ctx.scope.warnings },
    academicYears: ctx.ays(), currentAy: ctx.currentAy(), defaultAy: ctx.currentAy() + 1,
    markets: MARKETS.filter((m) => ctx.inScope(m.id)).map((m) => m.id), funds: FUND_ORDER,
    ids: { stage: lookups.stageIds, leaseType: lookups.leaseTypeIds, leaseStatus: lookups.leaseStatusIds, unmatched: lookups.unmatched },
    flags: ctx.flags, degraded: ctx.schema.degraded,
    links: recordListLinks(ctx),
  };
}
/** Longer reference lists, fetched by the screens that need them. */
export function routeLists(ctx) {
  const lists = ctx.dao.portfolio.lists();
  const live = (k) => (lists[k] || []).filter((x) => x.isinactive !== 'T').map((x) => ({ id: String(x.id), name: x.name }));
  const inv = ctx.load().prepared.inventory;
  const properties = [...inv.propertiesById.values()].filter((p) => ctx.inScope(p.marketId)).map((p) => ({ id: p.id, name: p.name, market: p.marketId, units: p.units.map((id) => { const u = inv.unitsById.get(id); return { id: u.id, name: u.name, beds: u.beds, bedrooms: u.bedrooms.map((b) => ({ id: b.id, name: b.name })) }; }) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { markets: MARKETS.filter((m) => ctx.inScope(m.id)).map((m) => ({ id: m.id, label: m.label, calendar: m.calendar })), properties, schools: live('customlist_serp_schools'), hearUs: live('customlist_serp_hear_us_list'), cities: live('customlist_serp_cities'), stageList: (lists.customlist_ad_leasing_stage || []).map((x) => ({ id: String(x.id), name: x.name, inactive: x.isinactive === 'T' })), tenantStatuses: ctx.dao.people.statusList().filter((s) => s.entitytype === 'CUSTOMER') };
}

/** NetSuite list pages for the hub's own records (the change log, saved views), when the records exist. */
function recordListLinks(ctx) {
  const out = {};
  try {
    const rows = ctx.sq.few(`SELECT internalid, scriptid FROM customrecordtype WHERE scriptid IN ('CUSTOMRECORD_AD_WRITE_AUDIT', 'CUSTOMRECORD_AD_SAVED_VIEW')`);
    for (const r of rows) { const url = `/app/common/custom/custrecordentrylist.nl?rectype=${r.internalid}`; if (/WRITE_AUDIT/i.test(r.scriptid)) out.auditLog = url; if (/SAVED_VIEW/i.test(r.scriptid)) out.savedViews = url; }
  } catch (e) { /* the role cannot read customrecordtype: no links */ }
  return out;
}
