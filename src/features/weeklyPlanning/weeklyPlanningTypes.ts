import type { PlanType, ScheduleTemplate } from '../../types/domain';
import type { WeeklyPlanDraftBlock } from './types';

export interface WeeklyPlanningTaskAmount {
  unit:
    | 'minutes'
    | 'words'
    | 'items'
    | 'pages'
    | 'problems'
    | 'passages'
    | 'years'
    | 'chapter'
    | 'material';
  value?: number;
  text: string;
  daily: boolean;
}

export interface SimpleWeeklyTask {
  title: string;
  durationMinutes: number;
  amount: WeeklyPlanningTaskAmount;
  requiresTimeEstimate: boolean;
  type: PlanType;
  sourceText: string;
  priority: 'normal' | 'high';
  deadlineDate?: string;
}

export type StudyTaskProfileScore = 1 | 2 | 3 | 4 | 5;

export interface StudyTaskProfile {
  cognitiveLoad: StudyTaskProfileScore;
  contextRetentionCost: StudyTaskProfileScore;
  chunkability: StudyTaskProfileScore;
  feedbackGranularity: StudyTaskProfileScore;
  fatigueRisk: StudyTaskProfileScore;
  switchingCost: StudyTaskProfileScore;
  repetitionBenefit: StudyTaskProfileScore;
  deadlinePressure: StudyTaskProfileScore;
}

export type SessionLengthPolicyMode =
  | 'short_focus'
  | 'balanced'
  | 'deep_work'
  | 'user_fixed';

export interface SessionLengthPolicy {
  mode: SessionLengthPolicyMode;
  minSessionMinutes: number;
  targetSessionMinutes: number;
  maxSessionMinutes: number;
  allowSmallRemainder: boolean;
  userExplicit?: boolean;
}

export type SessionLengthPolicyOverride = Partial<
  Omit<SessionLengthPolicy, 'userExplicit'>
> & {
  userExplicit?: boolean;
};

export interface SessionLengthPolicyOptions {
  maxSessionMinutes?: number;
  minSessionMinutes?: number;
  override?: SessionLengthPolicyOverride;
}

export interface SessionChunkPlan {
  chunks: number[];
  score: number;
  reason: string;
}

export interface UserTaskPreferenceProfile {
  taskKey: string;
  sampleCount: number;
  confidence: number;
  preferredSessionMinutes: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  dislikesTinyBlocks: number;
  prefersLongSessions: number;
  completionRate: number;
  morningReliability: number;
  nightHeavyTaskReliability: number;
}

export interface UserPlanningProfile {
  version: 1;
  feedbackCount: number;
  confidence: number;
  preferredSessionMinutes: number;
  minSessionMinutes: number;
  maxSessionMinutes: number;
  dislikesTinyBlocks: number;
  prefersLongSessions: number;
  morningReliability: number;
  nightHeavyTaskReliability: number;
  taskPreferences: Record<string, UserTaskPreferenceProfile>;
}

export type WeeklyPlanningFeedbackSignal =
  | {
      kind: 'block_deleted';
      durationMinutes: number;
      taskTitle?: string;
      taskProfile?: StudyTaskProfile;
      startTime?: string;
    }
  | {
      kind: 'session_resized';
      fromMinutes: number;
      toMinutes: number;
      taskTitle?: string;
      taskProfile?: StudyTaskProfile;
      startTime?: string;
    }
  | {
      kind: 'session_moved';
      durationMinutes?: number;
      taskTitle?: string;
      taskProfile?: StudyTaskProfile;
      fromStartTime: string;
      toStartTime: string;
    }
  | {
      kind: 'session_completed';
      durationMinutes: number;
      taskTitle?: string;
      taskProfile?: StudyTaskProfile;
      startTime?: string;
    }
  | {
      kind: 'session_uncompleted';
      durationMinutes: number;
      taskTitle?: string;
      taskProfile?: StudyTaskProfile;
      startTime?: string;
    }
  | {
      kind: 'explicit_preference';
      taskTitle?: string;
      taskProfile?: StudyTaskProfile;
      preferredSessionMinutes?: number;
      minSessionMinutes?: number;
      maxSessionMinutes?: number;
      dislikesTinyBlocks?: number;
      prefersLongSessions?: number;
    };

