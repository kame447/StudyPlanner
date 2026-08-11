import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type { AssumptionProposalRecord } from './weeklyPlanningAssumptionProposals';

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

export type PlanningDraftGenerationIntent =
  | 'not_requested'
  | 'assistant_suggested'
  | 'user_authorized';

export type WeeklyPlanningGroundingStatus =
  | 'proposed'
  | 'continuation_accepted'
  | 'explicitly_accepted'
  | 'contested'
  | 'rejected';

export interface WeeklyPlanningGroundingRecord {
  id: string;
  targetFactId: string;
  interpretationKind: 'relative_date_resolution';
  status: WeeklyPlanningGroundingStatus;
  sourceExpression: string;
  startDate: string;
  endDate: string;
  proposedAtTurnId: string;
  acceptedAtTurnId: string | null;
}

export type PlanningRangeConfidence = 'explicit' | 'inferred' | 'missing';

export interface PlanningRange {
  startDateTime?: string;
  endDateTime?: string;
  sourceText?: string;
  calendarDayCount?: number;
  confidence: PlanningRangeConfidence;
}

export type PlanningTemporalScopeKind = 'next_week' | 'named_future_period';

export type PendingPlanningRangeScope =
  | {
      kind: 'next_week';
      label: string;
      windowStartDate: string;
      windowEndDate: string;
    }
  | {
      kind: 'named_future_period';
      label: string;
      windowStartDate?: string;
      windowEndDate?: string;
    };

export interface PendingPlanningRangeClarification {
  scope: PendingPlanningRangeScope;
  planningStartDate?: string;
  planningStartDateTime?: string;
  durationDays?: number;
  planningEndDateTime?: string;
  sourceText: string;
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

export type StudyTaskSource = 'command' | 'legacy_fallback';

export type StudyActivityKind =
  | 'memorization'
  | 'drill'
  | 'reading'
  | 'writing'
  | 'problem_solving'
  | 'project'
  | 'review'
  | 'unknown';

export type TaskDistributionPolicy =
  | 'single_block'
  | 'contiguous'
  | 'splittable'
  | 'spaced'
  | 'sequential_units';

export type StudyCognitiveLoad = 'light' | 'medium' | 'heavy' | 'unknown';

export interface StudyTaskExecutionProfile {
  activityKind: StudyActivityKind;
  distributionPolicy: TaskDistributionPolicy;
  cognitiveLoad: StudyCognitiveLoad;
}

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
  deadlineDeclared?: true;
  deadlineDate?: string;
  deadlineTime?: string;
  executionProfile?: StudyTaskExecutionProfile;
  unit: StudyScopeUnit;
  amount?: number;
  rawText: string;
  requiresTimeEstimate: boolean;
  source: StudyTaskSource;
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

export type StudyTimePreferenceKind = 'avoid_morning' | 'prefer_before_sleep';

export interface StudyTimePreference {
  kind: StudyTimePreferenceKind;
  taskRef?: string;
  rawText: string;
  confidence: 'high' | 'medium';
}

export type ConstraintSourceKind = 'timetable' | 'existing_plans' | 'calendar';

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
  | 'planning_period'
  | 'planning_start_date'
  | 'planning_duration'
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

export interface PlanningAssumption {
  slot: PlanningIntakeMissing;
  source: 'default' | 'derived';
  description: string;
}

export type PlanningIntakeUncertainty = 'unknown_fields_may_take_longer';

export type WeeklyPlanningQuestionContextKind =
  | 'missing'
  | 'feasibility_adjustment'
  | 'options'
  | 'preview'
  | 'approval'
  | 'ambiguity';

/**
 * 直前に実際にユーザーへ提示した質問の意味的な参照。
 * missing状態から再計算せず、次turnの短い聞き返しを解釈するためにsession-localで保持する。
 */
export interface WeeklyPlanningQuestionContext {
  kind: WeeklyPlanningQuestionContextKind;
  targetSlot?: string;
  intent?: string;
  topicId?: string;
  actionId?: string;
}

export interface PlanningIntakeState {
  status: PlanningIntakeStatus;
  intent: PlanningIntent;
  range?: PlanningRange;
  pendingPlanningRange?: PendingPlanningRangeClarification;
  examPrepScope?: ExamPrepScope;
  tasks: StudyTaskScope[];
  progress: StudyProgress[];
  unitRates: UnitRateEstimate[];
  constraints: LifeConstraint[];
  studyTimePreferences?: StudyTimePreference[];
  constraintSourcesInUse?: ConstraintSourceRef[];
  fixedEventsDeclaredNone?: true;
  priorityPolicy: PriorityPolicy;
  priorityPolicySource?: 'user' | 'derived_single_field';
  missing: PlanningIntakeMissing[];
  assumptions: string[];
  uncertainties: PlanningIntakeUncertainty[];
  questions: string[];
  lastQuestionContext?: WeeklyPlanningQuestionContext;
  shouldCreateDraft: boolean;
  shouldSavePlan: false;
  draftGenerationIntent?: PlanningDraftGenerationIntent;
  draftGenerationAuthorizedAtRevision?: number;
  groundingRecords?: WeeklyPlanningGroundingRecord[];
  /**
   * Session-local proposal ledger. UI stateと一緒に次turnへ渡すが、repository/localStorageへは保存しない。
   */
  assumptionProposalRecords?: AssumptionProposalRecord[];
  sourceTurns: string[];
}

export interface WeeklyPlanningIntakeContext {
  selectedDate: string;
  planningDayCount?: number;
  currentDateTime?: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
}
