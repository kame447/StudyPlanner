import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';

/**
 * Unit text for a title that states a computed amount. A clock unit is named from its typed
 * code because the amount is in that unit; `unitLabel` is the model's free wording of the
 * user's phrase (for example 「3時間」 for 180 minutes) and would corrupt the pair (live E:
 * 「903時間」). Every other unit keeps the model's wording.
 */
export function workloadUnitDisplayV5(unitCode: SemanticWorkloadUnitCode, unitLabel: string): string {
  if (unitCode === 'minute') return '分';
  if (unitCode === 'hour') return '時間';
  return unitLabel;
}
