import type { WeeklyPlanningCandidateChoiceConfiguration } from './weeklyPlanningCandidateChoiceConnection';

/** Replace null with the independently frozen C5 calibration in its source-reviewed GO PR.
 * Worker candidate_choice rollout remains a separate server-side authority. */
export const WEEKLY_PLANNING_C5_CHOICE_CALIBRATION: unknown = null;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validConfiguration(value: unknown): value is WeeklyPlanningCandidateChoiceConfiguration {
  if (!record(value) || !exact(value, ['domain', 'mode', 'choicePolicy', 'semanticPolicy', 'maximumChildrenPerMenu', 'maximumDecisions'])
    || value.domain !== 'c5_effort' || !(value.mode === 'off' || value.mode === 'canary')
    || !integer(value.maximumChildrenPerMenu, 2, 254) || !integer(value.maximumDecisions, 1, 16)) return false;
  const choice = value.choicePolicy;
  const semantic = value.semanticPolicy;
  if (!record(choice) || !exact(choice, ['id', 'calibrationEvidenceId', 'rules'])
    || !text(choice.id) || !text(choice.calibrationEvidenceId)
    || !Array.isArray(choice.rules) || choice.rules.length === 0
    || !record(semantic) || !exact(semantic, ['calibrationEvidenceId', 'maximumConditionChange', 'maximumIndependentMeaning'])
    || !text(semantic.calibrationEvidenceId) || !probability(semantic.maximumConditionChange)
    || !probability(semantic.maximumIndependentMeaning)) return false;
  const menus = new Set<string>();
  for (const rule of choice.rules) {
    if (!record(rule) || !exact(rule, ['menuKind', 'optionCount', 'depth', 'minimumTopProbability', 'minimumMargin'])
      || !(rule.menuKind === 'leaves' || rule.menuKind === 'groups') || !integer(rule.optionCount, 2, 255)
      || !integer(rule.depth, 0, 16) || !probability(rule.minimumTopProbability) || !probability(rule.minimumMargin)) return false;
    const menu = JSON.stringify([rule.menuKind, rule.optionCount, rule.depth]);
    if (menus.has(menu)) return false;
    menus.add(menu);
  }
  return true;
}

/** Unknown/missing keys, malformed runtime values and failed getters are inert. */
export function validateWeeklyPlanningCandidateChoiceConfiguration(value: unknown): WeeklyPlanningCandidateChoiceConfiguration | undefined {
  try { return validConfiguration(value) ? structuredClone(value) : undefined; } catch { return undefined; }
}
