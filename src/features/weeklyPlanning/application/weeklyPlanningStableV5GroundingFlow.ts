import type {
  PlanningIntakeState,
  WeeklyPlanningGroundingRecord,
} from '../intake/weeklyPlanningIntakeTypes';

interface SemanticDiffEntry {
  kind: string;
}

export interface StableV5SemanticDiffLike {
  added: SemanticDiffEntry[];
  superseded: SemanticDiffEntry[];
  removed: SemanticDiffEntry[];
}

function planningWindowTouched(diff: StableV5SemanticDiffLike | undefined): boolean {
  if (!diff) return false;
  return [...diff.added, ...diff.superseded, ...diff.removed]
    .some((entry) => entry.kind === 'planning_window');
}

export function stableV5RelevantContinuationAccepted(params: {
  previousState?: PlanningIntakeState;
  diff: StableV5SemanticDiffLike | undefined;
}): boolean {
  const hasProposal = (params.previousState?.groundingRecords ?? [])
    .some((record) => record.status === 'proposed');
  if (!hasProposal) return false;
  if (params.previousState?.lastQuestionContext?.targetSlot !== 'stable_v5:missing_schedulable_work') {
    return false;
  }
  if (!params.diff || planningWindowTouched(params.diff)) return false;

  const workKinds = new Set([
    'task',
    'study_context',
    'component',
    'workload',
    'effort_estimate',
    'temporal_constraint',
    'task_date_rule',
    'recurrence',
    'relation',
    'availability_declaration',
    'constraint_source_request',
  ]);
  return params.diff.added.some((entry) => workKinds.has(entry.kind));
}

function monthDay(date: string): { year: string; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { year: match[1], month: Number(match[2]), day: Number(match[3]) };
}

function displayGroundedRange(startDate: string, endDate: string): string {
  const start = monthDay(startDate);
  const end = monthDay(endDate);
  if (!start || !end) return `${startDate}〜${endDate}`;
  if (startDate === endDate) return `${start.month}月${start.day}日`;
  if (start.year === end.year && start.month === end.month) {
    return `${start.month}月${start.day}日〜${end.day}日`;
  }
  if (start.year === end.year) {
    return `${start.month}月${start.day}日〜${end.month}月${end.day}日`;
  }
  return `${start.year}年${start.month}月${start.day}日〜${end.year}年${end.month}月${end.day}日`;
}

function relativeExpressionLabel(expression: string): string {
  switch (expression) {
    case 'next_week': return '来週';
    case 'this_week': return '今週';
    case 'today': return '今日';
    case 'tomorrow': return '明日';
    case 'day_after_tomorrow': return '明後日';
    default: return '対象期間';
  }
}

function newGroundingProposalPrefix(params: {
  records: readonly WeeklyPlanningGroundingRecord[];
  currentTurnId: string;
}): string {
  const record = params.records.find((candidate) =>
    candidate.status === 'proposed'
    && candidate.proposedAtTurnId === params.currentTurnId);
  if (!record) return '';
  return `${relativeExpressionLabel(record.sourceExpression)}は${displayGroundedRange(record.startDate, record.endDate)}として考えますね。`;
}

export function withStableV5GroundingProposal(params: {
  message: string;
  records: readonly WeeklyPlanningGroundingRecord[];
  currentTurnId: string;
}): string {
  const prefix = newGroundingProposalPrefix({
    records: params.records,
    currentTurnId: params.currentTurnId,
  });
  return prefix ? `${prefix}${params.message}` : params.message;
}
