import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHumanStageChange, pickerStages, funnel, effectiveStage, daysInStage } from '../../src/shared/rules/stages.js';
import { foldStage, STAGES } from '../../src/shared/constants.js';
import { lookupsFromLists } from '../../src/shared/rules/index.js';
import { LISTS } from '../helpers.js';

test('lease-driven stages are rejected from the board, human stages accepted', () => {
  assert.equal(validateHumanStageChange('Lease Out - Unsigned').ok, false);
  assert.equal(validateHumanStageChange('Fully Executed').ok, false);
  assert.equal(validateHumanStageChange('Renewal Offered').ok, true);
  assert.equal(validateHumanStageChange('In Negotiations').ok, true);
  assert.equal(validateHumanStageChange('').ok, true); // clearing to No stage set
  assert.equal(validateHumanStageChange('Nonsense').ok, false);
});
test('picker offers only human-owned stages plus "No stage set"; funnel order is defined in code', () => {
  const keys = pickerStages().map((s) => s.key);
  assert.ok(!keys.includes('LEASE_OUT') && !keys.includes('FULLY_EXECUTED'));
  assert.ok(keys.includes('IN_NEGOTIATIONS'));
  const order = funnel().map((s) => s.key);
  assert.ok(order.indexOf('RENEWAL_OFFERED') < order.indexOf('IN_NEGOTIATIONS') && order.indexOf('IN_NEGOTIATIONS') < order.indexOf('READY_FOR_LEASE'));
});
test('retired list values fold on read and never appear in the picker', () => {
  assert.equal(foldStage('Renewal Accepted'), 'READY_FOR_LEASE');
  assert.ok(!pickerStages().some((s) => s.label === 'Renewal Accepted'));
  const lk = lookupsFromLists(LISTS);
  assert.equal(lk.stageIds['5'], 'FULLY_EXECUTED');
  assert.equal(lk.stageIds['3'], 'READY_FOR_LEASE');
  // "Lease Form Collection" (inactive, id 2) is retired and has no fold target yet → reported, not guessed
  assert.ok(lk.unmatched.some((u) => u.list === 'leasing_stage' && u.id === 2));
});
test('effective stage: lease source wins, else manual, else none; days in stage', () => {
  assert.equal(effectiveStage({ stage: 'Fully Executed', stageSource: 'lease', manualStage: 'Renewal Offered' }), 'FULLY_EXECUTED');
  assert.equal(effectiveStage({ stage: null, stageSource: 'manual', manualStage: 'Renewal Offered' }), 'RENEWAL_OFFERED');
  assert.equal(effectiveStage({ stage: null, manualStage: null }), 'NONE');
  assert.equal(daysInStage('2026-10-01', '2026-10-23'), 22);
  assert.equal(STAGES.length, 8);
});
test('effectiveStage accepts stage keys from the probed id lookup as well as labels and ids', async () => {
  const { effectiveStage } = await import('../../src/shared/rules/stages.js');
  assert.equal(effectiveStage({ stage: 'LEASE_OUT', manualStage: null, stageSource: 'lease' }), 'LEASE_OUT');
  assert.equal(effectiveStage({ stage: 'Lease Out - Unsigned', manualStage: 'RENEWAL_OFFERED', stageSource: 'lease' }), 'LEASE_OUT');
  assert.equal(effectiveStage({ stage: null, manualStage: 'RENEWAL_OFFERED', stageSource: 'manual' }), 'RENEWAL_OFFERED');
});
