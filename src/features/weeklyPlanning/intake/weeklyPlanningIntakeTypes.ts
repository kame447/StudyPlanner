export type PlanningIntakeStatus =
  | 'idle'
  | 'needs_scope'
  | 'range_collected'
  | 'scope_collected'
  | 'needs_exam_info'
  | 'needs_year_range'
  | 'needs_progress_clarification'
  | 'needs_unit_rate'
  | 'needs_priority_policy'
  | 'needs_life_constraints'
  | 'draft_ready'
  | 'revision_pending'
  | 'approved';

export type PlanningIntent =
  | 'weekly_study_planning'
  | 'exam_prep_planning'
  | 'regular_schedule'
  | 'study_advice'
  | 'unknown';

export type PlanningRangeConfidence = 'explicit' | 'inferred' | 'missing';

export interface PlanningRange {
  startDateTime?: string;
  endDateTime?: string;
  sourceText?: string;
  confidence: PlanningRangeConfidence;
}

export type StudyScopeUnit =
  | 'minutes'
  | 'hours'
  | 'pages'
  | 'problems'
  | 'words'
  | 'lessons'
  | 'chapters'
  | 'year_field_chunk'
  | 'topic'
  | 'unknown';

export type ExamPrepStrategyHint = 'field_first' | 'year_first' | 'unknown';

export interface ExamPrepScope {
  examType?: string;
  fields: string[];
  totalFields?: number;
  totalYears?: number;
  yearRange?: {
    startYear: number;
    endYear: number;
    sourceText: string;
  };
  strategyHint?: ExamPrepStrategyHint;
  unitModel?: StudyScopeUnit;
  unitCountHint?: number;
  rawText: string[];
}

export interface StudyTaskScope {
  title: string;
  subject?: string;
  examType?: string;
  field?: string;
  year?: number;
  unit: StudyScopeUnit;
  amount?: number;
  rawText: string;
  requiresTimeEstimate: boolean;
}

export type StudyProgressAmbiguity =
  | 'completion_direction'
  | 'year_range'
  | 'field_scope'
  | 'scope_range'
  | 'none';

export type CompletionTarget =
  | { kind: 'all'; rawText: string }
  | { kind: 'latest_n_years'; count: number; rawText: string }
  | { kind: 'up_to_reachable'; rawText: string }
  | { kind: 'year_range'; startYear: number; endYear: number; rawText: string };

export interface StudyProgress {
  field?: string;
  completedYears?: number[];
  completionTarget?: CompletionTarget;
  completionBoundaryYear?: number;
  current?: string;
  incomplete?: string[];
  ambiguity: StudyProgressAmbiguity;
  rawText: string;
}

export interface UnitRateEstimate {
  unit: StudyScopeUnit;
  minutesPerUnit?: number;
  source: 'user' | 'assumption' | 'default';
  uncertainty?: 'low' | 'medium' | 'high';
  rawText?: string;
}

export type LifeConstraintKind =
  | 'sleep'
  | 'meal'
  | 'bath'
  | 'commute'
  | 'club'
  | 'cram_school'
  | 'fixed_event'
  | 'unavailable'
  | 'buffer';

export interface LifeConstraint {
  kind: LifeConstraintKind;
  date?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  studyAvailableStart?: string;
  hardness: 'hard' | 'soft';
  rawText?: string;
}

/**
 * 計画制約として利用できる既存 schedule source の種類。
 * 発話表現(「予定表の通り」「時間割に入っている」等)ではなく、参照対象の種類を表す。
 */
export type ConstraintSourceKind = 'timetable' | 'existing_plans' | 'calendar';

/**
 * 「既存の schedule source を計画制約として利用する」という semantic intent の参照対象。
 * selector は当面 active(現在有効なもの)のみ。
 */
export interface ConstraintSourceRef {
  kind: ConstraintSourceKind;
  selector: 'active';
}

export type PriorityPolicy =
  | { kind: 'field_first'; order: string[] }
  | { kind: 'deadline_first' }
  | { kind: 'weakness_first' }
  | { kind: 'score_weight_first' }
  | { kind: 'balanced' }
  | { kind: 'unknown' };

export type PlanningIntakeMissing =
  | 'tasks_or_goals'
  | 'fixed_events'
  | 'sleep_cycle'
  | 'meal_bath_constraints'
  | 'year_range'
  | 'progress'
  | 'completion_direction'
  | 'unit_duration_estimate'
  | 'priority_policy'
  | 'next_field_after_math'
  | 'life_constraints';

export type PlanningIntakeUncertainty = 'unknown_fields_may_take_longer';

export interface PlanningIntakeState {
  status: PlanningIntakeStatus;
  intent: PlanningIntent;
  range?: PlanningRange;
  examPrepScope?: ExamPrepScope;
  tasks: StudyTaskScope[];
  progress: StudyProgress[];
  unitRates: UnitRateEstimate[];
  constraints: LifeConstraint[];
  /**
   * 計画制約として利用中の既存 schedule source(use_constraint_source intent で確定したもの)。
   * 実データの busy interval 化は generator 側の既存 capability が担う。ここは「どのソースを利用中か」の記録のみ。
   */
  constraintSourcesInUse?: ConstraintSourceRef[];
  priorityPolicy: PriorityPolicy;
  missing: PlanningIntakeMissing[];
  assumptions: string[];
  uncertainties: PlanningIntakeUncertainty[];
  questions: string[];
  shouldCreateDraft: boolean;
  shouldSavePlan: false;
  sourceTurns: string[];
}

export interface WeeklyPlanningIntakeContext {
  selectedDate: string;
  planningDayCount?: number;
}
