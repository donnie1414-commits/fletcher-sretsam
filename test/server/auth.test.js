import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, parseMarketList } from '../../src/server/auth.js';
import { fakeRuntime, fakeSuiteQL, fakeLog, fakeSchema } from './fakes.js';

function build({ employeeMarkets = '', params = {}, roleId = 1000, missingField = false } = {}) {
  const sq = fakeSuiteQL([[/FROM employee WHERE id/, () => [{ markets: employeeMarkets }]]]);
  const schema = fakeSchema(missingField ? new Set(['employee.custentity_lkr_markets']) : new Set());
  return createAuth({ runtime: fakeRuntime({ roleId, params }), sq, schema, log: fakeLog });
}
test('blank employee field means NO access, even with a permissive deployment', () => {
  const s = build({ employeeMarkets: '', params: { custscript_lkr_markets: 'Bethlehem, Troy' } }).resolve();
  assert.equal(s.all, false); assert.equal(s.marketIds.length, 0); assert.match(s.reason, /blank/);
});
test('effective markets are the intersection; narrower wins', () => {
  const s = build({ employeeMarkets: 'Bethlehem, Troy, Providence', params: { custscript_lkr_markets: 'Troy, Savannah' } }).resolve();
  assert.deepEqual(s.marketIds, ['troy']);
});
test('blank deployment parameter does not narrow; employee field alone decides', () => {
  const s = build({ employeeMarkets: 'Binghamton' }).resolve();
  assert.deepEqual(s.marketIds, ['binghamton']);
});
test('administrator bypass sees everything; lock toggle off sees everything', () => {
  assert.equal(build({ roleId: 3 }).resolve().all, true);
  assert.equal(build({ employeeMarkets: '', params: { custscript_lkr_user_lock: 'F' } }).resolve().all, true);
});
test('missing employee field (not yet created) denies by default and says why', () => {
  const s = build({ missingField: true, employeeMarkets: 'Troy' }).resolve();
  assert.equal(s.marketIds.length, 0); assert.match(s.reason, /does not exist/);
});
test('city spellings fold onto markets; unknown names are reported, not granted', () => {
  const p = parseMarketList('bethlehem, New Orleans, Atlantis');
  assert.deepEqual([...p.ids].sort(), ['lehigh', 'new-orleans']); assert.deepEqual(p.unknown, ['Atlantis']);
});
test('can(): unknown market is never writable by a scoped user; scoped user cannot touch another market', () => {
  const auth = build({ employeeMarkets: 'Troy' }); const s = auth.resolve();
  assert.equal(auth.can(s, 'troy'), true); assert.equal(auth.can(s, 'lehigh'), false); assert.equal(auth.can(s, null), false); assert.equal(auth.can(s, 'unknown'), false);
  assert.deepEqual(auth.filterMarkets(s, ['troy', 'lehigh']), ['troy']);
});