export interface PersonalizedSessionPolicy extends SessionLengthPolicy {
  basePolicy: SessionLengthPolicy;
  confidence: number;
  personalizationApplied: boolean;
  taskPreference?: UserTaskPreferenceProfile;
  reasons: string[];
}

export interface PersonalizedSessionPolicyInput {
  taskTitle?: string;
  taskProfile: StudyTaskProfile;
  basePolicy?: SessionLengthPolicy;
  userProfile?: UserPlanningProfile;
  explicitOverride?: SessionLengthPolicyOverride;
}

export type StudyTaskProfileInput =
  | string
  | Partial<
      Pick<
        SimpleWeeklyTask,
        'title' | 'sourceText' | 'durationMinutes' | 'deadlineDate'
      >
    >;

export interface TimeInterval {
  startMinutes: number;
  endMinutes: number;
}

export interface AvailabilitySlot extends TimeInterval {
  date: string;
}

export type SessionIntentScope = 'task' | 'global';

export type SessionIntentKind =
  | 'prefer_long'
  | 'fixed_two_hour'
  | 'one_shot_first'
  | 'consolidate';

export interface SessionIntentOverride {
  scope: SessionIntentScope;
  kind: SessionIntentKind;
  targetSessionMinutes?: number;
  appliesToTaskTitle?: string;
}

export interface PlacementScoreComponents {
  preferredWindowBonus: number;
  dailyLoadPenalty: number;
  sameTaskPenalty: number;
  subjectSpreadBonus: number;
  compactnessPenalty: number;
  explicitOverrideBonus: number;
  preferredDateBonus: number;
  fallbackPenalty: number;
  subjectAnchorBonus: number;
  sameDayFragmentationPenalty: number;
  subjectSwitchPenalty: number;
  heavyTaskLatePenalty: number;
}

export interface WeeklyPlanningSessionBlock {
  title: string;
  type: PlanType;
  durationMinutes: number;
  sourceTaskMinutes: number;
  sourceText: string;
  allowTinySession: boolean;
  minimumUsefulSessionMinutes: number;
  splitIndex: number;
  splitCount: number;
  priority: 'normal' | 'high';
  deadlineDate?: string;
  retryLevel?: number;
  preferredDate?: string;
  dayQuotaMinutes?: number;
  consolidationIntent?: boolean;
  sessionIntentKind?: SessionIntentKind;
  sessionIntentScope?: SessionIntentScope;
}


export interface WeeklyPlanningDefaultConditions {
  startDate: string;
  dayCount: number;
  reserveDate: string;
  wakeTime: string;
  sleepStartTime: string;
  bufferMinutes: number;
  minStudyBlockMinutes: number;
  maxSessionMinutes: number;
  breakMinutes: number;
  deepNightAllowed: boolean;
  unavailableRanges: Array<{
    startTime: string;
    endTime: string;
    reason: string;
  }>;
  availableStudyRanges: Array<{
    startTime: string;
    endTime: string;
    reason: string;
  }>;
  preferredStudyRanges: Array<{
    startTime: string;
    endTime: string;
    reason: string;
  }>;
}

export interface WeeklyPlanningRequestAssessment {
  kind:
    | 'empty'
    | 'needs_task_details'
    | 'needs_confirmation'
    | 'needs_time_estimate'
    | 'ready';
  tasks: SimpleWeeklyTask[];
  defaults: WeeklyPlanningDefaultConditions;
  questions: string[];
  confirmationSummary: string;
}

export interface WeeklyPlanningTimetableConstraints {
  scheduleTemplates?: ScheduleTemplate[];
  timetableTermId?: string;
}

export interface AvailabilityAwareWeeklyDraftResult {
  blocks: WeeklyPlanDraftBlock[];
  placedMinutes: number;
  unplacedMinutes: number;
  warnings: string[];
  defaults: WeeklyPlanningDefaultConditions;
  diagnostics?: WeeklyPlacementDiagnostics;
}

export type WeeklyPlanningQualityPreference =
  | 'preferTaskSpread'
  | 'avoidSingleSubjectDay'
  | 'avoidTinyChunks'
  | 'avoidFragmentingHeavyTasks'
  | 'avoidSameTaskClumping';

