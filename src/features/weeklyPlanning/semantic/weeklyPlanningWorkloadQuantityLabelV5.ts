import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';

// Display-only: never parse amount or change the accepted unit/quantity evidence.
// Numeric custom labels and clean standard aliases retain their information.
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

export function workloadUnitDisplayV5(unitCode: SemanticWorkloadUnitCode, unitLabel: string): string {
  if (unitCode === 'minute') return '分';
  if (unitCode === 'hour') return '時間';
  if (unitCode === 'custom' || !DIGIT.test(unitLabel)) return unitLabel;
  return CANONICAL_UNIT_LABEL[unitCode] ?? unitLabel;
}
