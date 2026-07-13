import type {
  CompletionTarget,
  ConstraintSourceKind,
  ExamPrepScope,
  PendingPlanningRangeClarification,
  PlanningRange,
  PlanningIntakeUncertainty,
  LifeConstraintKind,
  PriorityPolicy,
  StudyScopeUnit,
} from './weeklyPlanningIntakeTypes';

export type ParsedWeeklyPlanningCommand =
  | AddUnavailableCommand
  | AddFixedEventCommand
  | UpdateLifeConstraintCommand
  | UseConstraintSourceCommand
  | RequestClarificationCommand
  | SetPriorityPolicyCommand
  | MarkCompletedUnitsCommand
  | MarkCompletionTargetCommand
  | NoteProgressBoundaryCommand
  | NoteNoFixedEventsCommand
  | NoteUncertaintyCommand
  | SetUnitRateCommand
  | SetExamScopeCommand
  | SetPlanningRangeCommand
  | SetPendingPlanningRangeCommand
  | BeginWeeklyPlanningCommand;

/**
 * 「既存の schedule source を計画制約として利用する」という semantic intent。
 * 「予定表の通り」「時間割に入っている予定を使って」「登録済みの授業を考慮して」
 * 「いつもの授業を避けて」「普段通りの授業」等はすべて同じこの intent に写像する。
 * 発話表現ごとに command を増やさない。参照対象は source payload で表現する。
 */
export interface UseConstraintSourceCommand {
  type: 'use_constraint_source';
  source: {
    kind: ConstraintSourceKind;
    selector: 'active';
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AddUnavailableCommand {
  type: 'add_unavailable';
  range: {
    date?: string;
    start: string;
    end: string;
    hardness: 'hard' | 'soft';
    reason?: string;
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AddFixedEventCommand {
  type: 'add_fixed_event';
  event: {
    date?: string;
    start?: string;
    end?: string;
    durationMinutes?: number;
    hardness: 'hard' | 'soft';
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface UpdateLifeConstraintCommand {
  type: 'update_life_constraint';
  kind: Exclude<LifeConstraintKind, 'fixed_event' | 'unavailable'>;
  constraint: {
    date?: string;
    start?: string;
    end?: string;
    durationMinutes?: number;
    studyAvailableStart?: string;
    hardness: 'hard' | 'soft';
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * ユーザーがアプリの質問語句・用語の意味を聞き返す semantic intent。
 * 「固定の予定って何ですか？」「それってどういう意味？」「何を答えればいいの？」等は
 * すべてこの1つの intent に写像する。用語ごとに command を増やさない。
 * どの質問・用語・未解決 slot についての聞き返しかは target / ref で表現する。
 * これは state を進めない(missing を消さない)対話イベントであり、reducer では state を変更しない。
 */
export interface RequestClarificationCommand {
  type: 'request_clarification';
  target: 'referenced_question' | 'referenced_term' | 'unresolved_slot';
  ref?: string;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SetPriorityPolicyCommand {
  type: 'set_priority_policy';
  policy: PriorityPolicy;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface MarkCompletedUnitsCommand {
  type: 'mark_completed_units';
  field: string;
  completedYears: number[];
  mergeMode: 'replace' | 'append';
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface MarkCompletionTargetCommand {
  type: 'mark_completion_target';
  field?: string;
  target: CompletionTarget;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NoteProgressBoundaryCommand {
  type: 'note_progress_boundary';
  field?: string;
  boundaryYear: number;
  ambiguity: 'completion_direction';
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NoteNoFixedEventsCommand {
  type: 'note_no_fixed_events';
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NoteUncertaintyCommand {
  type: 'note_uncertainty';
  uncertainty: PlanningIntakeUncertainty;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SetUnitRateCommand {
  type: 'set_unit_rate';
  unitRate: {
    unit: StudyScopeUnit;
    minutesPerUnit?: number;
    source: 'user' | 'assumption' | 'default';
    uncertainty?: 'low' | 'medium' | 'high';
    rawText?: string;
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SetExamScopeCommand {
  type: 'set_exam_scope';
  scope: ExamPrepScope;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}
export interface SetPlanningRangeCommand {
  type: 'set_planning_range';
  range: PlanningRange;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SetPendingPlanningRangeCommand {
  type: 'set_pending_planning_range';
  pending: PendingPlanningRangeClarification;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface BeginWeeklyPlanningCommand {
  type: 'begin_weekly_planning';
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}
