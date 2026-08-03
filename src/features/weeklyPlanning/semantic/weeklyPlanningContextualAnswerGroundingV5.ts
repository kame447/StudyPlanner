/*
 * Semantic ownership boundary — P0 freeze
 *
 * This module currently reinterprets natural-language user text after the AI
 * response. That is a known architecture regression, not an approved extension
 * point. Do not add phrases, regular expressions, units, scenarios, or fallback
 * branches here to make an individual conversation pass.
 *
 * User utterance meaning belongs to the semantic AI. Deterministic code may
 * validate the AI-selected schema values and references, but must not infer a
 * quantity role, correction, scope change, target, or duration from user text.
 * The production callers of this helper are scheduled for removal after the
 * Phase 2 schema/reference contract is fixed.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/audits/20260803-weekly-planning-semantic-ownership-phase0-phase1.md
 */
export type WeeklyPlanningGroundedQuantityRoleV5 =
  | 'target'
  | 'remaining'
  | 'completed';

function normalizedText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function uniquePositiveMinutes(values: number[]): number[] {
  return [...new Set(values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value)))];
}

export function groundedDurationMinutesFromUserTextV5(text: string): number[] {
  const normalized = normalizedText(text);
  const minutes: number[] = [];
  let remainder = normalized;

  const hourPattern = /(\d+(?:\.\d+)?)時間(?:(半)|(\d+(?:\.\d+)?)分)?/g;
  remainder = remainder.replace(hourPattern, (_match, hours, half, extraMinutes) => {
    minutes.push(
      Number(hours) * 60
      + (half ? 30 : 0)
      + (extraMinutes ? Number(extraMinutes) : 0),
    );
    return ' ';
  });

  const englishHourPattern = /(\d+(?:\.\d+)?)(?:hours?|hrs?|h)(?![a-z])/g;
  remainder = remainder.replace(englishHourPattern, (_match, hours) => {
    minutes.push(Number(hours) * 60);
    return ' ';
  });

  const minutePattern = /(\d+(?:\.\d+)?)分/g;
  remainder = remainder.replace(minutePattern, (_match, value) => {
    minutes.push(Number(value));
    return ' ';
  });

  const englishMinutePattern = /(\d+(?:\.\d+)?)(?:minutes?|mins?|min)(?![a-z])/g;
  remainder.replace(englishMinutePattern, (_match, value) => {
    minutes.push(Number(value));
    return ' ';
  });

  return uniquePositiveMinutes(minutes);
}

export function groundedQuantityRoleFromUserTextV5(
  text: string,
): WeeklyPlanningGroundedQuantityRoleV5 | null {
  const normalized = normalizedText(text);
  const roles = new Set<WeeklyPlanningGroundedQuantityRoleV5>();

  if (
    /(?:今回|この(?:計画|予定|期間))(?:に|で|の)?(?:進めたい|やりたい|取り組みたい|行いたい|実施したい|分|量)/.test(normalized)
    || /^(?:今回分|今回の量|目標量?|目標です)/.test(normalized)
  ) {
    roles.add('target');
  }
  if (
    /(?:残り|残っている|残量|未完了|未消化|全体量|残っている全体)/.test(normalized)
  ) {
    roles.add('remaining');
  }
  if (
    /(?:完了|完了済み|済んだ|終わった|やり終えた|進め終えた|実施済み|消化済み)/.test(normalized)
  ) {
    roles.add('completed');
  }

  return roles.size === 1 ? [...roles][0] : null;
}

export function hasWeeklyPlanningContextualScopeChangeCueV5(
  text: string,
): boolean {
  const normalized = normalizedText(text);
  return /(?:別件|新しく|新規|追加|もう一つ|もう1つ|ほかにも|他にも|別の(?:予定|作業|タスク)|毎日|毎週|毎月|平日|週末)/.test(normalized);
}
