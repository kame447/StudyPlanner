import type { WeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';

// Only the renderer's OWN output is checked. The application discloses unmet conditions;
// while any condition is unmet or unverified, the reply may not describe timing or
// conditions for ANY task (a sentence naming a satisfied task can still refer to another
// task by alias or 「も」). Exact task labels are removed first only so a task whose own
// name contains such a word (e.g. 夜の読書) is not mistaken for a claim. This never
// interprets raw user language or changes accepted facts or placement.
const CONSTRAINT_DESCRIPTION = /朝|昼|夜|午前|午後|夕方|時間帯|(?:希望|条件)(?:どおり|通り|に沿|を満)|(?:分割|分け|まとめ|調整|変更|反映|適用)(?:まし|して|でき|済)|\d+\s*(?:[:：]\s*\d+|時|分|回)|morning|afternoon|evening|night|as requested|preferences? (?:met|honou?red)/iu;

export function hasUnverifiedWeeklyPlanningPreviewConstraints(
  satisfaction: readonly WeeklyPlanningPreviewConstraintSatisfaction[] | undefined,
): boolean {
  return satisfaction?.some(fact => fact.status !== 'satisfied') === true;
}

export function claimsUnverifiedWeeklyPlanningPreviewConstraints(
  text: string,
  satisfaction: readonly WeeklyPlanningPreviewConstraintSatisfaction[] | undefined,
): boolean {
  if (!hasUnverifiedWeeklyPlanningPreviewConstraints(satisfaction)) return false;
  const labels = [...new Set(satisfaction!.map(fact => fact.taskLabel))].filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return text.split(/[。！？!?\n]/u).some(sentence => {
    // Remove longest labels first: a task called 英語の長文 must not also leave 英語.
    let narrative = sentence;
    for (const label of labels) narrative = narrative.split(label).join('');
    return CONSTRAINT_DESCRIPTION.test(narrative);
  });
}