export interface WeeklyPlanningPendingConfig {
  sourceText: string;
  tasks: SimpleWeeklyTask[];
  defaults: WeeklyPlanningDefaultConditions;
  allowPartialPlacement: boolean;
  sessionIntentOverrides?: SessionIntentOverride[];
  qualityPreferences?: WeeklyPlanningQualityPreference[];
}

export type WeeklyPlanningConditionOverrideResult =
  | {
      kind: 'updated';
      config: WeeklyPlanningPendingConfig;
      messages: string[];
    }
  | {
      kind: 'unrecognized';
      config: WeeklyPlanningPendingConfig;
      message: string;
    };

export type WeeklyConditionOperation =
  | { kind: 'setDayCount'; dayCount: number }
  | { kind: 'extendDayCount'; days: number }
  | { kind: 'setAvailableStartTime'; startTime: string }
  | { kind: 'setAvailableEndTime'; endTime: string }
  | { kind: 'setAvailableRange'; startTime: string; endTime: string }
  | { kind: 'addUnavailableRange'; startTime: string; endTime: string; reason: string }
  | { kind: 'removeUnavailableRange'; reason?: string }
  | { kind: 'setPreferredRange'; startTime: string; endTime: string }
  | { kind: 'setMaxSessionMinutes'; minutes: number }
  | { kind: 'setBreakMinutes'; minutes: number }
  | { kind: 'setSleepWindow'; startTime: string; endTime: string }
  | { kind: 'allowPartialPlacement' }
  | { kind: 'addSessionIntentOverride'; override: SessionIntentOverride }
  | { kind: 'addQualityPreference'; preference: WeeklyPlanningQualityPreference };

export interface WeeklyPlacementQualityDiagnostics {
  dailyLoadBalance: number;
  taskSpread: number;
  sameTaskClumpingPenalty: number;
  tinyChunkPenalty: number;
  compactness: number;
  preferredWindowBonus: number;
  explicitIntentOverride: boolean;
  subjectSwitchPenalty?: number;
  sameDayFragmentationPenalty?: number;
  heavyTaskLatePenalty?: number;
}

export interface SessionPlacementEvaluation {
  title: string;
  durationMinutes: number;
  preferredDate?: string;
  selected?: {
    date: string;
    startMinutes: number;
    endMinutes: number;
    score: number;
    components: PlacementScoreComponents;
  };
  rejectedCandidates?: Array<{
    date: string;
    startMinutes: number;
    endMinutes: number;
    score: number;
    components: PlacementScoreComponents;
    reason: string;
  }>;
}

export interface WeeklyPlacementDiagnostics {
  requestedMinutes: number;
  placedMinutes: number;
  unplacedMinutes: number;
  totalAvailableCapacity: number;
  totalUnavailableMinutes: number;
  existingPlanBlockedMinutes: number;
  hardViolationCount: number;
  breakMinutesConsumed: number;
  unusedAvailableMinutes: number;
  dailyCapacity: Array<{
    date: string;
    availableMinutes: number;
    placedMinutes: number;
    unusedMinutes: number;
  }>;
  placementQuality?: WeeklyPlacementQualityDiagnostics;
  sessionEvaluations?: SessionPlacementEvaluation[];
  fallbackPlacements?: Array<{
    title: string;
    durationMinutes: number;
    preferredDate: string;
    actualDate: string;
    reason: string;
  }>;
  retryEvents?: Array<{
    title: string;
    originalDurationMinutes: number;
    retriedDurations: number[];
    reason: string;
  }>;
  tinyChunkViolations?: Array<{
    title: string;
    durationMinutes: number;
    allowed: boolean;
    reason: string;
  }>;
  gapReasons?: Array<{
    date: string;
    startMinutes: number;
    endMinutes: number;
    reason: string;
  }>;
  sameSubjectGaps?: Array<{
    date: string;
    title: string;
    gapMinutes: number;
    reason: string;
  }>;
  qualityPreferences?: WeeklyPlanningQualityPreference[];
  failureReason:
    | 'capacity_shortage'
    | 'search_failure'
    | 'min_block_fragmentation'
    | 'existing_plan_conflict'
    | 'placement_retry_limit'
    | 'hard_constraint'
    | 'unknown';
}

