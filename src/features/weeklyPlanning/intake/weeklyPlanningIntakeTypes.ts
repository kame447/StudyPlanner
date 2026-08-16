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

export type WeeklyPlanningRepairAgendaDomain =
  | 'semantic_uncertainty'
  | 'planning_horizon'
  | 'work_item'
  | 'commitment'
  | 'task_date_rule'
  | 'availability'
  | 'relation'
  | 'deduplication';

export type WeeklyPlanningRepairAgendaStatus =
  | 'open'
  | 'deferred'
  | 'resolved'
  | 'dropped';

export interface WeeklyPlanningRepairObligation {
  id: string;
  issueFactId: string;
  targetFactId: string | null;
  domain: WeeklyPlanningRepairAgendaDomain;
  code: string;
  impact: 'low' | 'medium' | 'high';
  status: WeeklyPlanningRepairAgendaStatus;
  createdRevision: number;
  sourceTurnId: string;
  reopenBefore: 'preview' | 'save';
}

export type WeeklyPlanningLearningStrategyProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected';

export type WeeklyPlanningLearningStrategyProposalKind =
  | 'spaced_memory_practice'
  | 'calibrate_memory_pace'
  | 'mixed_acquisition_review';

export interface WeeklyPlanningMixedAcquisitionReviewCapacityStrategy {
  trigger: 'insufficient_capacity';
  acquisition: 'longer_sessions';
  review: 'short_distributed_sessions';
  unscheduledWorkItemIds: string[];
}

export interface WeeklyPlanningLearningStrategyProposalRecord {
  id: string;
  kind: WeeklyPlanningLearningStrategyProposalKind;
  taskId: string;
  workloadFactId: string;
  scope: 'week';
  status: WeeklyPlanningLearningStrategyProposalStatus;
  suggestedSessionMinutes: {
    min: number;
    max: number;
  };
  selectedSessionMinutes?: number | null;
  capacityStrategy?: WeeklyPlanningMixedAcquisitionReviewCapacityStrategy | null;
  createdRevision: number;
  proposedAtTurnId: string;
  decidedAtTurnId: string | null;
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
  | 'spaced';

export interface StudyTaskScope {
  subject?: string;
  label?: string;
  unit?: StudyScopeUnit;
  totalAmount?: number;
  completedAmount?: number;
  remainingAmount?: number;
  rangeStart?: number;
  rangeEnd?: number;
  source?: StudyTaskSource;
  activityKind?: StudyActivityKind;
  distributionPolicy?: TaskDistributionPolicy;
}

export interface StudyProgress {
  taskId?: string;
  completedAmount?: number;
  remainingAmount?: number;
  sourceText?: string;
}

export interface UnitRate {
  taskId?: string;
  unit?: StudyScopeUnit;
  amount?: number;
  minutes?: number;
  sourceText?: string;
}

export interface PlanningConstraint {
  kind?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  sourceText?: string;
}

export interface PlanningPriorityPolicy {
  kind: 'unknown' | string;
}

export type WeeklyPlanningQuestionContextKind =
  | 'missing'
  | 'options'
  | 'confirmation';

export interface WeeklyPlanningLastQuestionContext {
  kind: WeeklyPlanningQuestionContextKind;
  targetSlot: string;
  intent: string;
  topicId?: string;
  actionId?: string;
}

export interface PlanningIntakeState {
  status: PlanningIntakeStatus;
  intent: PlanningIntent;
  range?: PlanningRange;
  pendingRangeClarification?: PendingPlanningRangeClarification;
  tasks: StudyTaskScope[];
  progress: StudyProgress[];
  unitRates: UnitRate[];
  constraints: PlanningConstraint[];
  priorityPolicy: PlanningPriorityPolicy;
  missing: string[];
  assumptions: string[];
  uncertainties: string[];
  questions: string[];
  lastQuestionContext?: WeeklyPlanningLastQuestionContext;
  shouldCreateDraft: boolean;
  shouldSavePlan: boolean;
  draftGenerationIntent?: PlanningDraftGenerationIntent;
  groundingRecords?: WeeklyPlanningGroundingRecord[];
  repairAgenda?: WeeklyPlanningRepairObligation[];
  learningStrategyProposalRecords?: WeeklyPlanningLearningStrategyProposalRecord[];
  sourceTurns: string[];
  assumptionProposals?: AssumptionProposalRecord[];
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
}
