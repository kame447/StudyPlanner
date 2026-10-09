import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';

/**
 * A title states a computed amount next to a unit. `unitLabel` is the model's free wording of
 * the user's phrase and may echo the amount itself (「3時間」 for 180 minutes, 「220語」), which
 * corrupts the pair (live E: 「903時間」). The unit text is therefore derived from the typed
 * code where the label cannot be trusted:
 * - minute/hour: always named from the code, because the amount is in that unit;
 * - every other coded unit: the model wording, unless it contains a digit (a literal
 *   character-class check of a typed field, never language parsing), then the canonical label;
 * - custom with a digit-bearing label: no unit text, so no quantity phrase (null).
 * Kanji-numeral echoes (「三時間」) are not detected (known residual).
 */
const CANONICAL_UNIT_LABEL: Partial<Record<SemanticWorkloadUnitCode, string>> = {
  page: 'ページ',
  problem: '問',
  word: '語',
  lesson: 'レッスン',
  chapter: '章',
  section: '節',
  exam_year: '年分',
  mock_exam: '回分',
  session: '回',
};

const DIGIT = /[0-9０-９]/;

export function workloadUnitDisplayV5(unitCode: SemanticWorkloadUnitCode, unitLabel: string): string | null {
  if (unitCode === 'minute') return '分';
  if (unitCode === 'hour') return '時間';
  if (!DIGIT.test(unitLabel)) return unitLabel;
  return CANONICAL_UNIT_LABEL[unitCode] ?? null;
}

/** `${amount}${unit}`, or '' when no trustworthy unit text exists. */
export function workloadQuantityPhraseV5(
  amount: number | string,
  unitCode: SemanticWorkloadUnitCode,
  unitLabel: string,
): string {
  const unit = workloadUnitDisplayV5(unitCode, unitLabel);
  return unit === null ? '' : `${amount}${unit}`;
}

/** `${label} ${phrase}`, without the trailing space when the phrase is omitted. */
export function titleWithQuantityV5(label: string, phrase: string): string {
  return phrase ? `${label} ${phrase}` : label;
}
