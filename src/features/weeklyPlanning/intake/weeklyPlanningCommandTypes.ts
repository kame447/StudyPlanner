import type {
  ExamPrepScope,
  PlanningRange,
  LifeConstraintKind,
  PriorityPolicy,
  StudyScopeUnit,
} from './weeklyPlanningIntakeTypes';

export type ParsedWeeklyPlanningCommand =
  | AddUnavailableCommand
  | AddFixedEventCommand
  | UpdateLifeConstraintCommand
  | SetPriorityPolicyCommand
  | MarkCompletedUnitsCommand
  | NoteProgressBoundaryCommand
  | SetUnitRateCommand
  | SetExamScopeCommand
  | SetPlanningRangeCommand;

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
    hardness: 'hard' | 'soft';
  };
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

export interface NoteProgressBoundaryCommand {
  type: 'note_progress_boundary';
  field?: string;
  boundaryYear: number;
  ambiguity: 'completion_direction';
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