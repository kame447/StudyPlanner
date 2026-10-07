import type { WeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';

// Only the renderer's OWN output is checked. The application discloses unmet conditions;
// when any condition is unmet/unverified the renderer must leave timing/condition claims
// to that disclosure, rather than mixing a plausible acknowledgement with a false promise.
const CONSTRAINT_DESCRIPTION = /朝|昼|夜|午前|午後|夕方|時間帯|(?:希望|条件)(?:どおり|通り|に沿|を満)|(?:分割|分け|まとめ|調整|変更|反映|適用)(?:まし|して|でき|済)|\d+\s*(?:[:：]\s*\d+|時|分|回)|morning|afternoon|evening|night|as requested|preferences? (?:met|honou?red)/iu;

export function claimsUnverifiedWeeklyPlanningPreviewConstraints(
  text: string,
  satisfaction: readonly WeeklyPlanningPreviewConstraintSatisfaction[] | undefined,
): boolean {
  return satisfaction?.some(fact => fact.status !== 'satisfied') === true && CONSTRAINT_DESCRIPTION.test(text);
}
