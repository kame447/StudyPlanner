import type {
  CompletionTarget,
  ConstraintSourceKind,
  ExamPrepScope,
  PendingPlanningRangeClarification,
  PendingPlanningRangeScope,
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
  | NormalizedSetPendingPlanningRangeCommand
  | BeginWeeklyPlanningCommand
  | AuthorizeDraftGenerationCommand
  | SetStudyGoalCommand;

export type WeeklyPlanningCommandPayload =
  | Exclude<ParsedWeeklyPlanningCommand, { type: 'set_pending_planning_range' }>
  | SetPendingPlanningRangeCommand;

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

export type PendingPlanningRangeCommandScope =
  | {
      kind: 'next_week';
      label: string;
      windowStartDate?: string;
      windowEndDate?: string;
    }
  | Extract<PendingPlanningRangeScope, { kind: 'named_future_period' }>;

export interface PendingPlanningRangeCommandPayload {
  scope: PendingPlanningRangeCommandScope;
  planningStartDate?: string;
  planningStartDateTime?: string;
  durationDays?: number;
  planningEndDateTime?: string;
  sourceText: string;
}

export interface SetPendingPlanningRangeCommand {
  type: 'set_pending_planning_range';
  pending: PendingPlanningRangeCommandPayload;
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NormalizedSetPendingPlanningRangeCommand
  extends Omit<SetPendingPlanningRangeCommand, 'pending'> {
  pending: PendingPlanningRangeClarification;
}

export interface BeginWeeklyPlanningCommand {
  type: 'begin_weekly_planning';
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AuthorizeDraftGenerationCommand {
  type: 'authorize_draft_generation';
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high';
}

export interface SetStudyGoalCommand {
  type: 'set_study_goal';
  goal: {
    title: string;
    subject?: string;
    unit?: StudyScopeUnit;
    amount?: number;
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}
