/**
 * §3.7 / §5.10 — THE single permission resolver. Called by every read and every
 * write, recomputed from the session every time, never trusted from the client.
 *
 * Effective markets = deployment parameter ∩ employee field. Narrower wins.
 * Blank employee field ⇒ NO access (deny by default). Explicit administrator bypass.
 * The lock toggle (custscript_lkr_user_lock) OFF ⇒ everyone sees everything.
 *
 * createAuth({ runtime, sq, schema, log }) → { resolve(), can(scope, marketId), filterMarkets(scope, ids) }
 */
import { MARKET_LOCK, MARKETS, marketForCity } from '../shared/constants.js';

const ADMIN_ROLE_IDS = new Set([3]); // NetSuite Administrator role internal id
const ALL = 'ALL';

export function parseMarketList(value) {
  // Accepts "Bethlehem, Troy", ["Bethlehem","Troy"], or list ids resolved by the caller. Unknown names are dropped (and reported).
  const names = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,;|]/);
  const ids = new Set(), unknown = [];
  for (const raw of names) { const n = String(raw).trim(); if (!n) continue; const m = marketForCity(n); if (m.id === 'unknown') unknown.push(n); else ids.add(m.id); }
  return { ids, unknown };
}

export function createAuth({ runtime, sq, schema, log }) {
  function readParam(name) { try { return runtime.getCurrentScript().getParameter({ name }); } catch (e) { return null; } }
  function employeeMarkets(userId) {
    const have = schema.probe('employee', [MARKET_LOCK.EMPLOYEE_FIELD]);
    if (have.get(MARKET_LOCK.EMPLOYEE_FIELD) === false) return { present: false, ids: new Set(), unknown: [] };
    // BUILTIN.DF on a multi-select returns the joined display names; the field is never used in a WHERE expression.
    const row = sq.one(`SELECT BUILTIN.DF(${MARKET_LOCK.EMPLOYEE_FIELD}) AS markets FROM employee WHERE id = ?`, [Number(userId)]);
    const parsed = parseMarketList(row ? row.markets : '');
    return { present: true, ...parsed };
  }
  /** Compute the caller's scope. Pure function of the session + two config reads. */
  function resolve() {
    const user = runtime.getCurrentUser();
    const base = { userId: Number(user.id), roleId: Number(user.role), roleName: user.roleId || null, name: user.name || null, email: user.email || null, isAdmin: false, lockEnabled: true, markets: new Set(), all: false, reason: '', warnings: [] };
    if (ADMIN_ROLE_IDS.has(base.roleId) || String(user.roleId || '').toLowerCase() === 'administrator') { base.isAdmin = true; base.all = true; base.reason = 'administrator bypass'; return finish(base); }
    const lockParam = readParam(MARKET_LOCK.SCRIPT_PARAM_LOCK);
    base.lockEnabled = lockParam == null ? true : (lockParam === true || lockParam === 'T' || lockParam === 'true');
    if (!base.lockEnabled) { base.all = true; base.reason = 'market lock disabled on the deployment'; return finish(base); }
    const deploy = parseMarketList(readParam(MARKET_LOCK.SCRIPT_PARAM_MARKETS));
    if (deploy.unknown.length) base.warnings.push(`deployment parameter names unmapped markets: ${deploy.unknown.join(', ')}`);
    const emp = employeeMarkets(base.userId);
    if (!emp.present) { base.reason = `employee field ${MARKET_LOCK.EMPLOYEE_FIELD} does not exist — denying by default`; return finish(base); }
    if (emp.unknown.length) base.warnings.push(`employee field names unmapped markets: ${emp.unknown.join(', ')}`);
    if (emp.ids.size === 0) { base.reason = 'employee market field is blank — no access'; return finish(base); }
    const deployAll = deploy.ids.size === 0 && !deploy.unknown.length; // blank deployment list = no narrowing
    for (const id of emp.ids) if (deployAll || deploy.ids.has(id)) base.markets.add(id);
    base.reason = base.markets.size ? `employee ∩ deployment` : 'employee markets are all outside the deployment parameter — no access';
    return finish(base);
  }
  function finish(s) {
    s.marketIds = s.all ? MARKETS.map((m) => m.id) : [...s.markets];
    log && log.debug && log.debug({ title: 'auth.resolve', details: `${s.userId}/${s.roleId} ${s.all ? ALL : s.marketIds.join(',')} — ${s.reason}` });
    return s;
  }
  /** Can this scope touch a record whose market is `marketId`? Unknown market ⇒ only admins/unlocked. */
  function can(scope, marketId) { if (scope.all) return true; if (!marketId || marketId === 'unknown') return false; return scope.markets.has(marketId); }
  function filterMarkets(scope, ids) { return scope.all ? ids : ids.filter((id) => scope.markets.has(id)); }
  return { resolve, can, filterMarkets };
}
