import type { WeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';

// Only the renderer's OWN output is checked. The application discloses unmet conditions;
// Unscoped sentences concern the whole preview; exact task labels can narrow the check.
// This never interprets raw user language or changes accepted facts or placement.
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
    // Consume longest labels first: a task called 英語の長文 must not also name 英語.
    let narrative = sentence;
    const namedLabels = labels.filter(label => {
      if (!narrative.includes(label)) return false;
      narrative = narrative.split(label).join('');
      return true;
    });
    const scoped = namedLabels.length > 0
      ? satisfaction!.filter(fact => namedLabels.includes(fact.taskLabel))
      : satisfaction;
    return hasUnverifiedWeeklyPlanningPreviewConstraints(scoped) && CONSTRAINT_DESCRIPTION.test(narrative);
  });
}
