/**
 * §5.4 — stage ownership and funnel order, enforced server-side and mirrored
 * (by import, not by copy) in the client.
 */
import { STAGES, STAGE_OWNER, foldStage, stageByKey, humanStages } from '../constants.js';
import { daysBetween } from './dates.js';

/** Validate a human-initiated stage change. Returns {ok, reason}. */
export function validateHumanStageChange(toValue) {
  const key = foldStage(toValue);
  if (key == null) return { ok: false, key: null, reason: `Unknown stage "${toValue}"` };
  const s = stageByKey(key);
  if (s.owner === STAGE_OWNER.LEASE) return { ok: false, key, reason: `"${s.label}" is lease-driven and cannot be set from the board` };
  return { ok: true, key, reason: null };
}
export function pickerStages() { return humanStages().concat([stageByKey('NONE')]).sort((a, b) => a.order - b.order); }
export function funnel() { return STAGES.slice().sort((a, b) => a.order - b.order); }
export function daysInStage(stageDate, today) {
  if (!stageDate || !today) return null;
  const d = daysBetween(stageDate, today);
  return d == null ? null : Math.max(0, d);
}
/**
 * Effective stage of a pipeline row: lease-driven source wins over manual
 * (the User Event owns those), otherwise the manual stage, otherwise NONE.
 */
export function effectiveStage(row) {
  const stage = foldStage(row.stage);
  const manual = foldStage(row.manualStage);
  if (row.stageSource === 'lease' && stage && stageByKey(stage).owner === STAGE_OWNER.LEASE) return stage;
  if (stage && stage !== 'NONE') return stage;
  return manual || 'NONE';
}
