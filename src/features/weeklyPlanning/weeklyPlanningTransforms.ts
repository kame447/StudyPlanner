import { createId } from '../../lib/id';
import { addDays, minutesFromTime, startOfWeek, timeFromMinutes } from '../../lib/date';
import {
  detectType,
  parseDurationMinutes,
  sanitizeSuggestedTitle,
  splitAddTaskTexts,
} from '../../services/naturalLanguageRules';
import type { Plan, PlanDraft, PlanType } from '../../types/domain';
import type { WeeklyPlanDraftBlock } from './types';

const SIMPLE_DRAFT_START_TIME = '19:00';
const SIMPLE_DRAFT_MAX_BLOCK_MINUTES = 120;
const SIMPLE_DRAFT_DAY_END_MINUTES = 24 * 60;
const DEFAULT_WEEKLY_PLANNING_DAY_COUNT = 6;
const DEFAULT_WAKE_TIME = '08:00';
const DEFAULT_SLEEP_START_TIME = '24:00';
const DEFAULT_BUFFER_MINUTES = 30;
const DEFAULT_MIN_STUDY_BLOCK_MINUTES = 30;
const DEFAULT_MAX_SESSION_MINUTES = 120;
const DEFAULT_BREAK_MINUTES = 10;
const DEFAULT_UNAVAILABLE_RANGES = [
  { startTime: '12:00', endTime: '13:00', reason: '昼食' },
  { startTime: '19:00', endTime: '20:00', reason: '夕食' },
];
const DEFAULT_PREFERRED_STUDY_RANGES = [
  { startTime: '11:00', endTime: '18:00', reason: '集中しやすい日中' },
  { startTime: '20:00', endTime: '23:00', reason: '集中しやすい夜' },
];

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

interface TimeInterval {
  startMinutes: number;
  endMinutes: number;
}

interface AvailabilitySlot extends TimeInterval {
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

interface WeeklyPlanningSessionBlock {
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
  failureReason:
    | 'capacity_shortage'
    | 'search_failure'
    | 'min_block_fragmentation'
    | 'existing_plan_conflict'
    | 'placement_retry_limit'
    | 'hard_constraint'
    | 'unknown';
}

export const WEEKLY_PLANNING_CONDITION_OVERRIDE_HELP =
  '対応できる条件変更例: 「7日間で」「勉強開始9時から」「22時までで」「9時から22時で」「お昼は13〜14時」「1回90分で」「休憩15分で」「睡眠は2時から9時」「配置できる分だけでいい」。';

function normalizeWeeklyPlanningText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[：]/g, ':')
    .replace(/[〜～−―–—]/g, '~')
    .replace(/[　]/g, ' ');
}

const DEFAULT_STUDY_TASK_PROFILE: StudyTaskProfile = {
  cognitiveLoad: 3,
  contextRetentionCost: 3,
  chunkability: 3,
  feedbackGranularity: 3,
  fatigueRisk: 3,
  switchingCost: 3,
  repetitionBenefit: 3,
  deadlinePressure: 3,
};

export function clampProfileScore(score: number): StudyTaskProfileScore {
  return Math.min(5, Math.max(1, Math.round(score))) as StudyTaskProfileScore;
}

export function normalizeTaskProfileText(text: string): string {
  return normalizeWeeklyPlanningText(text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveStudyTaskProfileText(input: StudyTaskProfileInput): string {
  if (typeof input === 'string') {
    return normalizeTaskProfileText(input);
  }

  return normalizeTaskProfileText(
    [input.title, input.sourceText].filter(Boolean).join(' '),
  );
}

function applyStudyTaskProfilePatch(
  profile: StudyTaskProfile,
  patch: Partial<Record<keyof StudyTaskProfile, number>>,
): StudyTaskProfile {
  return Object.entries(patch).reduce<StudyTaskProfile>(
    (nextProfile, [key, value]) => ({
      ...nextProfile,
      [key]: clampProfileScore(value),
    }),
    profile,
  );
}

export function inferStudyTaskProfile(
  input: StudyTaskProfileInput,
): StudyTaskProfile {
  const text = resolveStudyTaskProfileText(input);
  const hasDeadline =
    (typeof input !== 'string' && Boolean(input.deadlineDate)) ||
    /締切|期限|まで|迄/.test(text);
  let profile = { ...DEFAULT_STUDY_TASK_PROFILE };

  if (/英単語|単語|語彙|ボキャブラリ|暗記|用語|定義暗記/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 5,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 5,
    });
  }

  if (/英語.*長文|長文.*英語|英文読解|長文読解|読解/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 3,
      contextRetentionCost: 3,
      chunkability: 3,
      feedbackGranularity: 3,
      fatigueRisk: 3,
      repetitionBenefit: 3,
    });
  }

  if (/java|javascript|typescript|プログラミング/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 3,
      contextRetentionCost: 3,
      switchingCost: 3,
    });
  }

  if (/(java|javascript|typescript).*(文法|復習)|(文法|復習).*(java|javascript|typescript)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 4,
      feedbackGranularity: 4,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 4,
    });
  }

  if (/(java|javascript|typescript).*(実装|開発|制作)|(実装|開発|制作).*(java|javascript|typescript)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 5,
      chunkability: 2,
      feedbackGranularity: 3,
      fatigueRisk: 3,
      switchingCost: 5,
      repetitionBenefit: 2,
    });
  }

  if (/計算理論|証明|証明問題|数学|線形代数|確率統計/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 5,
      contextRetentionCost: 4,
      chunkability: 2,
      feedbackGranularity: 3,
      fatigueRisk: 4,
      switchingCost: 3,
      repetitionBenefit: 2,
    });
  }

  if (/卒研|研究/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 4,
      fatigueRisk: 3,
      switchingCost: 4,
    });
  }

  if (/(卒研|研究).*(文献|論文|読み)|(文献|論文).*(卒研|研究)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 3,
      chunkability: 3,
      feedbackGranularity: 2,
      fatigueRisk: 4,
      switchingCost: 3,
      repetitionBenefit: 2,
    });
  }

  if (/(卒研|研究).*(アノテーション| annotation|ラベル付け)|(アノテーション|annotation|ラベル付け).*(卒研|研究)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 5,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 4,
    });
  }

  if (/(卒研|研究).*(文章|執筆|論文作成|書く)|(文章|執筆|論文作成|書く).*(卒研|研究)/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 4,
      chunkability: 3,
      feedbackGranularity: 3,
      fatigueRisk: 3,
      switchingCost: 4,
      repetitionBenefit: 2,
    });
  }

  if (/レポート|文章作成|執筆/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: Math.max(profile.cognitiveLoad, 4),
      contextRetentionCost: Math.max(profile.contextRetentionCost, 4),
      switchingCost: Math.max(profile.switchingCost, 4),
    });
  }

  if (/obsidian|整理|転記|まとめ/.test(text)) {
    profile = applyStudyTaskProfilePatch(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 4,
      feedbackGranularity: 4,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 3,
    });
  }

  if (hasDeadline) {
    profile = applyStudyTaskProfilePatch(profile, {
      deadlinePressure: 4,
    });
  }

  return profile;
}

function normalizeSessionLengthPolicy(
  policy: SessionLengthPolicy,
  absoluteMaxSessionMinutes: number,
): SessionLengthPolicy {
  const maxSessionMinutes = Math.max(
    30,
    Math.min(policy.maxSessionMinutes, absoluteMaxSessionMinutes),
  );
  const minSessionMinutes = Math.min(
    maxSessionMinutes,
    Math.max(1, policy.minSessionMinutes),
  );
  const targetSessionMinutes = Math.min(
    maxSessionMinutes,
    Math.max(minSessionMinutes, policy.targetSessionMinutes),
  );

  return {
    ...policy,
    minSessionMinutes,
    targetSessionMinutes,
    maxSessionMinutes,
  };
}

export function mergeSessionLengthPolicyOverride(
  basePolicy: SessionLengthPolicy,
  override: SessionLengthPolicyOverride | undefined,
  absoluteMaxSessionMinutes = DEFAULT_MAX_SESSION_MINUTES,
): SessionLengthPolicy {
  if (!override) {
    return normalizeSessionLengthPolicy(basePolicy, absoluteMaxSessionMinutes);
  }

  return normalizeSessionLengthPolicy(
    {
      ...basePolicy,
      ...override,
      mode: override.userExplicit
        ? override.mode ?? 'user_fixed'
        : override.mode ?? basePolicy.mode,
      userExplicit: override.userExplicit ?? basePolicy.userExplicit,
    },
    absoluteMaxSessionMinutes,
  );
}

export function deriveSessionLengthPolicy(
  profile: StudyTaskProfile,
  options: SessionLengthPolicyOptions = {},
): SessionLengthPolicy {
  const absoluteMaxSessionMinutes = Math.max(
    30,
    options.maxSessionMinutes ?? DEFAULT_MAX_SESSION_MINUTES,
  );
  const minimumSessionMinutes = Math.max(
    1,
    options.minSessionMinutes ?? DEFAULT_MIN_STUDY_BLOCK_MINUTES,
  );
  const shortFocusScore =
    profile.chunkability +
    profile.feedbackGranularity +
    profile.repetitionBenefit -
    profile.contextRetentionCost -
    profile.switchingCost +
    (6 - profile.fatigueRisk) * 0.5;
  const deepWorkScore =
    profile.cognitiveLoad +
    profile.contextRetentionCost +
    profile.switchingCost -
    profile.chunkability -
    Math.max(0, profile.fatigueRisk - 3) * 2;
  const mode: SessionLengthPolicyMode =
    shortFocusScore >= 5 && profile.contextRetentionCost <= 3
      ? 'short_focus'
      : deepWorkScore >= 8 && profile.fatigueRisk <= 3
        ? 'deep_work'
        : 'balanced';
  const basePolicyByMode: Record<
    Exclude<SessionLengthPolicyMode, 'user_fixed'>,
    SessionLengthPolicy
  > = {
    short_focus: {
      mode: 'short_focus',
      minSessionMinutes: Math.max(30, minimumSessionMinutes),
      targetSessionMinutes: 60,
      maxSessionMinutes: Math.min(90, absoluteMaxSessionMinutes),
      allowSmallRemainder: true,
    },
    balanced: {
      mode: 'balanced',
      minSessionMinutes: Math.max(45, minimumSessionMinutes),
      targetSessionMinutes: 90,
      maxSessionMinutes: absoluteMaxSessionMinutes,
      allowSmallRemainder: false,
    },
    deep_work: {
      mode: 'deep_work',
      minSessionMinutes: Math.max(60, minimumSessionMinutes),
      targetSessionMinutes: 105,
      maxSessionMinutes: absoluteMaxSessionMinutes,
      allowSmallRemainder: false,
    },
  };

  return mergeSessionLengthPolicyOverride(
    basePolicyByMode[mode],
    options.override,
    absoluteMaxSessionMinutes,
  );
}

export function normalizeSessionChunkMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes));
}

function roundChunkMinutesToFive(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

function normalizeSessionChunks(chunks: number[]): number[] {
  return chunks
    .map(normalizeSessionChunkMinutes)
    .filter((chunk) => chunk > 0)
    .sort((left, right) => right - left);
}

function sumSessionChunks(chunks: number[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk, 0);
}

function isValidSessionChunkPlan(
  chunks: number[],
  totalMinutes: number,
  policy: SessionLengthPolicy,
): boolean {
  if (chunks.length === 0 || sumSessionChunks(chunks) !== totalMinutes) {
    return false;
  }

  if (chunks.some((chunk) => chunk > policy.maxSessionMinutes || chunk <= 0)) {
    return false;
  }

  const smallChunks = chunks.filter((chunk) => chunk < policy.minSessionMinutes);

  if (smallChunks.length === 0) {
    return true;
  }

  return (
    policy.allowSmallRemainder &&
    smallChunks.length === 1 &&
    chunks[chunks.length - 1] === smallChunks[0]
  );
}

function createTargetFirstSessionCandidate(
  totalMinutes: number,
  policy: SessionLengthPolicy,
): number[] | null {
  const chunks: number[] = [];
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > policy.maxSessionMinutes) {
    const nextChunk = Math.min(policy.targetSessionMinutes, policy.maxSessionMinutes);
    chunks.push(nextChunk);
    remainingMinutes -= nextChunk;
  }

  if (remainingMinutes > 0) {
    chunks.push(remainingMinutes);
  }

  return isValidSessionChunkPlan(chunks, totalMinutes, policy)
    ? normalizeSessionChunks(chunks)
    : null;
}

function createSessionCandidateForChunkCount(
  totalMinutes: number,
  chunkCount: number,
  policy: SessionLengthPolicy,
): number[] | null {
  if (chunkCount <= 0) {
    return null;
  }

  const chunks = Array.from({ length: chunkCount }, () => policy.targetSessionMinutes);
  let deltaMinutes = sumSessionChunks(chunks) - totalMinutes;

  if (deltaMinutes > 0) {
    let cursor = chunks.length - 1;

    while (deltaMinutes > 0) {
      const current = chunks[cursor];
      const lowerBound =
        policy.allowSmallRemainder && cursor === chunks.length - 1
          ? 1
          : policy.minSessionMinutes;
      const reducibleMinutes = current - lowerBound;

      if (reducibleMinutes > 0) {
        const step = Math.min(
          deltaMinutes,
          reducibleMinutes,
          deltaMinutes >= 30 && reducibleMinutes >= 30 ? 30 : deltaMinutes,
        );
        chunks[cursor] -= step;
        deltaMinutes -= step;
      }

      cursor -= 1;

      if (cursor < 0) {
        cursor = chunks.length - 1;
      }

      if (chunks.every((chunk, index) => {
        const lowerBound =
          policy.allowSmallRemainder && index === chunks.length - 1
            ? 1
            : policy.minSessionMinutes;
        return chunk <= lowerBound;
      })) {
        break;
      }
    }
  }

  if (deltaMinutes < 0) {
    let remainingIncrease = Math.abs(deltaMinutes);
    let cursor = 0;

    while (remainingIncrease > 0) {
      const expandableMinutes = policy.maxSessionMinutes - chunks[cursor];

      if (expandableMinutes > 0) {
        const step = Math.min(remainingIncrease, expandableMinutes);
        chunks[cursor] += step;
        remainingIncrease -= step;
      }

      cursor += 1;

      if (cursor >= chunks.length) {
        cursor = 0;
      }

      if (chunks.every((chunk) => chunk >= policy.maxSessionMinutes)) {
        break;
      }
    }

    deltaMinutes = -remainingIncrease;
  }

  const normalizedChunks = normalizeSessionChunks(
    chunks.map(roundChunkMinutesToFive),
  );
  const normalizedDelta = totalMinutes - sumSessionChunks(normalizedChunks);

  if (normalizedDelta !== 0 && normalizedChunks.length > 0) {
    normalizedChunks[normalizedChunks.length - 1] += normalizedDelta;
  }

  return isValidSessionChunkPlan(normalizedChunks, totalMinutes, policy)
    ? normalizeSessionChunks(normalizedChunks)
    : null;
}

function createUserFixedMaxFirstCandidate(
  totalMinutes: number,
  policy: SessionLengthPolicy,
): number[] | null {
  if (!policy.userExplicit && policy.mode !== 'user_fixed') {
    return null;
  }

  const chunks: number[] = [];
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > policy.maxSessionMinutes) {
    chunks.push(policy.maxSessionMinutes);
    remainingMinutes -= policy.maxSessionMinutes;
  }

  if (remainingMinutes > 0) {
    chunks.push(remainingMinutes);
  }

  return isValidSessionChunkPlan(chunks, totalMinutes, policy)
    ? normalizeSessionChunks(chunks)
    : null;
}

export function createSessionChunkCandidates(
  totalMinutes: number,
  policy: SessionLengthPolicy,
): number[][] {
  const normalizedTotalMinutes = normalizeSessionChunkMinutes(totalMinutes);

  if (normalizedTotalMinutes <= 0) {
    return [];
  }

  const minimumChunkMinutes = policy.allowSmallRemainder
    ? 1
    : policy.minSessionMinutes;
  const minChunkCount = Math.max(
    1,
    Math.ceil(normalizedTotalMinutes / policy.maxSessionMinutes),
  );
  const maxChunkCount = Math.max(
    minChunkCount,
    Math.ceil(normalizedTotalMinutes / minimumChunkMinutes),
  );
  const preferredChunkCount = Math.max(
    minChunkCount,
    Math.round(normalizedTotalMinutes / policy.targetSessionMinutes),
  );
  const chunkCounts = new Set<number>([
    minChunkCount,
    preferredChunkCount,
    Math.ceil(normalizedTotalMinutes / policy.targetSessionMinutes),
    Math.floor(normalizedTotalMinutes / policy.targetSessionMinutes),
  ]);

  for (let offset = -4; offset <= 4; offset += 1) {
    chunkCounts.add(preferredChunkCount + offset);
  }

  const candidates = [
    createTargetFirstSessionCandidate(normalizedTotalMinutes, policy),
    createUserFixedMaxFirstCandidate(normalizedTotalMinutes, policy),
    ...Array.from(chunkCounts)
      .filter((chunkCount) => chunkCount >= minChunkCount && chunkCount <= maxChunkCount)
      .map((chunkCount) =>
        createSessionCandidateForChunkCount(
          normalizedTotalMinutes,
          chunkCount,
          policy,
        ),
      ),
  ];
  const uniqueCandidates = new Map<string, number[]>();

  candidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }

    const normalizedCandidate = normalizeSessionChunks(candidate);

    if (!isValidSessionChunkPlan(normalizedCandidate, normalizedTotalMinutes, policy)) {
      return;
    }

    uniqueCandidates.set(normalizedCandidate.join(','), normalizedCandidate);
  });

  return Array.from(uniqueCandidates.values());
}

export function scoreSessionChunkPlan(
  chunks: number[],
  policy: SessionLengthPolicy,
  profile: StudyTaskProfile = DEFAULT_STUDY_TASK_PROFILE,
): SessionChunkPlan {
  const normalizedChunks = normalizeSessionChunks(chunks);
  const heavyTaskScore = profile.cognitiveLoad + profile.contextRetentionCost;
  let score = 0;
  const reasons: string[] = [];

  normalizedChunks.forEach((chunk, index) => {
    const targetDistance = Math.abs(chunk - policy.targetSessionMinutes);
    score -= targetDistance;

    if (chunk === policy.targetSessionMinutes) {
      score += 28;
      reasons.push('target-match');
    }

    if (policy.mode === 'balanced' && chunk === 60) {
      score += 16;
      reasons.push('balanced-remainder');
    }

    if (policy.mode === 'short_focus' && chunk === 60) {
      score += 24;
      reasons.push('short-focus-target');
    }

    if ((policy.mode === 'deep_work' || policy.userExplicit) && chunk === 120) {
      score += 26;
      reasons.push('long-focus-allowed');
    }

    if (chunk < policy.minSessionMinutes) {
      const isAllowedFinalRemainder =
        policy.allowSmallRemainder && index === normalizedChunks.length - 1;
      score -= isAllowedFinalRemainder ? 24 : 90;
      reasons.push(isAllowedFinalRemainder ? 'small-final-remainder' : 'small-block');
    }

    if (chunk < 30) {
      score -= policy.allowSmallRemainder && index === normalizedChunks.length - 1
        ? 30
        : 120;
      reasons.push('tiny-block');
    }

    if (heavyTaskScore >= 8 && chunk < 40) {
      score -= 60;
      reasons.push('heavy-task-short-block');
    }

    if (
      chunk === policy.maxSessionMinutes &&
      policy.maxSessionMinutes > policy.targetSessionMinutes &&
      !policy.userExplicit &&
      policy.mode !== 'deep_work'
    ) {
      score -= 45;
      reasons.push('max-stickiness');
    }

    if (policy.mode === 'balanced' && chunk > policy.targetSessionMinutes) {
      score -= (chunk - policy.targetSessionMinutes) * 1.5;
      reasons.push('balanced-over-target');
    }
  });

  const smallChunks = normalizedChunks.filter(
    (chunk) => chunk < policy.minSessionMinutes,
  );

  if (smallChunks.length > 1) {
    score -= smallChunks.length * 80;
    reasons.push('multiple-small-remainders');
  }

  const maxSessionHits = normalizedChunks.filter(
    (chunk) => chunk === policy.maxSessionMinutes,
  ).length;

  if (
    maxSessionHits > 1 &&
    policy.maxSessionMinutes > policy.targetSessionMinutes &&
    !policy.userExplicit &&
    policy.mode !== 'deep_work'
  ) {
    score -= maxSessionHits * 35;
    reasons.push('repeated-max-sessions');
  }

  score -= normalizedChunks.length * 2;

  return {
    chunks: normalizedChunks,
    score,
    reason: Array.from(new Set(reasons)).join(', ') || 'neutral',
  };
}

export function splitDurationIntoSessionChunks(
  totalMinutes: number,
  policy: SessionLengthPolicy,
  profile: StudyTaskProfile = DEFAULT_STUDY_TASK_PROFILE,
): number[] {
  const normalizedTotalMinutes = normalizeSessionChunkMinutes(totalMinutes);
  const candidates = createSessionChunkCandidates(normalizedTotalMinutes, policy);

  if (candidates.length === 0) {
    if (normalizedTotalMinutes <= 0) {
      return [];
    }

    return distributeMinutesAcrossBuckets(
      normalizedTotalMinutes,
      Math.max(1, Math.ceil(normalizedTotalMinutes / policy.maxSessionMinutes)),
    );
  }

  return candidates
    .map((chunks) => scoreSessionChunkPlan(chunks, policy, profile))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (left.chunks.length !== right.chunks.length) {
        return left.chunks.length - right.chunks.length;
      }

      return left.chunks.join(',').localeCompare(right.chunks.join(','));
    })[0].chunks;
}

function clampPreference01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function blendPreference(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}

function resolveFeedbackLearningRate(profile: UserPlanningProfile): number {
  return Math.min(0.2, 0.06 + profile.confidence * 0.14);
}

function resolveTaskPreferenceLearningRate(taskPreference: UserTaskPreferenceProfile): number {
  return Math.min(0.24, 0.08 + taskPreference.confidence * 0.16);
}

function createDefaultUserTaskPreferenceProfile(
  taskKey: string,
): UserTaskPreferenceProfile {
  return {
    taskKey,
    sampleCount: 0,
    confidence: 0,
    preferredSessionMinutes: 90,
    minSessionMinutes: 45,
    maxSessionMinutes: DEFAULT_MAX_SESSION_MINUTES,
    dislikesTinyBlocks: 0.5,
    prefersLongSessions: 0.5,
    completionRate: 0.5,
    morningReliability: 0.5,
    nightHeavyTaskReliability: 0.5,
  };
}

export function createDefaultUserPlanningProfile(): UserPlanningProfile {
  return {
    version: 1,
    feedbackCount: 0,
    confidence: 0,
    preferredSessionMinutes: 90,
    minSessionMinutes: 45,
    maxSessionMinutes: DEFAULT_MAX_SESSION_MINUTES,
    dislikesTinyBlocks: 0.5,
    prefersLongSessions: 0.5,
    morningReliability: 0.5,
    nightHeavyTaskReliability: 0.5,
    taskPreferences: {},
  };
}

function resolveUserTaskPreferenceKey(params: {
  taskTitle?: string;
  taskProfile?: StudyTaskProfile;
}): string | null {
  const text = params.taskTitle ? normalizeTaskProfileText(params.taskTitle) : '';

  if (/卒研|研究/.test(text)) {
    return 'research';
  }

  if (/英単語|単語|暗記|用語|定義/.test(text)) {
    return 'memorization';
  }

  if (/java|javascript|typescript|実装|開発/.test(text)) {
    return 'implementation';
  }

  if (/英語|長文|読解/.test(text)) {
    return 'english';
  }

  if (text) {
    return text.slice(0, 32);
  }

  if (params.taskProfile?.contextRetentionCost && params.taskProfile.contextRetentionCost >= 4) {
    return 'context-heavy';
  }

  return null;
}

function isMorningTime(time?: string): boolean {
  return time !== undefined && minutesFromTime(time) < 12 * 60;
}

function isNightTime(time?: string): boolean {
  return time !== undefined && minutesFromTime(time) >= 20 * 60;
}

function updateTaskPreference(
  profile: UserPlanningProfile,
  signal: WeeklyPlanningFeedbackSignal,
  update: (taskPreference: UserTaskPreferenceProfile, rate: number) => UserTaskPreferenceProfile,
): UserPlanningProfile {
  const taskKey = resolveUserTaskPreferenceKey({
    taskTitle: signal.taskTitle,
    taskProfile: signal.taskProfile,
  });

  if (!taskKey) {
    return profile;
  }

  const currentPreference =
    profile.taskPreferences[taskKey] ?? createDefaultUserTaskPreferenceProfile(taskKey);
  const rate = resolveTaskPreferenceLearningRate(currentPreference);
  const nextPreference = update(currentPreference, rate);
  const sampleCount = currentPreference.sampleCount + 1;
  const confidence = clampPreference01(currentPreference.confidence + 0.06);

  return {
    ...profile,
    taskPreferences: {
      ...profile.taskPreferences,
      [taskKey]: {
        ...nextPreference,
        sampleCount,
        confidence,
      },
    },
  };
}

function updateUserPlanningProfileFromSingleFeedback(
  profile: UserPlanningProfile,
  signal: WeeklyPlanningFeedbackSignal,
): UserPlanningProfile {
  const rate = resolveFeedbackLearningRate(profile);
  let nextProfile: UserPlanningProfile = {
    ...profile,
    feedbackCount: profile.feedbackCount + 1,
    confidence: clampPreference01(profile.confidence + 0.04),
    taskPreferences: { ...profile.taskPreferences },
  };

  if (signal.kind === 'block_deleted' && signal.durationMinutes < 40) {
    nextProfile = {
      ...nextProfile,
      dislikesTinyBlocks: clampPreference01(
        blendPreference(nextProfile.dislikesTinyBlocks, 1, rate),
      ),
      minSessionMinutes: Math.round(
        blendPreference(nextProfile.minSessionMinutes, 50, rate),
      ),
    };
  }

  if (signal.kind === 'session_resized') {
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes: Math.round(
        blendPreference(nextProfile.preferredSessionMinutes, signal.toMinutes, rate),
      ),
      prefersLongSessions: clampPreference01(
        blendPreference(
          nextProfile.prefersLongSessions,
          signal.toMinutes < signal.fromMinutes ? 0.25 : 0.75,
          rate,
        ),
      ),
    };
  }

  if (signal.kind === 'session_moved') {
    if (isMorningTime(signal.fromStartTime) && !isMorningTime(signal.toStartTime)) {
      nextProfile = {
        ...nextProfile,
        morningReliability: clampPreference01(
          blendPreference(nextProfile.morningReliability, 0, rate),
        ),
      };
    }
  }

  if (signal.kind === 'session_completed') {
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes: Math.round(
        blendPreference(nextProfile.preferredSessionMinutes, signal.durationMinutes, rate),
      ),
      prefersLongSessions: clampPreference01(
        blendPreference(
          nextProfile.prefersLongSessions,
          signal.durationMinutes >= 90 ? 0.7 : 0.45,
          rate,
        ),
      ),
    };
  }

  if (signal.kind === 'session_uncompleted') {
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes: Math.round(
        blendPreference(
          nextProfile.preferredSessionMinutes,
          Math.min(signal.durationMinutes, 75),
          rate,
        ),
      ),
      prefersLongSessions: clampPreference01(
        blendPreference(nextProfile.prefersLongSessions, 0.25, rate),
      ),
    };

    if (isNightTime(signal.startTime) && (signal.taskProfile?.cognitiveLoad ?? 3) >= 4) {
      nextProfile = {
        ...nextProfile,
        nightHeavyTaskReliability: clampPreference01(
          blendPreference(nextProfile.nightHeavyTaskReliability, 0, rate),
        ),
      };
    }
  }

  if (signal.kind === 'explicit_preference') {
    const explicitRate = Math.max(0.35, rate);
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes:
        signal.preferredSessionMinutes !== undefined
          ? Math.round(
              blendPreference(
                nextProfile.preferredSessionMinutes,
                signal.preferredSessionMinutes,
                explicitRate,
              ),
            )
          : nextProfile.preferredSessionMinutes,
      minSessionMinutes:
        signal.minSessionMinutes !== undefined
          ? Math.round(
              blendPreference(
                nextProfile.minSessionMinutes,
                signal.minSessionMinutes,
                explicitRate,
              ),
            )
          : nextProfile.minSessionMinutes,
      maxSessionMinutes:
        signal.maxSessionMinutes !== undefined
          ? Math.round(
              blendPreference(
                nextProfile.maxSessionMinutes,
                signal.maxSessionMinutes,
                explicitRate,
              ),
            )
          : nextProfile.maxSessionMinutes,
      dislikesTinyBlocks:
        signal.dislikesTinyBlocks !== undefined
          ? clampPreference01(
              blendPreference(
                nextProfile.dislikesTinyBlocks,
                signal.dislikesTinyBlocks,
                explicitRate,
              ),
            )
          : nextProfile.dislikesTinyBlocks,
      prefersLongSessions:
        signal.prefersLongSessions !== undefined
          ? clampPreference01(
              blendPreference(
                nextProfile.prefersLongSessions,
                signal.prefersLongSessions,
                explicitRate,
              ),
            )
          : nextProfile.prefersLongSessions,
    };
  }

  nextProfile = updateTaskPreference(nextProfile, signal, (taskPreference, taskRate) => {
    if (signal.kind === 'session_completed') {
      return {
        ...taskPreference,
        preferredSessionMinutes: Math.round(
          blendPreference(
            taskPreference.preferredSessionMinutes,
            signal.durationMinutes,
            taskRate,
          ),
        ),
        completionRate: clampPreference01(
          blendPreference(taskPreference.completionRate, 1, taskRate),
        ),
        prefersLongSessions: clampPreference01(
          blendPreference(
            taskPreference.prefersLongSessions,
            signal.durationMinutes >= 90 ? 0.8 : 0.45,
            taskRate,
          ),
        ),
      };
    }

    if (signal.kind === 'session_uncompleted') {
      return {
        ...taskPreference,
        completionRate: clampPreference01(
          blendPreference(taskPreference.completionRate, 0, taskRate),
        ),
        prefersLongSessions: clampPreference01(
          blendPreference(taskPreference.prefersLongSessions, 0.25, taskRate),
        ),
      };
    }

    if (signal.kind === 'session_resized') {
      return {
        ...taskPreference,
        preferredSessionMinutes: Math.round(
          blendPreference(taskPreference.preferredSessionMinutes, signal.toMinutes, taskRate),
        ),
      };
    }

    if (signal.kind === 'block_deleted' && signal.durationMinutes < 40) {
      return {
        ...taskPreference,
        dislikesTinyBlocks: clampPreference01(
          blendPreference(taskPreference.dislikesTinyBlocks, 1, taskRate),
        ),
      };
    }

    if (signal.kind === 'session_moved') {
      return {
        ...taskPreference,
        morningReliability:
          isMorningTime(signal.fromStartTime) && !isMorningTime(signal.toStartTime)
            ? clampPreference01(
                blendPreference(taskPreference.morningReliability, 0, taskRate),
              )
            : taskPreference.morningReliability,
      };
    }

    if (signal.kind === 'explicit_preference') {
      return {
        ...taskPreference,
        preferredSessionMinutes:
          signal.preferredSessionMinutes !== undefined
            ? Math.round(
                blendPreference(
                  taskPreference.preferredSessionMinutes,
                  signal.preferredSessionMinutes,
                  Math.max(0.35, taskRate),
                ),
              )
            : taskPreference.preferredSessionMinutes,
        minSessionMinutes:
          signal.minSessionMinutes !== undefined
            ? Math.round(
                blendPreference(
                  taskPreference.minSessionMinutes,
                  signal.minSessionMinutes,
                  Math.max(0.35, taskRate),
                ),
              )
            : taskPreference.minSessionMinutes,
        maxSessionMinutes:
          signal.maxSessionMinutes !== undefined
            ? Math.round(
                blendPreference(
                  taskPreference.maxSessionMinutes,
                  signal.maxSessionMinutes,
                  Math.max(0.35, taskRate),
                ),
              )
            : taskPreference.maxSessionMinutes,
      };
    }

    return taskPreference;
  });

  return nextProfile;
}

export function updateUserPlanningProfileFromFeedback(
  profile: UserPlanningProfile,
  feedback: WeeklyPlanningFeedbackSignal | WeeklyPlanningFeedbackSignal[],
): UserPlanningProfile {
  const signals = Array.isArray(feedback) ? feedback : [feedback];

  return signals.reduce(updateUserPlanningProfileFromSingleFeedback, profile);
}

export function mergeUserPolicyWithExplicitOverride(
  policy: SessionLengthPolicy,
  explicitOverride?: SessionLengthPolicyOverride,
): SessionLengthPolicy {
  if (!explicitOverride?.userExplicit) {
    return policy;
  }

  return mergeSessionLengthPolicyOverride(policy, explicitOverride);
}

export function derivePersonalizedSessionPolicy(
  input: PersonalizedSessionPolicyInput,
): PersonalizedSessionPolicy {
  const basePolicy = input.basePolicy ?? deriveSessionLengthPolicy(input.taskProfile);
  const explicitPolicy = mergeUserPolicyWithExplicitOverride(
    basePolicy,
    input.explicitOverride,
  );

  if (input.explicitOverride?.userExplicit) {
    return {
      ...explicitPolicy,
      basePolicy,
      confidence: 1,
      personalizationApplied: true,
      reasons: ['explicit-override'],
    };
  }

  const userProfile = input.userProfile;

  if (!userProfile || userProfile.feedbackCount === 0) {
    return {
      ...basePolicy,
      basePolicy,
      confidence: 0,
      personalizationApplied: false,
      reasons: ['base-policy'],
    };
  }

  const taskKey = resolveUserTaskPreferenceKey({
    taskTitle: input.taskTitle,
    taskProfile: input.taskProfile,
  });
  const taskPreference = taskKey ? userProfile.taskPreferences[taskKey] : undefined;
  const taskConfidence = taskPreference?.confidence ?? 0;
  const confidence = Math.max(userProfile.confidence, taskConfidence);
  const strength = Math.min(0.65, confidence * 0.55);
  const targetPreference = taskPreference?.preferredSessionMinutes ?? userProfile.preferredSessionMinutes;
  const minPreference = taskPreference?.minSessionMinutes ?? userProfile.minSessionMinutes;
  const maxPreference = taskPreference?.maxSessionMinutes ?? userProfile.maxSessionMinutes;
  const dislikesTinyBlocks = Math.max(
    userProfile.dislikesTinyBlocks,
    taskPreference?.dislikesTinyBlocks ?? 0,
  );
  const prefersLongSessions = Math.max(
    userProfile.prefersLongSessions,
    taskPreference?.prefersLongSessions ?? 0,
  );
  const nextTarget = Math.round(
    blendPreference(basePolicy.targetSessionMinutes, targetPreference, strength),
  );
  const nextMin = Math.round(
    blendPreference(
      basePolicy.minSessionMinutes,
      dislikesTinyBlocks > 0.6 ? Math.max(minPreference, 45) : minPreference,
      strength,
    ),
  );
  const nextMax = Math.round(
    blendPreference(
      basePolicy.maxSessionMinutes,
      prefersLongSessions > 0.65 ? Math.max(maxPreference, basePolicy.maxSessionMinutes) : maxPreference,
      strength * 0.6,
    ),
  );
  const personalizedPolicy = normalizeSessionLengthPolicy(
    {
      ...basePolicy,
      minSessionMinutes: nextMin,
      targetSessionMinutes: nextTarget,
      maxSessionMinutes: nextMax,
      allowSmallRemainder:
        dislikesTinyBlocks > 0.65 ? false : basePolicy.allowSmallRemainder,
    },
    Math.max(basePolicy.maxSessionMinutes, nextMax),
  );

  return {
    ...personalizedPolicy,
    basePolicy,
    confidence,
    personalizationApplied: strength > 0,
    taskPreference,
    reasons: [
      'learned-user-profile',
      taskPreference ? 'task-preference' : 'global-preference',
      dislikesTinyBlocks > 0.65 ? 'tiny-blocks-disliked' : '',
    ].filter(Boolean),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function minutesBetween(startTime: string, endTime: string): number {
  return Math.max(0, minutesFromTime(endTime) - minutesFromTime(startTime));
}

function resolveDraftLabel(draft: PlanDraft): string {
  return (
    draft.materialName?.trim() ||
    draft.subject.trim() ||
    draft.title.trim() ||
    '学習予定'
  );
}

function resolveBlockLabel(block: WeeklyPlanDraftBlock): string {
  return (
    block.label.trim() ||
    block.materialName?.trim() ||
    block.subject.trim() ||
    block.title.trim() ||
    '学習予定'
  );
}

function stripWeeklyPlanningTaskTitle(text: string): string {
  return normalizeWeeklyPlanningText(text)
    .replace(/来週|今週|週間|週/g, '')
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/\d{1,2}[/月]\d{1,2}(?:日)?\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/p\.\s*\d+\s*[-〜~]\s*\d+/gi, '')
    .replace(/(?:毎日|1日|一日)?\s*\d+(?:\.\d+)?\s*(?:時間|分|語|単語|個|ページ|問|問題|題|年分)/g, '')
    .replace(/第\s*\d+\s*章/g, '')
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:起床|起きる|起き|就寝|寝たい|寝る|寝)/g, '')
    .replace(/(?:前後|バッファ|余裕)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:前後|バッファ|余裕)/g, '')
    .replace(/(?:最大|1回|一回|セッション)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:まで|以内|最大)/g, '')
    .replace(/(?:休憩|休み)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:休憩|休み)/g, '')
    .replace(/深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)/g, '')
    .replace(/夜中(?:も)?(?:OK|ok|可)/g, '')
    .replace(/0時以降(?:も)?(?:OK|ok|可)/g, '')
    .replace(/(?:午前|午後|夜|夜中心|午後中心|午前中心|日中中心|夜型|朝型)中心/g, '')
    .replace(/(?:(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d|\u9577\u3081|\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u5148\u306b|\u7247\u3065\u3051(?:\u305f\u3044)?|\u7247\u4ed8\u3051(?:\u305f\u3044)?)/g, '')
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:から|まで|迄)$/g, '')
    .replace(/(?:まで|迄|締切|期限)に?/g, '')
    .replace(/(?:重要な|優先|急ぎ|高優先度|最優先)な?/g, '')
    .replace(/(?:おまかせ|任せ|普通|デフォルト|そのまま|適当|わからない|分からない|OK|ok|はい|進め)/g, '')
    .replace(/\s*(?:追加|変更|修正)\s*$/g, '')
    .replace(/\s*(?:やりたい|したい|勉強したい|学習したい|進めたい|取り組みたい)\s*$/g, '')
    .replace(/\s*(?:にして|として|で|を|は|に|が|へ|より|の)+\s*$/g, '')
    .replace(/^\s*(?:を|は|に|で|が|へ|より|の)+\s*/g, '')
    .replace(/\s*(?:\u306b\u3057\u3066|\u3068\u3057\u3066|\u3067|\u3092|\u306f|\u306b|\u3082|\u304c|\u3078|\u3088\u308a|\u306e)+\s*$/g, '')
    .replace(/^\s*(?:\u3092|\u306f|\u306b|\u3082|\u3067|\u304c|\u3078|\u3088\u308a|\u306e)+\s*/g, '')
    .replace(/[「」"'、。,.]/g, ' ')
    .replace(/(?:(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d|\u9577\u3081|\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u5148\u306b|\u7247\u3065\u3051(?:\u305f\u3044)?|\u7247\u4ed8\u3051(?:\u305f\u3044)?)/g, '')
    .replace(/\s*(?:\u306b\u3057\u3066|\u3068\u3057\u3066|\u3067|\u3092|\u306f|\u306b|\u3082|\u304c|\u3078|\u3088\u308a|\u306e)+\s*$/g, '')
    .replace(/^\s*(?:\u3092|\u306f|\u306b|\u3082|\u3067|\u304c|\u3078|\u3088\u308a|\u306e)+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSimpleTaskTitle(text: string): string {
  const weeklyTitle = stripWeeklyPlanningTaskTitle(text);

  if (weeklyTitle) {
    return weeklyTitle;
  }

  const sanitizedTitle = sanitizeSuggestedTitle(text)
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/\d{1,2}[/月]\d{1,2}(?:日)?\s*(?:まで|迄|締切|期限)?/g, '')
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:起床|起きる|起き|就寝|寝たい|寝る|寝)/g, '')
    .replace(/(?:前後|バッファ|余裕)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:前後|バッファ|余裕)/g, '')
    .replace(/(?:最大|1回|一回|セッション)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:まで|以内|最大)/g, '')
    .replace(/(?:休憩|休み)\s*\d+\s*分/g, '')
    .replace(/\d+\s*分\s*(?:休憩|休み)/g, '')
    .replace(/深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)/g, '')
    .replace(/夜中(?:も)?(?:OK|ok|可)/g, '')
    .replace(/0時以降(?:も)?(?:OK|ok|可)/g, '')
    .replace(/(?:まで|迄|締切|期限)に?/g, '')
    .replace(/(?:重要|優先|急ぎ|高優先度|最優先)な?/g, '')
    .replace(/(?:おまかせ|任せ|普通|デフォルト|そのまま|適当|OK|ok|はい|進め|作成|生成)/g, '')
    .replace(/\s*(?:やりたい|したい|勉強したい|学習したい|進めたい|取り組みたい)\s*$/g, '')
    .replace(/[をはにでがへよりの]+$/g, '')
    .replace(/^[をはにでがへよりの]+/g, '')
    .trim();

  return sanitizedTitle || '学習';
}

function splitWeeklyPlanningTaskTexts(text: string): string[] {
  return normalizeWeeklyPlanningText(text)
    .replace(/[。,]/g, '、')
    .split('、')
    .map((taskText) => taskText.trim())
    .filter(Boolean);
}

function padDatePart(value: string): string {
  return value.padStart(2, '0');
}

function formatClockParts(hourText: string, minuteText = '0'): string {
  const hour = Math.min(Math.max(Number(hourText), 0), 24);
  const minute = Math.min(Math.max(Number(minuteText), 0), 59);

  if (hour === 24) {
    return '24:00';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractWakeTime(text: string): string | undefined {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const match = normalizedText.match(
    /(\d{1,2})(?::(\d{1,2}))?\s*(?:時|:)?\s*(?:起床|起き|起きる)/,
  );

  if (!match) {
    return undefined;
  }

  return formatClockParts(match[1], match[2] ?? '0');
}

function extractSleepStartTime(text: string): string | undefined {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const match = normalizedText.match(
    /(\d{1,2})(?::(\d{1,2}))?\s*(?:時|:)?\s*(?:就寝|寝る|寝たい|寝)/,
  );

  if (!match) {
    return undefined;
  }

  const hour = Number(match[1]);

  if (hour > 0 && hour <= 4) {
    return '24:00';
  }

  return formatClockParts(match[1], match[2] ?? '0');
}

function extractMinutesSetting(
  text: string,
  patterns: RegExp[],
): number | undefined {
  const normalizedText = normalizeWeeklyPlanningText(text);

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);

    if (match) {
      return Math.max(0, Number(match[1]));
    }
  }

  return undefined;
}

function resolveDeepNightAllowed(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text);

  return /深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)|夜中(?:も)?(?:OK|ok|可)|0時以降(?:も)?(?:OK|ok|可)/.test(
    normalizedText,
  );
}

function resolvePreferredStudyRanges(
  text: string,
): WeeklyPlanningDefaultConditions['preferredStudyRanges'] {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const rangeMatch = normalizedText.match(
    /(\d{1,2})(?::(\d{1,2}))?\s*(?:時)?\s*(?:-|〜|~|から)\s*(\d{1,2})(?::(\d{1,2}))?\s*(?:時)?\s*(?:中心|集中|メイン)/,
  );

  if (rangeMatch) {
    return [
      {
        startTime: formatClockParts(rangeMatch[1], rangeMatch[2] ?? '0'),
        endTime: formatClockParts(rangeMatch[3], rangeMatch[4] ?? '0'),
        reason: '指定された集中時間帯',
      },
    ];
  }

  if (/夜中心|夜型/.test(normalizedText)) {
    return [{ startTime: '20:00', endTime: '23:00', reason: '指定された夜中心' }];
  }

  if (/午後中心/.test(normalizedText)) {
    return [{ startTime: '13:00', endTime: '18:00', reason: '指定された午後中心' }];
  }

  if (/午前中心|朝型/.test(normalizedText)) {
    return [{ startTime: '08:00', endTime: '12:00', reason: '指定された午前中心' }];
  }

  return DEFAULT_PREFERRED_STUDY_RANGES;
}

function resolveTaskPriority(text: string): 'normal' | 'high' {
  return /重要|優先|急ぎ|高優先度|最優先|締切|期限/.test(text)
    ? 'high'
    : 'normal';
}

function isPlacementConditionOnly(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text)
    .replace(/[、。,.]/g, '')
    .replace(/(?:で)?(?:おまかせ|任せ|普通|デフォルト|そのまま|適当|わからない|分からない|OK|ok|はい|進め).*$/g, '')
    .replace(/(?:で|にして|でいい)$/g, '')
    .trim();

  return (
    /^(?:(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d|\u9577\u3081|\u4e00\u6c17|\u307e\u3068\u3081\u3066)(?:\u3067|\u306b|\u3067\u3084\u308a\u305f\u3044|\u306b\u3057\u305f\u3044)?$/.test(
      normalizedText,
    ) ||
    /^\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:起床|起きる|起き|就寝|寝たい|寝る|寝)$/.test(
      normalizedText,
    ) ||
    /^(?:最大|1回|一回|セッション)\s*\d+\s*分$/.test(normalizedText) ||
    /^\d+\s*分\s*(?:まで|以内|最大)$/.test(normalizedText) ||
    /^(?:休憩|休み)\s*\d+\s*分$/.test(normalizedText) ||
    /^\d+\s*分\s*(?:休憩|休み)$/.test(normalizedText) ||
    /^(?:前後|バッファ|余裕)\s*\d+\s*分$/.test(normalizedText) ||
    /^\d+\s*分\s*(?:前後|バッファ|余裕)$/.test(normalizedText) ||
    /^深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)$/.test(normalizedText) ||
    /^夜中(?:も)?(?:OK|ok|可)$/.test(normalizedText) ||
    /^0時以降(?:も)?(?:OK|ok|可)$/.test(normalizedText) ||
    /^(?:午前|午後|夜|夜中心|午後中心|午前中心|日中中心|夜型|朝型)中心$/.test(
      normalizedText,
    ) ||
    /^\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:から|まで|迄)$/.test(normalizedText)
  );
}

function parseWeeklyPlanningTaskAmount(
  text: string,
): WeeklyPlanningTaskAmount | null {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const daily = /毎日|1日|一日/.test(normalizedText);
  const durationMinutes = parseDurationMinutes(normalizedText);

  if (durationMinutes && !isPlacementConditionOnly(normalizedText)) {
    return {
      unit: 'minutes',
      value: durationMinutes,
      text: `${durationMinutes}分`,
      daily,
    };
  }

  const pageRangeMatch = normalizedText.match(/p\.\s*(\d+)\s*[-〜~]\s*(\d+)/i);

  if (pageRangeMatch) {
    const startPage = Number(pageRangeMatch[1]);
    const endPage = Number(pageRangeMatch[2]);

    return {
      unit: 'pages',
      value: Math.max(0, endPage - startPage + 1),
      text: pageRangeMatch[0],
      daily,
    };
  }

  const amountPatterns: Array<{
    unit: WeeklyPlanningTaskAmount['unit'];
    pattern: RegExp;
  }> = [
    { unit: 'words', pattern: /(\d+)\s*(?:語|単語)/ },
    { unit: 'items', pattern: /(\d+)\s*個/ },
    { unit: 'pages', pattern: /(\d+)\s*ページ/ },
    { unit: 'problems', pattern: /(\d+)\s*(?:問|問題)/ },
    { unit: 'passages', pattern: /(\d+)\s*題/ },
    { unit: 'years', pattern: /(\d+)\s*年分/ },
  ];

  for (const amountPattern of amountPatterns) {
    const match = normalizedText.match(amountPattern.pattern);

    if (match) {
      return {
        unit: amountPattern.unit,
        value: Number(match[1]),
        text: match[0],
        daily,
      };
    }
  }

  if (/第\s*\d+\s*章|章|単元|教材|ターゲット1900|青チャート/.test(normalizedText)) {
    return {
      unit: /第\s*\d+\s*章|章/.test(normalizedText) ? 'chapter' : 'material',
      text: normalizedText,
      daily,
    };
  }

  return null;
}

function extractTaskDeadlineDate(text: string, selectedDate: string): string | undefined {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const isoMatch = normalizedText.match(
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(?:まで|迄|締切|期限)?/,
  );

  if (isoMatch) {
    return `${isoMatch[1]}-${padDatePart(isoMatch[2])}-${padDatePart(isoMatch[3])}`;
  }

  const monthDayMatch = normalizedText.match(
    /(\d{1,2})[/月](\d{1,2})(?:日)?\s*(?:まで|迄|締切|期限)?/,
  );

  if (!monthDayMatch) {
    return undefined;
  }

  const selectedYear = selectedDate.slice(0, 4);
  return `${selectedYear}-${padDatePart(monthDayMatch[1])}-${padDatePart(
    monthDayMatch[2],
  )}`;
}

function resolveDistributionKey(block: WeeklyPlanDraftBlock): string {
  return (
    block.subject.trim() ||
    block.label.trim() ||
    block.title.trim() ||
    '学習'
  );
}

function buildSimpleDraftEndTime(blockMinutes: number): string {
  return timeFromMinutes(minutesFromTime(SIMPLE_DRAFT_START_TIME) + blockMinutes);
}

function getDraftBlockDurationMinutes(block: WeeklyPlanDraftBlock): number {
  return minutesFromTime(block.endTime) - minutesFromTime(block.startTime);
}

function splitDurationIntoDraftBlockMinutes(durationMinutes: number): number[] {
  const blockMinutes: number[] = [];
  let remainingMinutes = durationMinutes;

  while (remainingMinutes > 0) {
    const nextMinutes = Math.min(
      remainingMinutes,
      SIMPLE_DRAFT_MAX_BLOCK_MINUTES,
    );
    blockMinutes.push(nextMinutes);
    remainingMinutes -= nextMinutes;
  }

  return blockMinutes;
}

function resolveWeeklyPlanningBaseDate(text: string, selectedDate: string): string {
  return /来週/.test(text) ? addDays(selectedDate, 7) : selectedDate;
}

function getDefaultWeeklyPlanningConditions(params: {
  selectedDate: string;
  text: string;
}): WeeklyPlanningDefaultConditions {
  const startDate = resolveWeeklyPlanningBaseDate(params.text, params.selectedDate);
  const dayCount = DEFAULT_WEEKLY_PLANNING_DAY_COUNT;
  const wakeTime = extractWakeTime(params.text) ?? DEFAULT_WAKE_TIME;
  const sleepStartTime =
    extractSleepStartTime(params.text) ?? DEFAULT_SLEEP_START_TIME;
  const bufferMinutes =
    extractMinutesSetting(params.text, [
      /(?:前後|バッファ|余裕)\s*(\d+)\s*分/,
      /(\d+)\s*分\s*(?:前後|バッファ|余裕)/,
    ]) ?? DEFAULT_BUFFER_MINUTES;
  const maxSessionMinutes =
    extractMinutesSetting(params.text, [
      /(?:最大|1回|一回|セッション)\s*(\d+)\s*分/,
      /(\d+)\s*分\s*(?:まで|以内|最大)/,
    ]) ?? DEFAULT_MAX_SESSION_MINUTES;
  const breakMinutes =
    extractMinutesSetting(params.text, [
      /(?:休憩|休み)\s*(\d+)\s*分/,
      /(\d+)\s*分\s*(?:休憩|休み)/,
    ]) ?? DEFAULT_BREAK_MINUTES;

  return {
    startDate,
    dayCount,
    reserveDate: addDays(startDate, dayCount),
    wakeTime,
    sleepStartTime,
    bufferMinutes,
    minStudyBlockMinutes: DEFAULT_MIN_STUDY_BLOCK_MINUTES,
    maxSessionMinutes: Math.max(30, maxSessionMinutes),
    breakMinutes,
    deepNightAllowed: resolveDeepNightAllowed(params.text),
    unavailableRanges: DEFAULT_UNAVAILABLE_RANGES,
    availableStudyRanges: [
      { startTime: wakeTime, endTime: sleepStartTime, reason: '起床から就寝まで' },
    ],
    preferredStudyRanges: resolvePreferredStudyRanges(params.text),
  };
}

function isDefaultConditionProposalResponse(text: string): boolean {
  return /おまかせ|任せ|普通|デフォルト|そのまま|適当|わからない|分からない/.test(
    normalizeWeeklyPlanningText(text),
  );
}

export function isExplicitCreateConfirmation(text: string): boolean {
  return /この条件で作成|この条件で生成|それで作って|それで作成|それで生成|OK|ok|はい|お願いします|進めて|作成して|生成して/.test(
    normalizeWeeklyPlanningText(text),
  );
}

export function isExplicitPartialPlacementConfirmation(text: string): boolean {
  return /配置できる分だけ|入る分だけ|入るところまで|置ける分だけ|置けるところまで|部分的でいい|部分でいい/.test(
    normalizeWeeklyPlanningText(text),
  );
}


function cloneWeeklyPlanningDefaults(
  defaults: WeeklyPlanningDefaultConditions,
): WeeklyPlanningDefaultConditions {
  return {
    ...defaults,
    unavailableRanges: defaults.unavailableRanges.map((range) => ({ ...range })),
    availableStudyRanges: defaults.availableStudyRanges.map((range) => ({ ...range })),
    preferredStudyRanges: defaults.preferredStudyRanges.map((range) => ({ ...range })),
  };
}

function withUpdatedDayCount(
  defaults: WeeklyPlanningDefaultConditions,
  dayCount: number,
): WeeklyPlanningDefaultConditions {
  const nextDayCount = Math.max(1, Math.floor(dayCount));

  return {
    ...cloneWeeklyPlanningDefaults(defaults),
    dayCount: nextDayCount,
    reserveDate: addDays(defaults.startDate, nextDayCount),
  };
}

function formatStudyRanges(
  ranges: WeeklyPlanningDefaultConditions['preferredStudyRanges'],
): string {
  return ranges.map((range) => `${range.startTime}-${range.endTime}`).join('、');
}

function parseJapaneseSmallInteger(text: string): number | null {
  const normalizedText = normalizeWeeklyPlanningText(text).trim();

  if (/^\d+$/.test(normalizedText)) {
    return Number(normalizedText);
  }

  const digitValues: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalizedText === '十') {
    return 10;
  }

  const tenIndex = normalizedText.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = normalizedText.slice(0, tenIndex);
    const onesText = normalizedText.slice(tenIndex + 1);
    const tens = tensText ? digitValues[tensText] : 1;
    const ones = onesText ? digitValues[onesText] : 0;

    return tens && ones !== undefined ? tens * 10 + ones : null;
  }

  return digitValues[normalizedText] ?? null;
}

function normalizeConditionText(text: string): string {
  return normalizeWeeklyPlanningText(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function splitConditionClauses(text: string): string[] {
  return normalizeWeeklyPlanningText(text)
    .replace(/\r?\n+/g, '、')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:それと|あと|さらに)/g, '、')
    .replace(
      /で(?=(?:お昼|昼|昼休み|夕食|夜ごはん|夜ご飯|晩ごはん|晩ご飯|食事|休憩|睡眠|寝|起床|勉強|開始|終了|夜は|朝は|午前|午後|最大|1回|一回|[\d一二三四五六七八九十]+\s*日(?:間)?))/g,
      '、',
    )
    .split(/[、。,\.]+/)
    .map((clause) =>
      clause
        .replace(/(?:でいい|にして|想定でやってほしい)$/g, '')
        .trim(),
    )
    .filter(Boolean);
}

function parseClockRange(text: string): { startTime: string; endTime: string } | null {
  const normalizedText = normalizeConditionText(text);
  const match = normalizedText.match(
    /(\d{1,2})(?::(\d{1,2}))?\s*(?:時)?(半)?\s*(?:から|~|-)\s*(\d{1,2})(?::(\d{1,2}))?\s*(?:時)?(半)?/,
  );

  if (!match) {
    return null;
  }

  return {
    startTime: formatClockParts(match[1], match[3] ? '30' : (match[2] ?? '0')),
    endTime: formatClockParts(match[4], match[6] ? '30' : (match[5] ?? '0')),
  };
}

function extractClockMentions(text: string): string[] {
  const normalizedText = normalizeConditionText(text);
  const mentions: string[] = [];

  Array.from(normalizedText.matchAll(/(\d{1,2})(?::(\d{1,2})|時(半)?)/g)).forEach(
    (match) => {
      mentions.push(formatClockParts(match[1], match[3] ? '30' : (match[2] ?? '0')));
    },
  );
  Array.from(normalizedText.matchAll(/(\d{1,2})\s*(?=から|まで)/g)).forEach(
    (match) => {
      const time = formatClockParts(match[1], '0');

      if (!mentions.includes(time)) {
        mentions.push(time);
      }
    },
  );

  return mentions;
}

function extractDurationMentions(text: string): number[] {
  return Array.from(normalizeConditionText(text).matchAll(/(\d+)\s*分/g)).map(
    (match) => Number(match[1]),
  );
}

function getLastMinutesMention(text: string): number | null {
  const mentions = extractDurationMentions(text);
  const lastMention = mentions[mentions.length - 1];

  return lastMention ?? null;
}

function getAvailableStudyRangesForSleep(params: {
  wakeTime: string;
  sleepStartTime: string;
}): WeeklyPlanningDefaultConditions['availableStudyRanges'] {
  const wakeMinutes = minutesFromTime(params.wakeTime);
  const sleepStartMinutes = minutesFromTime(params.sleepStartTime);
  const endTime =
    sleepStartMinutes > wakeMinutes ? params.sleepStartTime : DEFAULT_SLEEP_START_TIME;

  return [
    {
      startTime: params.wakeTime,
      endTime,
      reason: '睡眠時間を除いた時間',
    },
  ];
}

export function createWeeklyPlanningPendingConfig(params: {
  sourceText: string;
  assessment: WeeklyPlanningRequestAssessment;
  allowPartialPlacement?: boolean;
}): WeeklyPlanningPendingConfig {
  return {
    sourceText: params.sourceText,
    tasks: params.assessment.tasks,
    defaults: cloneWeeklyPlanningDefaults(params.assessment.defaults),
    allowPartialPlacement: params.allowPartialPlacement ?? false,
    sessionIntentOverrides: inferSessionIntentOverridesFromText({
      text: params.sourceText,
      tasks: params.assessment.tasks,
    }),
    qualityPreferences: [],
  };
}

export function summarizeWeeklyPlanningPendingConfig(
  config: WeeklyPlanningPendingConfig,
): string {
  return buildWeeklyPlanningConfirmationSummary({
    tasks: config.tasks,
    defaults: config.defaults,
    includeEstimateProposal: config.tasks.some((task) => task.requiresTimeEstimate),
  });
}


function createSessionIntentOverrideFromText(
  text: string,
  scope: SessionIntentScope = 'global',
): SessionIntentOverride | null {
  const normalizedText = normalizeConditionText(text);

  if (/(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(normalizedText)) {
    return {
      scope,
      kind: 'fixed_two_hour',
      targetSessionMinutes: 120,
    };
  }

  if (/\u9577\u3081|\u5168\u4f53\u7684\u306b\u9577/.test(normalizedText)) {
    return {
      scope,
      kind: 'prefer_long',
      targetSessionMinutes: 120,
    };
  }

  if (/\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u7247\u3065\u3051|\u7247\u4ed8\u3051/.test(normalizedText)) {
    return { scope, kind: 'consolidate', targetSessionMinutes: 120 };
  }

  if (/\u5148\u306b|\u4eca\u65e5\u4e2d|\u512a\u5148/.test(normalizedText)) {
    return { scope, kind: 'one_shot_first', targetSessionMinutes: 120 };
  }

  return null;
}

function normalizeSessionIntentOverride(
  override: SessionIntentOverride,
): SessionIntentOverride {
  return {
    ...override,
    targetSessionMinutes: override.targetSessionMinutes
      ? Math.max(30, Math.round(override.targetSessionMinutes))
      : undefined,
  };
}

function mergeSessionIntentOverrides(
  baseOverrides: SessionIntentOverride[] = [],
  nextOverride: SessionIntentOverride,
): SessionIntentOverride[] {
  const normalizedNext = normalizeSessionIntentOverride(nextOverride);
  const keyFor = (override: SessionIntentOverride) =>
    `${override.scope}|${override.kind}|${override.appliesToTaskTitle ?? ''}`;
  const nextKey = keyFor(normalizedNext);

  return [
    ...baseOverrides.filter((override) => keyFor(override) !== nextKey),
    normalizedNext,
  ];
}

function inferSessionIntentOverridesFromText(params: {
  text: string;
  tasks: SimpleWeeklyTask[];
}): SessionIntentOverride[] {
  const normalizedText = normalizeWeeklyPlanningText(params.text);
  const overrides: SessionIntentOverride[] = [];

  if (
    /(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(normalizedText) ||
    /\u5168\u4f53|\u5168\u4f53\u7684|\u5168\u90e8|\u307f\u3093\u306a/.test(normalizedText)
  ) {
    const globalOverride = createSessionIntentOverrideFromText(normalizedText, 'global');

    if (globalOverride) {
      overrides.push(globalOverride);
    }
  }

  params.tasks.forEach((task) => {
    const taskOverride = createSessionIntentOverrideFromText(task.sourceText, 'task');

    if (taskOverride && hasTaskConsolidationIntent(task.sourceText)) {
      overrides.push({
        ...taskOverride,
        appliesToTaskTitle: task.title,
      });
    }
  });

  return overrides.reduce<SessionIntentOverride[]>(
    (merged, override) => mergeSessionIntentOverrides(merged, override),
    [],
  );
}

function resolveUnavailableReason(text: string): string {
  if (/昼|お昼|昼食|昼ごはん|昼ご飯|ランチ/.test(text)) {
    return '昼食';
  }

  if (/夕食|夜ごはん|夜ご飯|晩ごはん|晩ご飯|晩御飯|食事|ごはん|ご飯/.test(text)) {
    return '夕食';
  }

  if (/休憩|休み|インターバル/.test(text)) {
    return '休憩';
  }

  return '使用不可';
}

function hasQualityAvoidanceCue(text: string): boolean {
  return /ならない|なりにくい|避けたい|避ける|避けて|しない|しにくい|なし|出ない|作らない|固めない|固まらない|細切れにならない/.test(
    text,
  );
}

function classifyQualityPreferenceOperations(text: string): WeeklyConditionOperation[] {
  const operations: WeeklyConditionOperation[] = [];
  const normalizedText = normalizeConditionText(text);
  const addPreference = (preference: WeeklyPlanningQualityPreference) => {
    if (
      !operations.some(
        (operation) =>
          operation.kind === 'addQualityPreference' && operation.preference === preference,
      )
    ) {
      operations.push({ kind: 'addQualityPreference', preference });
    }
  };

  if (/分散/.test(normalizedText)) {
    addPreference('preferTaskSpread');
  }

  if (
    /(?:1|一)\s*日\s*(?:1|一)\s*科目|(?:1|一)\s*日(?:だけ)?に?固め|(?:1|一)\s*日(?:だけ)?/.test(
      normalizedText,
    ) && hasQualityAvoidanceCue(normalizedText)
  ) {
    addPreference('avoidSingleSubjectDay');
  }

  if (
    /30\s*分台|30\s*分だけ|短すぎ|短い/.test(normalizedText) &&
    hasQualityAvoidanceCue(normalizedText)
  ) {
    addPreference('avoidTinyChunks');
  }

  if (/細切れ/.test(normalizedText) && hasQualityAvoidanceCue(normalizedText)) {
    addPreference(
      /重いタスク|重め|卒研|レポート|実装|計算理論/.test(normalizedText)
        ? 'avoidFragmentingHeavyTasks'
        : 'avoidTinyChunks',
    );
  }

  if (
    /同じ科目|同一科目|同じタスク|同一タスク|科目/.test(normalizedText) &&
    /固ま|固め/.test(normalizedText) &&
    hasQualityAvoidanceCue(normalizedText)
  ) {
    addPreference('avoidSameTaskClumping');
  }

  return operations;
}

function hasExplicitDayCountInstruction(text: string): boolean {
  return /日(?:間)?\s*(?:で|にして|へ変更|に変更|に分散|へ分散|で分散|でやって|で作成|使って|配置|$)/.test(
    text,
  );
}

function hasExplicitMaxSessionInstruction(text: string): boolean {
  return (
    /(?:1回|一回|1セッション|セッション|最大|上限|連続|ぶっ続け).*?\d+\s*分\s*(?:で|まで|以内|にして|に変更|上限|$)/.test(
      text,
    ) ||
    /\d+\s*分\s*(?:以内|まで)/.test(text) ||
    /(?:最大|上限)\s*\d+\s*分/.test(text) ||
    /じゃなくて\s*\d+\s*分/.test(text)
  );
}

function classifyConditionClause(clause: string): WeeklyConditionOperation[] {
  const normalizedClause = normalizeConditionText(clause);
  const operations: WeeklyConditionOperation[] = [];
  const dayCountMatch = normalizedClause.match(
    /([\d一二三四五六七八九十]+)\s*日(?:間)?(?=\s*(?:で|に|へ|使|配置|$))/,
  );
  const qualityPreferenceOperations = classifyQualityPreferenceOperations(normalizedClause);
  const hasQualityAvoidance = hasQualityAvoidanceCue(normalizedClause);

  const clockRange = parseClockRange(normalizedClause);
  const clockMentions = extractClockMentions(normalizedClause);
  const minuteMentions = extractDurationMentions(normalizedClause);
  const lastMinutes = minuteMentions[minuteMentions.length - 1];
  const hasSleepCue = /睡眠|寝る|寝て|就寝|起床|起きる|起き/.test(normalizedClause);
  const hasUnavailableCue =
    /昼|お昼|昼食|昼ごはん|昼ご飯|ランチ|夕食|夜ごはん|夜ご飯|晩ごはん|晩ご飯|食事|ごはん|ご飯|空け|使わない|除外|無理/.test(
      normalizedClause,
    ) ||
    (/休憩|休み|インターバル/.test(normalizedClause) && Boolean(clockRange));
  const hasStartCue =
    /勉強開始|開始|始め|スタート|勉強可能|使える|朝は|午前は|から勉強|勉強できる/.test(
      normalizedClause,
    );
  const hasEndCue = /終了|終わり|まで|何時まで|夜は/.test(normalizedClause);

  const sessionIntentOverride = createSessionIntentOverrideFromText(
    normalizedClause,
    'global',
  );

  if (sessionIntentOverride) {
    operations.push({
      kind: 'addSessionIntentOverride',
      override: sessionIntentOverride,
    });
  }


  if (dayCountMatch && hasExplicitDayCountInstruction(normalizedClause)) {
    const dayCount = parseJapaneseSmallInteger(dayCountMatch[1]);
    if (dayCount !== null) {
      operations.push({ kind: 'setDayCount', dayCount });
    }
  } else if (/予備日(?:も)?使|予備日を使/.test(normalizedClause)) {
    operations.push({ kind: 'extendDayCount', days: 1 });
  } else if (/期間を延ばす/.test(normalizedClause)) {
    operations.push({ kind: 'extendDayCount', days: 1 });
  }

  if (isExplicitPartialPlacementConfirmation(normalizedClause)) {
    operations.push({ kind: 'allowPartialPlacement' });
  }

  if (hasSleepCue && clockRange) {
    operations.push({
      kind: 'setSleepWindow',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
    });
    return operations;
  }

  if (hasSleepCue && clockMentions.length >= 2) {
    operations.push({
      kind: 'setSleepWindow',
      startTime: clockMentions[0],
      endTime: clockMentions[1],
    });
    return operations;
  }

  if (/食事|昼食|夕食|昼休み|休憩/.test(normalizedClause) && /なし|不要|いらない|消して|外して/.test(normalizedClause)) {
    operations.push({
      kind: 'removeUnavailableRange',
      reason: /昼|昼食|昼休み/.test(normalizedClause)
        ? '昼食'
        : /夕|夜ご飯|食事/.test(normalizedClause)
          ? '夕食'
          : undefined,
    });
    return operations;
  }

  if (clockRange && hasUnavailableCue) {
    operations.push({
      kind: 'addUnavailableRange',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
      reason: resolveUnavailableReason(normalizedClause),
    });
    return operations;
  }

  if (clockRange && /中心|集中|メイン|優先/.test(normalizedClause)) {
    operations.push({
      kind: 'setPreferredRange',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
    });
  } else if (clockRange) {
    operations.push({
      kind: 'setAvailableRange',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
    });
  } else if (clockMentions.length > 0 && hasStartCue && !hasEndCue) {
    operations.push({ kind: 'setAvailableStartTime', startTime: clockMentions[0] });
  } else if (clockMentions.length > 0 && hasEndCue) {
    operations.push({ kind: 'setAvailableEndTime', endTime: clockMentions[0] });
  }

  if (!hasQualityAvoidance && hasExplicitMaxSessionInstruction(normalizedClause)) {
    const minutes = getLastMinutesMention(normalizedClause);
    if (minutes !== null) {
      operations.push({ kind: 'setMaxSessionMinutes', minutes: Math.max(30, minutes) });
    }
  }

  qualityPreferenceOperations.forEach((operation) => operations.push(operation));

  if (/休憩|休み|インターバル/.test(normalizedClause) && !clockRange && lastMinutes !== undefined) {
    operations.push({ kind: 'setBreakMinutes', minutes: Math.max(0, lastMinutes) });
  }

  if (/午前は使わない/.test(normalizedClause)) {
    operations.push({ kind: 'setAvailableStartTime', startTime: '12:00' });
  } else if (/夜も使う/.test(normalizedClause)) {
    operations.push({
      kind: 'setAvailableRange',
      startTime: '20:00',
      endTime: '24:00',
    });
  }

  return operations;
}

export function parseWeeklyPlanningConditionOperations(
  text: string,
): WeeklyConditionOperation[] {
  const operations = splitConditionClauses(text).flatMap(classifyConditionClause);

  return operations.filter(
    (operation, index, array) =>
      array.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(operation)) ===
      index,
  );
}

function mergeWeeklyPlanningQualityPreferences(
  current: WeeklyPlanningQualityPreference[] | undefined,
  preference: WeeklyPlanningQualityPreference,
): WeeklyPlanningQualityPreference[] {
  return current?.includes(preference) ? [...current] : [...(current ?? []), preference];
}

function getQualityPreferenceMessage(preference: WeeklyPlanningQualityPreference): string {
  switch (preference) {
    case 'preferTaskSpread':
      return '複数日に分散しやすい配置を優先します。';
    case 'avoidSingleSubjectDay':
      return '1日1科目だけに偏りにくい配置を優先します。';
    case 'avoidTinyChunks':
      return '30分台の細かい学習ブロックを避ける設定にしました。';
    case 'avoidFragmentingHeavyTasks':
      return '重いタスクが細切れになりにくい配置を優先します。';
    case 'avoidSameTaskClumping':
      return '同じ科目が同じ日に固まりにくい配置を優先します。';
  }
}

function withUpdatedAvailableRanges(
  defaults: WeeklyPlanningDefaultConditions,
  updater: (
    range: WeeklyPlanningDefaultConditions['availableStudyRanges'][number],
  ) => WeeklyPlanningDefaultConditions['availableStudyRanges'][number],
): WeeklyPlanningDefaultConditions {
  const nextDefaults = cloneWeeklyPlanningDefaults(defaults);
  const nextRanges = nextDefaults.availableStudyRanges
    .map(updater)
    .filter((range) => minutesFromTime(range.startTime) < minutesFromTime(range.endTime));

  nextDefaults.availableStudyRanges =
    nextRanges.length > 0
      ? nextRanges
      : [{ startTime: DEFAULT_WAKE_TIME, endTime: DEFAULT_SLEEP_START_TIME, reason: '既定' }];
  return nextDefaults;
}

function applyWeeklyConditionOperation(params: {
  config: WeeklyPlanningPendingConfig;
  operation: WeeklyConditionOperation;
}): { config: WeeklyPlanningPendingConfig; message: string } {
  const config = params.config;
  const operation = params.operation;

  switch (operation.kind) {
    case 'setDayCount': {
      return {
        config: { ...config, defaults: withUpdatedDayCount(config.defaults, operation.dayCount) },
        message: `${operation.dayCount}日間に変更しました。`,
      };
    }
    case 'extendDayCount': {
      const dayCount = config.defaults.dayCount + operation.days;
      return {
        config: { ...config, defaults: withUpdatedDayCount(config.defaults, dayCount) },
        message: operation.days === 1 ? '予備日も配置対象に入れました。' : `${dayCount}日間に変更しました。`,
      };
    }
    case 'setAvailableStartTime': {
      return {
        config: {
          ...config,
          defaults: withUpdatedAvailableRanges(config.defaults, (range) => ({
            ...range,
            startTime: operation.startTime,
            reason: '指定された勉強可能時間帯',
          })),
        },
        message: `勉強開始時刻を${operation.startTime}に変更しました。`,
      };
    }
    case 'setAvailableEndTime': {
      return {
        config: {
          ...config,
          defaults: withUpdatedAvailableRanges(config.defaults, (range) => ({
            ...range,
            endTime: operation.endTime,
            reason: '指定された勉強可能時間帯',
          })),
        },
        message: `勉強終了時刻を${operation.endTime}に変更しました。`,
      };
    }
    case 'setAvailableRange': {
      const range = {
        startTime: operation.startTime,
        endTime: operation.endTime,
        reason: '指定された勉強可能時間帯',
      };
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.availableStudyRanges = [range];
      defaults.preferredStudyRanges = [range];
      defaults.unavailableRanges = [];
      return {
        config: { ...config, defaults },
        message: `勉強可能時間帯を${operation.startTime}-${operation.endTime}に変更しました。`,
      };
    }
    case 'addUnavailableRange': {
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.unavailableRanges = [
        ...defaults.unavailableRanges.filter((range) => range.reason !== operation.reason),
        {
          startTime: operation.startTime,
          endTime: operation.endTime,
          reason: operation.reason,
        },
      ];
      return {
        config: { ...config, defaults },
        message: `${operation.reason}として${operation.startTime}-${operation.endTime}を使わない時間にしました。`,
      };
    }
    case 'removeUnavailableRange': {
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.unavailableRanges = operation.reason
        ? defaults.unavailableRanges.filter((range) => range.reason !== operation.reason)
        : [];
      return {
        config: { ...config, defaults },
        message: operation.reason
          ? `${operation.reason}の除外時間を外しました。`
          : '使わない時間帯を外しました。',
      };
    }
    case 'setPreferredRange': {
      const range = {
        startTime: operation.startTime,
        endTime: operation.endTime,
        reason: '指定された集中時間帯',
      };
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.preferredStudyRanges = [range];
      return {
        config: { ...config, defaults },
        message: `集中しやすい時間帯を${operation.startTime}-${operation.endTime}に変更しました。`,
      };
    }
    case 'setMaxSessionMinutes': {
      return {
        config: {
          ...config,
          defaults: {
            ...cloneWeeklyPlanningDefaults(config.defaults),
            maxSessionMinutes: operation.minutes,
          },
        },
        message: `1回の学習上限を${operation.minutes}分に変更しました。`,
      };
    }
    case 'setBreakMinutes': {
      return {
        config: {
          ...config,
          defaults: {
            ...cloneWeeklyPlanningDefaults(config.defaults),
            breakMinutes: operation.minutes,
          },
        },
        message: `休憩時間を${operation.minutes}分に変更しました。`,
      };
    }
    case 'setSleepWindow': {
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.sleepStartTime = operation.startTime;
      defaults.wakeTime = operation.endTime;
      defaults.availableStudyRanges = getAvailableStudyRangesForSleep({
        wakeTime: defaults.wakeTime,
        sleepStartTime: defaults.sleepStartTime,
      });
      return {
        config: { ...config, defaults },
        message: `睡眠時間を${operation.startTime}から${operation.endTime}に変更しました。`,
      };
    }
    case 'addSessionIntentOverride': {
      return {
        config: {
          ...config,
          sessionIntentOverrides: mergeSessionIntentOverrides(
            config.sessionIntentOverrides,
            operation.override,
          ),
        },
        message: operation.override.kind === 'fixed_two_hour'
            ? '2時間単位を優先する設定に変更しました。'
            : '長めのセッションを優先する設定に変更しました。',
      };
    }
    case 'addQualityPreference': {
      return {
        config: {
          ...config,
          qualityPreferences: mergeWeeklyPlanningQualityPreferences(
            config.qualityPreferences,
            operation.preference,
          ),
        },
        message: getQualityPreferenceMessage(operation.preference),
      };
    }
    case 'allowPartialPlacement': {
      return {
        config: { ...config, allowPartialPlacement: true },
        message: '配置できる分だけ作成する設定に変更しました。',
      };
    }
    default: {
      return { config, message: '' };
    }
  }
}

export function applyWeeklyPlanningConditionOverride(params: {
  config: WeeklyPlanningPendingConfig;
  text: string;
}): WeeklyPlanningConditionOverrideResult {
  const operations = parseWeeklyPlanningConditionOperations(params.text);

  if (operations.length === 0) {
    return {
      kind: 'unrecognized',
      config: params.config,
      message: WEEKLY_PLANNING_CONDITION_OVERRIDE_HELP,
    };
  }

  let nextConfig: WeeklyPlanningPendingConfig = {
    ...params.config,
    tasks: params.config.tasks.map((task) => ({ ...task, amount: { ...task.amount } })),
    defaults: cloneWeeklyPlanningDefaults(params.config.defaults),
    sessionIntentOverrides: [...(params.config.sessionIntentOverrides ?? [])],
    qualityPreferences: [...(params.config.qualityPreferences ?? [])],
  };
  const messages: string[] = [];

  operations.forEach((operation) => {
    const result = applyWeeklyConditionOperation({
      config: nextConfig,
      operation,
    });
    nextConfig = result.config;

    if (result.message) {
      messages.push(result.message);
    }
  });

  return {
    kind: 'updated',
    config: nextConfig,
    messages,
  };
}

function buildWeeklyPlanningConfirmationSummary(params: {
  tasks: SimpleWeeklyTask[];
  defaults: WeeklyPlanningDefaultConditions;
  includeEstimateProposal?: boolean;
}): string {
  const totalMinutes = params.tasks.reduce(
    (sum, task) => sum + task.durationMinutes,
    0,
  );
  const taskCount = params.tasks.length;
  const taskSummary =
    totalMinutes > 0
      ? `${taskCount}件のタスク、時間指定分は合計${totalMinutes}分を対象にします。`
      : `${taskCount}件のタスクを対象にします。`;
  const estimateSummary = params.includeEstimateProposal
    ? [
        '時間換算が必要な学習量があります。',
        '見積もり案: 50語=30分、1問=10分、1ページ=5分、1題=30分、1年分=120分。',
      ].join('\n')
    : '';
  const unavailableSummary =
    params.defaults.unavailableRanges.length > 0 ? '食事、' : '';

  return [
    taskSummary,
    estimateSummary,
    `${params.defaults.startDate}から${params.defaults.dayCount}日間へ配置し、${params.defaults.reserveDate}は予備日にします。`,
    `勉強可能時間: ${formatStudyRanges(params.defaults.availableStudyRanges)}。`,
    `睡眠 ${params.defaults.sleepStartTime}-翌${params.defaults.wakeTime}、${unavailableSummary}既存予定前後${params.defaults.bufferMinutes}分を避けます。`,
    `1回の学習は最大${params.defaults.maxSessionMinutes}分、休憩${params.defaults.breakMinutes}分、${params.defaults.minStudyBlockMinutes}分未満の空き時間は使いません。`,
    `集中しやすい時間帯として ${params.defaults.preferredStudyRanges
      .map((range) => `${range.startTime}-${range.endTime}`)
      .join('、')} を優先します。`,
    params.tasks.some((task) => task.priority === 'high' || task.deadlineDate)
      ? '重要度や締切があるタスクは週の前半へ寄せます。'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function extractSimpleWeeklyPlanningTasks(
  text: string,
  selectedDate?: string,
): SimpleWeeklyTask[] {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return [];
  }

  return splitWeeklyPlanningTaskTexts(trimmedText)
    .map((taskText) => {
      if (isPlacementConditionOnly(taskText)) {
        return null;
      }

      const amount = parseWeeklyPlanningTaskAmount(taskText);

      if (!amount) {
        return null;
      }

      const title = resolveSimpleTaskTitle(taskText);
      const durationMinutes = amount.unit === 'minutes' ? amount.value ?? 0 : 0;
      const deadlineDate = extractTaskDeadlineDate(
        taskText,
        selectedDate ?? new Date().toISOString().slice(0, 10),
      );
      const task: SimpleWeeklyTask = {
        title,
        durationMinutes,
        amount,
        requiresTimeEstimate: amount.unit !== 'minutes',
        type: detectType(taskText),
        sourceText: taskText,
        priority: resolveTaskPriority(taskText),
      };

      if (deadlineDate) {
        task.deadlineDate = deadlineDate;
      }

      return task;
    })
    .filter((task): task is SimpleWeeklyTask => task !== null);
}

export function assessWeeklyPlanningRequest(params: {
  selectedDate: string;
  text: string;
  hasPendingConfirmation?: boolean;
  confirmationText?: string;
}): WeeklyPlanningRequestAssessment {
  const trimmedText = params.text.trim();
  const defaults = getDefaultWeeklyPlanningConditions({
    selectedDate: params.selectedDate,
    text: trimmedText,
  });

  if (!trimmedText) {
    return {
      kind: 'empty',
      tasks: [],
      defaults,
      questions: ['週間計画にしたい科目・タスクと合計時間を入力してください。'],
      confirmationSummary: '',
    };
  }

  const tasks = extractSimpleWeeklyPlanningTasks(trimmedText, params.selectedDate);

  if (tasks.length === 0) {
    return {
      kind: 'needs_task_details',
      tasks,
      defaults,
      questions: [
        '「英語を3時間、計算理論を4時間」のように、タスク名と合計時間を教えてください。',
      ],
      confirmationSummary: '',
    };
  }

  const hasUnestimatedAmounts = tasks.some((task) => task.requiresTimeEstimate);
  const confirmationSummary = buildWeeklyPlanningConfirmationSummary({
    tasks,
    defaults,
    includeEstimateProposal: hasUnestimatedAmounts,
  });

  if (hasUnestimatedAmounts) {
    return {
      kind: 'needs_time_estimate',
      tasks,
      defaults,
      questions: [
        '単語数・問題数・ページ数などを何分相当で見積もるか確認してください。',
        'この見積もり案で作成してよい場合は「この条件で作成」と入力してください。',
      ],
      confirmationSummary,
    };
  }

  if (isExplicitCreateConfirmation(params.confirmationText ?? trimmedText)) {
    return {
      kind: 'ready',
      tasks,
      defaults,
      questions: [],
      confirmationSummary,
    };
  }

  if (
    params.hasPendingConfirmation &&
    isDefaultConditionProposalResponse(params.confirmationText ?? trimmedText)
  ) {
    return {
      kind: 'needs_confirmation',
      tasks,
      defaults,
      questions: [
        '以下のデフォルト条件案で作成してよいですか？問題なければ「この条件で作成」と入力してください。',
      ],
      confirmationSummary,
    };
  }

  return {
    kind: 'needs_confirmation',
    tasks,
    defaults,
    questions: [
      '開始希望・集中しやすい時間帯・1回の上限などが未確認です。',
      '以下の条件案でよければ「この条件で作成」と入力してください。',
    ],
    confirmationSummary,
  };
}

export function mergeWeeklyPlanningRevision(params: {
  selectedDate: string;
  previousText: string;
  revisionText: string;
}): WeeklyPlanningRequestAssessment {
  const mergedText = `${params.previousText}、${params.revisionText}`;
  const defaults = getDefaultWeeklyPlanningConditions({
    selectedDate: params.selectedDate,
    text: mergedText,
  });
  const mergedTasks = new Map<string, SimpleWeeklyTask>();

  extractSimpleWeeklyPlanningTasks(params.previousText, params.selectedDate).forEach(
    (task) => {
      mergedTasks.set(task.title, task);
    },
  );
  extractSimpleWeeklyPlanningTasks(params.revisionText, params.selectedDate).forEach(
    (task) => {
      mergedTasks.set(task.title, task);
    },
  );

  const tasks = Array.from(mergedTasks.values());

  if (tasks.length === 0) {
    return {
      kind: 'needs_task_details',
      tasks,
      defaults,
      questions: [
        '変更後の週間計画に含めるタスク名と合計時間を教えてください。',
      ],
      confirmationSummary: '',
    };
  }

  const hasUnestimatedAmounts = tasks.some((task) => task.requiresTimeEstimate);
  const confirmationSummary = buildWeeklyPlanningConfirmationSummary({
    tasks,
    defaults,
    includeEstimateProposal: hasUnestimatedAmounts,
  });

  return {
    kind: hasUnestimatedAmounts ? 'needs_time_estimate' : 'needs_confirmation',
    tasks,
    defaults,
    questions: hasUnestimatedAmounts
      ? [
          '追加された単語数・問題数などを何分相当で見積もるか確認してください。',
        ]
      : [
          '前回条件と今回の修正を統合しました。問題なければ「この条件で作成」と入力してください。',
        ],
    confirmationSummary,
  };
}

function intersectInterval(left: TimeInterval, right: TimeInterval): boolean {
  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
}

function subtractInterval(slots: TimeInterval[], blocked: TimeInterval): TimeInterval[] {
  return slots.flatMap((slot) => {
    if (!intersectInterval(slot, blocked)) {
      return [slot];
    }

    const nextSlots: TimeInterval[] = [];

    if (slot.startMinutes < blocked.startMinutes) {
      nextSlots.push({
        startMinutes: slot.startMinutes,
        endMinutes: Math.max(slot.startMinutes, blocked.startMinutes),
      });
    }

    if (blocked.endMinutes < slot.endMinutes) {
      nextSlots.push({
        startMinutes: Math.min(slot.endMinutes, blocked.endMinutes),
        endMinutes: slot.endMinutes,
      });
    }

    return nextSlots.filter(
      (nextSlot) => nextSlot.endMinutes > nextSlot.startMinutes,
    );
  });
}

function buildBaseAvailableIntervals(
  defaults: WeeklyPlanningDefaultConditions,
): TimeInterval[] {
  let intervals: TimeInterval[] = defaults.availableStudyRanges.map((range) => ({
    startMinutes: minutesFromTime(
      defaults.deepNightAllowed ? '00:00' : range.startTime,
    ),
    endMinutes: minutesFromTime(range.endTime),
  }));

  defaults.unavailableRanges.forEach((range) => {
    intervals = subtractInterval(intervals, {
      startMinutes: minutesFromTime(range.startTime),
      endMinutes: minutesFromTime(range.endTime),
    });
  });

  return intervals.filter(
    (interval) =>
      interval.endMinutes - interval.startMinutes >= defaults.minStudyBlockMinutes,
  );
}

function buildAvailabilitySlots(params: {
  defaults: WeeklyPlanningDefaultConditions;
  existingPlans: Plan[];
}): AvailabilitySlot[] {
  const baseIntervals = buildBaseAvailableIntervals(params.defaults);
  const planningDates = Array.from(
    { length: params.defaults.dayCount },
    (_, index) => addDays(params.defaults.startDate, index),
  );

  return planningDates.flatMap((date) => {
    let intervals = [...baseIntervals];

    params.existingPlans
      .filter((plan) => plan.date === date)
      .forEach((plan) => {
        intervals = subtractInterval(intervals, {
          startMinutes: Math.max(
            0,
            minutesFromTime(plan.startTime) - params.defaults.bufferMinutes,
          ),
          endMinutes: Math.min(
            SIMPLE_DRAFT_DAY_END_MINUTES,
            minutesFromTime(plan.endTime) + params.defaults.bufferMinutes,
          ),
        });
      });

    return intervals
      .filter(
        (interval) =>
          interval.endMinutes - interval.startMinutes >=
          params.defaults.minStudyBlockMinutes,
      )
      .map((interval) => ({
        date,
        ...interval,
      }));
  });
}

function sumSlotMinutes(slots: AvailabilitySlot[]): number {
  return slots.reduce(
    (sum, slot) => sum + Math.max(0, slot.endMinutes - slot.startMinutes),
    0,
  );
}

function sumIntervals(intervals: TimeInterval[]): number {
  return intervals.reduce(
    (sum, interval) => sum + Math.max(0, interval.endMinutes - interval.startMinutes),
    0,
  );
}

function calculateBreakMinutesConsumed(params: {
  blocks: WeeklyPlanDraftBlock[];
  breakMinutes: number;
}): number {
  const blocksByDate = new Map<string, WeeklyPlanDraftBlock[]>();

  params.blocks.forEach((block) => {
    const dateBlocks = blocksByDate.get(block.date) ?? [];
    dateBlocks.push(block);
    blocksByDate.set(block.date, dateBlocks);
  });

  return Array.from(blocksByDate.values()).reduce((total, dateBlocks) => {
    if (dateBlocks.length <= 1) {
      return total;
    }

    return total + (dateBlocks.length - 1) * params.breakMinutes;
  }, 0);
}

function intervalOverlapsUnavailableRange(
  defaults: WeeklyPlanningDefaultConditions,
  startMinutes: number,
  endMinutes: number,
): boolean {
  return defaults.unavailableRanges.some((range) =>
    intersectInterval(
      { startMinutes, endMinutes },
      {
        startMinutes: minutesFromTime(range.startTime),
        endMinutes: minutesFromTime(range.endTime),
      },
    ),
  );
}

function calculatePlacementQualityDiagnostics(params: {
  defaults: WeeklyPlanningDefaultConditions;
  tasks: SimpleWeeklyTask[];
  blocks: WeeklyPlanDraftBlock[];
}): WeeklyPlacementQualityDiagnostics {
  const planningDates = Array.from(
    { length: params.defaults.dayCount },
    (_, index) => addDays(params.defaults.startDate, index),
  );
  const dailyMinutes = planningDates.map((date) =>
    params.blocks
      .filter((block) => block.date === date)
      .reduce(
        (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
        0,
      ),
  );
  const activeDailyMinutes = dailyMinutes.filter((minutes) => minutes > 0);
  const dailyLoadBalance = activeDailyMinutes.length > 0
    ? Math.max(...activeDailyMinutes) - Math.min(...activeDailyMinutes)
    : 0;
  const taskDates = new Map<string, Set<string>>();
  const taskDateCounts = new Map<string, number>();
  let tinyChunkPenalty = 0;
  let preferredWindowBonus = 0;
  let compactnessGapMinutes = 0;
  let subjectSwitchPenalty = 0;
  let sameDayFragmentationPenalty = 0;
  let heavyTaskLatePenalty = 0;

  params.blocks.forEach((block) => {
    const durationMinutes = minutesBetween(block.startTime, block.endTime);
    const dates = taskDates.get(block.title) ?? new Set<string>();
    dates.add(block.date);
    taskDates.set(block.title, dates);
    const taskDateKey = `${block.title}|${block.date}`;
    taskDateCounts.set(taskDateKey, (taskDateCounts.get(taskDateKey) ?? 0) + 1);

    if (durationMinutes > 0 && durationMinutes < 40) {
      tinyChunkPenalty += 1;
    }

    preferredWindowBonus += calculatePreferredOverlapMinutes(
      params.defaults,
      minutesFromTime(block.startTime),
      minutesFromTime(block.endTime),
    );
  });

  planningDates.forEach((date) => {
    const dateBlocks = params.blocks
      .filter((block) => block.date === date)
      .slice()
      .sort(
        (left, right) =>
          minutesFromTime(left.startTime) - minutesFromTime(right.startTime),
      );

    let switches = 0;
    const runsByTitle = new Map<string, number>();
    let previousTitle: string | undefined;

    dateBlocks.forEach((block, index) => {
      if (previousTitle !== undefined && previousTitle !== block.title) {
        switches += 1;
      }

      if (previousTitle !== block.title) {
        runsByTitle.set(block.title, (runsByTitle.get(block.title) ?? 0) + 1);
      }

      previousTitle = block.title;
      if (index === 0) {
        return;
      }

      const previousEnd = minutesFromTime(dateBlocks[index - 1].endTime);
      const currentStart = minutesFromTime(block.startTime);
      const gapMinutes = currentStart - previousEnd;

      if (
        gapMinutes > params.defaults.breakMinutes &&
        !intervalOverlapsUnavailableRange(params.defaults, previousEnd, currentStart)
      ) {
        compactnessGapMinutes += gapMinutes - params.defaults.breakMinutes;
      }
    });

    const uniqueTitleCount = new Set(dateBlocks.map((block) => block.title)).size;
    const excessiveSwitches = Math.max(0, switches - Math.max(0, uniqueTitleCount - 1));
    subjectSwitchPenalty += excessiveSwitches;
    sameDayFragmentationPenalty += Array.from(runsByTitle.values()).reduce(
      (total, runs) => total + Math.max(0, runs - 1),
      0,
    );
    heavyTaskLatePenalty += dateBlocks.reduce((total, block) => {
      const task = params.tasks.find((candidate) => candidate.title === block.title);

      if (!task || !isHeavyStudyTask(task)) {
        return total;
      }

      const lateMinutes = Math.max(
        0,
        minutesFromTime(block.endTime) - Math.max(minutesFromTime(block.startTime), 22 * 60),
      );

      return total + lateMinutes;
    }, 0);
  });

  const taskSpread = Array.from(taskDates.values()).reduce(
    (total, dates) => total + dates.size,
    0,
  );
  const sameTaskClumpingPenalty = Array.from(taskDateCounts.values()).reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );

  return {
    dailyLoadBalance,
    taskSpread,
    sameTaskClumpingPenalty,
    tinyChunkPenalty,
    compactness: compactnessGapMinutes,
    preferredWindowBonus,
    explicitIntentOverride: params.tasks.some((task) =>
      hasTaskConsolidationIntent(task.sourceText),
    ),
    subjectSwitchPenalty,
    sameDayFragmentationPenalty,
    heavyTaskLatePenalty,
  };
}


function resolveGapReason(params: {
  defaults: WeeklyPlanningDefaultConditions;
  existingPlans: Plan[];
  date: string;
  startMinutes: number;
  endMinutes: number;
}): string {
  const gapInterval = { startMinutes: params.startMinutes, endMinutes: params.endMinutes };
  const plansForDate = params.existingPlans.filter((plan) => plan.date === params.date);
  const overlappingPlan = plansForDate.find((plan) =>
    intersectInterval(gapInterval, {
      startMinutes: minutesFromTime(plan.startTime),
      endMinutes: minutesFromTime(plan.endTime),
    }),
  );

  if (overlappingPlan) {
    return 'existing_plan';
  }

  const overlappingPlanBuffer = plansForDate.find((plan) => {
    const planStart = minutesFromTime(plan.startTime);
    const planEnd = minutesFromTime(plan.endTime);

    return (
      intersectInterval(gapInterval, {
        startMinutes: Math.max(0, planStart - params.defaults.bufferMinutes),
        endMinutes: planStart,
      }) ||
      intersectInterval(gapInterval, {
        startMinutes: planEnd,
        endMinutes: Math.min(24 * 60, planEnd + params.defaults.bufferMinutes),
      })
    );
  });

  if (overlappingPlanBuffer) {
    return 'existing_plan_buffer';
  }

  const overlappingUnavailable = params.defaults.unavailableRanges.find((range) =>
    intersectInterval(
      gapInterval,
      {
        startMinutes: minutesFromTime(range.startTime),
        endMinutes: minutesFromTime(range.endTime),
      },
    ),
  );

  if (overlappingUnavailable) {
    return overlappingUnavailable.reason;
  }

  const overlapsAvailableRange = params.defaults.availableStudyRanges.some((range) =>
    intersectInterval(gapInterval, {
      startMinutes: minutesFromTime(range.startTime),
      endMinutes: minutesFromTime(range.endTime),
    }),
  );

  if (!overlapsAvailableRange) {
    return 'sleep';
  }

  return 'unexplained_gap';
}

function calculateGapReasons(params: {
  defaults: WeeklyPlanningDefaultConditions;
  existingPlans: Plan[];
  blocks: WeeklyPlanDraftBlock[];
}): NonNullable<WeeklyPlacementDiagnostics['gapReasons']> {
  const blocksByDate = new Map<string, WeeklyPlanDraftBlock[]>();

  params.blocks.forEach((block) => {
    blocksByDate.set(block.date, [...(blocksByDate.get(block.date) ?? []), block]);
  });

  return Array.from(blocksByDate.entries()).flatMap(([date, dateBlocks]) => {
    const sortedBlocks = dateBlocks
      .slice()
      .sort(
        (left, right) =>
          minutesFromTime(left.startTime) - minutesFromTime(right.startTime),
      );
    const reasons: NonNullable<WeeklyPlacementDiagnostics['gapReasons']> = [];

    sortedBlocks.forEach((block, index) => {
      if (index === 0) {
        return;
      }

      const previousEnd = minutesFromTime(sortedBlocks[index - 1].endTime);
      const currentStart = minutesFromTime(block.startTime);

      if (currentStart - previousEnd <= params.defaults.breakMinutes) {
        return;
      }

      reasons.push({
        date,
        startMinutes: previousEnd,
        endMinutes: currentStart,
        reason: resolveGapReason({
          defaults: params.defaults,
          existingPlans: params.existingPlans,
          date,
          startMinutes: previousEnd,
          endMinutes: currentStart,
        }),
      });
    });

    return reasons;
  });
}

function calculateWeeklyPlacementDiagnostics(params: {
  defaults: WeeklyPlanningDefaultConditions;
  existingPlans: Plan[];
  requestedMinutes: number;
  placedMinutes: number;
  unplacedMinutes: number;
  blocks: WeeklyPlanDraftBlock[];
  initialSlots: AvailabilitySlot[];
  remainingSlots: AvailabilitySlot[];
  retryLimitReached?: boolean;
  tasks: SimpleWeeklyTask[];
  sessionEvaluations?: SessionPlacementEvaluation[];
  fallbackPlacements?: NonNullable<WeeklyPlacementDiagnostics['fallbackPlacements']>;
  retryEvents?: NonNullable<WeeklyPlacementDiagnostics['retryEvents']>;
  tinyChunkViolations?: NonNullable<WeeklyPlacementDiagnostics['tinyChunkViolations']>;
}): WeeklyPlacementDiagnostics {
  const baseSlots = buildAvailabilitySlots({
    defaults: params.defaults,
    existingPlans: [],
  });
  const totalAvailableCapacity = sumSlotMinutes(params.initialSlots);
  const existingPlanBlockedMinutes = Math.max(
    0,
    sumSlotMinutes(baseSlots) - totalAvailableCapacity,
  );
  const totalUnavailableMinutes =
    sumIntervals(params.defaults.unavailableRanges.map((range) => ({
      startMinutes: minutesFromTime(range.startTime),
      endMinutes: minutesFromTime(range.endTime),
    }))) * params.defaults.dayCount;
  const breakMinutesConsumed = calculateBreakMinutesConsumed({
    blocks: params.blocks,
    breakMinutes: params.defaults.breakMinutes,
  });
  const unusedAvailableMinutes = sumSlotMinutes(params.remainingSlots);
  const planningDates = Array.from(
    { length: params.defaults.dayCount },
    (_, index) => addDays(params.defaults.startDate, index),
  );
  const dailyCapacity = planningDates.map((date) => {
    const availableMinutes = sumSlotMinutes(
      params.initialSlots.filter((slot) => slot.date === date),
    );
    const placedMinutes = params.blocks
      .filter((block) => block.date === date)
      .reduce(
        (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
        0,
      );

    return {
      date,
      availableMinutes,
      placedMinutes,
      unusedMinutes: Math.max(0, availableMinutes - placedMinutes),
    };
  });
  const maxRemainingSlotMinutes = params.remainingSlots.reduce(
    (maxMinutes, slot) =>
      Math.max(maxMinutes, Math.max(0, slot.endMinutes - slot.startMinutes)),
    0,
  );
  const placementQuality = {
    ...calculatePlacementQualityDiagnostics({
      defaults: params.defaults,
      tasks: params.tasks,
      blocks: params.blocks,
    }),
    explicitIntentOverride:
      params.sessionEvaluations?.some(
        (evaluation) =>
          (evaluation.selected?.components.explicitOverrideBonus ?? 0) > 0,
      ) ?? false,
  };
  const gapReasons = calculateGapReasons({
    defaults: params.defaults,
    existingPlans: params.existingPlans,
    blocks: params.blocks,
  });
  const failureReason: WeeklyPlacementDiagnostics['failureReason'] =
    params.unplacedMinutes <= 0
      ? 'unknown'
      : params.retryLimitReached
        ? 'placement_retry_limit'
        : existingPlanBlockedMinutes > 0 &&
          (totalAvailableCapacity < params.requestedMinutes || unusedAvailableMinutes === 0)
        ? 'existing_plan_conflict'
        : totalAvailableCapacity < params.requestedMinutes
          ? 'capacity_shortage'
          : unusedAvailableMinutes > 0 &&
              maxRemainingSlotMinutes < params.defaults.minStudyBlockMinutes
            ? 'min_block_fragmentation'
            : unusedAvailableMinutes > 0
              ? 'search_failure'
              : 'hard_constraint';

  return {
    requestedMinutes: params.requestedMinutes,
    placedMinutes: params.placedMinutes,
    unplacedMinutes: params.unplacedMinutes,
    totalAvailableCapacity,
    totalUnavailableMinutes,
    existingPlanBlockedMinutes,
    breakMinutesConsumed,
    unusedAvailableMinutes,
    dailyCapacity,
    placementQuality,
    sessionEvaluations: params.sessionEvaluations,
    fallbackPlacements: params.fallbackPlacements,
    retryEvents: params.retryEvents,
    tinyChunkViolations: params.tinyChunkViolations,
    gapReasons,
    failureReason,
  };
}


function hasTaskConsolidationIntent(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text);

  return /\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u7247\u3065\u3051|\u7247\u4ed8\u3051|\u5148\u306b|\u4eca\u65e5\u4e2d|\u512a\u5148|\u9577\u3081|(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(
    normalizedText,
  );
}

function allowsTinySessionForTask(task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>): boolean {
  const normalizedText = normalizeWeeklyPlanningText(
    `${task.title} ${task.sourceText}`,
  );

  return /\u6697\u8a18|\u5358\u8a9e|\u5c0f\u30c6\u30b9\u30c8|\u30c1\u30a7\u30c3\u30af|\u78ba\u8a8d|\u5fa9\u7fd2|\u30b9\u30ad\u30de|\u9699\u9593|\u8efd\u304f|30\s*\u5206\s*\u3060\u3051/.test(
    normalizedText,
  );
}

function roundToPlanningQuantum(minutes: number, quantumMinutes = 5): number {
  return Math.round(minutes / quantumMinutes) * quantumMinutes;
}

function distributeMinutesAcrossBuckets(
  totalMinutes: number,
  bucketCount: number,
  quantumMinutes = 5,
): number[] {
  const safeBucketCount = Math.max(1, bucketCount);
  const roundedAverage = roundToPlanningQuantum(totalMinutes / safeBucketCount, quantumMinutes);
  const buckets = Array.from({ length: safeBucketCount }, () => roundedAverage);
  let deltaMinutes = totalMinutes - buckets.reduce((sum, minutes) => sum + minutes, 0);
  let cursor = 0;

  while (Math.abs(deltaMinutes) >= quantumMinutes && buckets.length > 0) {
    const step = deltaMinutes > 0 ? quantumMinutes : -quantumMinutes;
    buckets[cursor] += step;
    deltaMinutes -= step;
    cursor = (cursor + 1) % buckets.length;
  }

  if (deltaMinutes !== 0 && buckets.length > 0) {
    buckets[buckets.length - 1] += deltaMinutes;
  }

  return buckets.sort((left, right) => right - left);
}

function isHeavyStudyTask(task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>): boolean {
  const normalizedText = normalizeWeeklyPlanningText(`${task.title} ${task.sourceText}`);

  return /\u5352\u7814|\u5b9f\u88c5|\u30ec\u30dd\u30fc\u30c8|\u8a08\u7b97\u7406\u8ad6|\u6587\u732e|\u7814\u7a76|\u8ad6\u6587|\u6df1\u3044|\u9577\u6587/.test(
    normalizedText,
  );
}

function resolveMinimumUsefulSessionMinutes(params: {
  task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>;
  allowTinySession: boolean;
  policyMinSessionMinutes?: number;
}): number {
  if (params.allowTinySession) {
    return Math.max(30, params.policyMinSessionMinutes ?? 30);
  }

  if (isHeavyStudyTask(params.task)) {
    return Math.max(60, params.policyMinSessionMinutes ?? 60);
  }

  return Math.max(45, params.policyMinSessionMinutes ?? 45);
}

function resolveTaskSpreadDayCount(params: {
  task: SimpleWeeklyTask;
  dayCount: number;
  consolidationIntent: boolean;
  allowTinySession: boolean;
}): number {
  if (params.consolidationIntent || params.dayCount <= 1) {
    return 1;
  }

  const minimumUsefulDailyMinutes = params.allowTinySession ? 30 : 60;
  const possibleSpreadDays = Math.max(
    1,
    Math.floor(params.task.durationMinutes / minimumUsefulDailyMinutes),
  );

  return Math.min(params.dayCount, possibleSpreadDays);
}

function resolveTaskSpreadDateIndexes(params: {
  taskIndex: number;
  dayCount: number;
  spreadDayCount: number;
  forceEarly: boolean;
}): number[] {
  if (params.spreadDayCount >= params.dayCount) {
    return Array.from({ length: params.dayCount }, (_, index) => index);
  }

  const startIndex = params.forceEarly ? 0 : params.taskIndex % params.dayCount;
  return Array.from({ length: params.spreadDayCount }, (_, index) =>
    (startIndex + index) % params.dayCount,
  ).sort((left, right) => left - right);
}

function splitQuotaIntoSessionChunks(params: {
  quotaMinutes: number;
  policy: SessionLengthPolicy;
  profile: StudyTaskProfile;
  allowTinySession: boolean;
  task: Pick<SimpleWeeklyTask, 'title' | 'sourceText'>;
}): number[] {
  const chunks = splitDurationIntoSessionChunks(
    params.quotaMinutes,
    params.policy,
    params.profile,
  );
  const minimumUsefulMinutes = resolveMinimumUsefulSessionMinutes({
    task: params.task,
    allowTinySession: params.allowTinySession,
    policyMinSessionMinutes: params.policy.minSessionMinutes,
  });
  const hasDiscouragedTinyChunk = chunks.some(
    (chunk) => chunk > 0 && chunk < minimumUsefulMinutes,
  );

  if (!hasDiscouragedTinyChunk) {
    return chunks;
  }

  for (let chunkCount = 2; chunkCount <= 6; chunkCount += 1) {
    const candidate = distributeMinutesAcrossBuckets(params.quotaMinutes, chunkCount);

    if (
      candidate.every(
        (chunk) =>
          chunk >= minimumUsefulMinutes && chunk <= params.policy.maxSessionMinutes,
      )
    ) {
      return candidate;
    }
  }

  return chunks;
}


function resolveSessionIntentForTask(params: {
  task: SimpleWeeklyTask;
  overrides: SessionIntentOverride[];
}): SessionIntentOverride | undefined {
  const taskOverride = params.overrides.find(
    (override) =>
      override.scope === 'task' &&
      override.appliesToTaskTitle === params.task.title,
  );

  if (taskOverride) {
    return taskOverride;
  }

  const sourceOverride = createSessionIntentOverrideFromText(
    params.task.sourceText,
    'task',
  );

  if (sourceOverride && hasTaskConsolidationIntent(params.task.sourceText)) {
    return {
      ...sourceOverride,
      appliesToTaskTitle: params.task.title,
    };
  }

  return params.overrides.find((override) => override.scope === 'global');
}

function shouldConsolidateSessionIntent(
  intent: SessionIntentOverride | undefined,
): boolean {
  return (
    (intent?.scope === 'task' &&
      (intent.kind === 'consolidate' ||
        intent.kind === 'one_shot_first' ||
        intent.kind === 'fixed_two_hour')) ||
    (intent?.scope === 'global' && intent.kind === 'fixed_two_hour')
  );
}

function resolveDefaultSubjectAnchorMinutes(params: {
  task: SimpleWeeklyTask;
  taskIndex: number;
  defaults: WeeklyPlanningDefaultConditions;
}): number {
  const profile = inferStudyTaskProfile(params.task);
  const text = normalizeWeeklyPlanningText(`${params.task.title} ${params.task.sourceText}`);

  if (/英語|単語|暗記|復習|チェック|確認/.test(text)) {
    return 13 * 60;
  }

  if (/卒研|研究|文献|論文/.test(text)) {
    return 11 * 60;
  }

  if (/計算理論|数学|線形代数|確率統計|証明/.test(text)) {
    return 14 * 60 + 30;
  }

  if (/実装|開発|レポート|文章|執筆/.test(text)) {
    return 15 * 60;
  }

  if (profile.cognitiveLoad + profile.contextRetentionCost >= 8) {
    return 14 * 60;
  }

  const preferredRange = params.defaults.preferredStudyRanges[params.taskIndex % Math.max(1, params.defaults.preferredStudyRanges.length)];

  if (preferredRange) {
    return minutesFromTime(preferredRange.startTime) + 60;
  }

  return 13 * 60 + params.taskIndex * 60;
}

function buildSubjectAnchorMinutes(
  tasks: SimpleWeeklyTask[],
  defaults: WeeklyPlanningDefaultConditions,
): Map<string, number> {
  const anchors = new Map<string, number>();
  const usedAnchors: number[] = [];

  tasks.forEach((task, taskIndex) => {
    if (anchors.has(task.title)) {
      return;
    }

    let anchorMinutes = resolveDefaultSubjectAnchorMinutes({ task, taskIndex, defaults });

    while (usedAnchors.some((usedAnchor) => Math.abs(usedAnchor - anchorMinutes) < 45)) {
      anchorMinutes += 60;
    }

    const latestReasonableAnchor = 21 * 60;
    if (anchorMinutes > latestReasonableAnchor) {
      anchorMinutes = 11 * 60 + (taskIndex % 5) * 60;
    }

    anchors.set(task.title, anchorMinutes);
    usedAnchors.push(anchorMinutes);
  });

  return anchors;
}

function createSessionPolicyOverrideFromIntent(
  intent: SessionIntentOverride | undefined,
): SessionLengthPolicyOverride | undefined {
  if (!intent) {
    return undefined;
  }

  const targetSessionMinutes = intent.targetSessionMinutes ??
    (intent.kind === 'fixed_two_hour' || intent.kind === 'prefer_long' ? 120 : undefined);

  if (!targetSessionMinutes) {
    return undefined;
  }

  return {
    mode: 'user_fixed',
    minSessionMinutes: Math.min(60, targetSessionMinutes),
    targetSessionMinutes,
    maxSessionMinutes: targetSessionMinutes,
    allowSmallRemainder: false,
    userExplicit: true,
  };
}

function buildWeeklyPlanningSessionBlocks(
  tasks: SimpleWeeklyTask[],
  defaults: WeeklyPlanningDefaultConditions,
  sessionIntentOverrides: SessionIntentOverride[] = [],
): WeeklyPlanningSessionBlock[] {
  const planningDates = Array.from(
    { length: defaults.dayCount },
    (_, index) => addDays(defaults.startDate, index),
  );
  const subjectAnchorMinutes = buildSubjectAnchorMinutes(tasks, defaults);
  const groups = tasks.map((task, taskIndex) => {
    const taskProfile = inferStudyTaskProfile(task);
    const sessionIntent = resolveSessionIntentForTask({
      task,
      overrides: sessionIntentOverrides,
    });
    const consolidationIntent = shouldConsolidateSessionIntent(sessionIntent);
    const sessionPolicyOverride = createSessionPolicyOverrideFromIntent(sessionIntent);
    const sessionPolicy = derivePersonalizedSessionPolicy({
      taskTitle: task.title,
      taskProfile,
      basePolicy: deriveSessionLengthPolicy(taskProfile, {
        maxSessionMinutes: defaults.maxSessionMinutes,
        minSessionMinutes: defaults.minStudyBlockMinutes,
        override: sessionPolicyOverride
          ? {
              ...sessionPolicyOverride,
              maxSessionMinutes: Math.min(
                defaults.maxSessionMinutes,
                sessionPolicyOverride.maxSessionMinutes ?? defaults.maxSessionMinutes,
              ),
            }
          : undefined,
      }),
    });
    const allowTinySession = allowsTinySessionForTask(task);
    const spreadDayCount = resolveTaskSpreadDayCount({
      task,
      dayCount: defaults.dayCount,
      consolidationIntent,
      allowTinySession,
    });
    const dateIndexes = resolveTaskSpreadDateIndexes({
      taskIndex,
      dayCount: defaults.dayCount,
      spreadDayCount,
      forceEarly: task.priority === 'high' || Boolean(task.deadlineDate),
    });
    const dailyQuotas = distributeMinutesAcrossBuckets(
      task.durationMinutes,
      dateIndexes.length,
    );

    return dateIndexes.flatMap((dateIndex, quotaIndex) => {
      const quotaMinutes = dailyQuotas[quotaIndex];
      const splitMinutes = splitQuotaIntoSessionChunks({
        quotaMinutes,
        policy: sessionPolicy,
        profile: taskProfile,
        allowTinySession,
        task,
      });

      return splitMinutes.map((durationMinutes, splitIndex) => ({
        title: task.title,
        type: task.type,
        durationMinutes,
        sourceTaskMinutes: task.durationMinutes,
        sourceText: task.sourceText,
        allowTinySession,
        minimumUsefulSessionMinutes: resolveMinimumUsefulSessionMinutes({
          task,
          allowTinySession,
          policyMinSessionMinutes: sessionPolicy.minSessionMinutes,
        }),
        dayQuotaMinutes: quotaMinutes,
        splitIndex,
        splitCount: splitMinutes.length,
        priority: task.priority,
        deadlineDate: task.deadlineDate,
        retryLevel: 0,
        preferredDate: planningDates[dateIndex],
        consolidationIntent,
        sessionIntentKind: sessionIntent?.kind,
        sessionIntentScope: sessionIntent?.scope,
      }));
    });
  });
  const sessions = groups.flat();

  return sessions.sort((left, right) => {
    const dateOrder = (left.preferredDate ?? '').localeCompare(right.preferredDate ?? '');

    if (dateOrder !== 0) {
      return dateOrder;
    }

    const anchorDelta =
      (subjectAnchorMinutes.get(left.title) ?? 12 * 60) -
      (subjectAnchorMinutes.get(right.title) ?? 12 * 60);

    if (anchorDelta !== 0) {
      return anchorDelta;
    }

    const titleOrder = left.title.localeCompare(right.title);

    if (titleOrder !== 0) {
      return titleOrder;
    }

    return left.splitIndex - right.splitIndex;
  });
}

export function splitDurationIntoDraftBlockMinutesWithMax(
  durationMinutes: number,
  maxSessionMinutes: number,
  minSessionMinutes = DEFAULT_MIN_STUDY_BLOCK_MINUTES,
): number[] {
  const blockMinutes: number[] = [];
  let remainingMinutes = durationMinutes;
  const safeMaxSessionMinutes = Math.max(30, maxSessionMinutes);
  const safeMinSessionMinutes = Math.max(1, minSessionMinutes);

  while (remainingMinutes > 0) {
    if (
      remainingMinutes > safeMaxSessionMinutes &&
      remainingMinutes - safeMaxSessionMinutes < safeMinSessionMinutes
    ) {
      const firstMinutes = Math.ceil(remainingMinutes / 20) * 10;
      blockMinutes.push(firstMinutes);
      blockMinutes.push(remainingMinutes - firstMinutes);
      remainingMinutes = 0;
      break;
    }

    const nextMinutes = Math.min(remainingMinutes, safeMaxSessionMinutes);
    blockMinutes.push(nextMinutes);
    remainingMinutes -= nextMinutes;
  }

  return blockMinutes;
}


function splitSessionMinutesForRetry(
  session: WeeklyPlanningSessionBlock,
  defaults: WeeklyPlanningDefaultConditions,
): number[] {
  const taskLike = {
    title: session.title,
    sourceText: session.sourceText,
  };
  const allowTinySession = session.allowTinySession;
  const minimumUsefulMinutes = Math.max(
    session.minimumUsefulSessionMinutes,
    resolveMinimumUsefulSessionMinutes({
      task: taskLike,
      allowTinySession,
      policyMinSessionMinutes: defaults.minStudyBlockMinutes,
    }),
  );

  for (let chunkCount = 2; chunkCount <= 5; chunkCount += 1) {
    const candidate = distributeMinutesAcrossBuckets(session.durationMinutes, chunkCount);

    if (
      candidate.every(
        (minutes) =>
          minutes >= minimumUsefulMinutes &&
          minutes < session.durationMinutes &&
          minutes <= defaults.maxSessionMinutes,
      )
    ) {
      return candidate;
    }
  }

  return [];
}

function isProgressiveRetrySplit(
  originalMinutes: number,
  retrySplitMinutes: number[],
): boolean {
  return (
    retrySplitMinutes.length > 1 &&
    retrySplitMinutes.reduce((sum, minutes) => sum + minutes, 0) === originalMinutes &&
    retrySplitMinutes.every(
      (minutes) => minutes > 0 && minutes < originalMinutes,
    )
  );
}

function withIncrementedRetryLevel(
  session: WeeklyPlanningSessionBlock,
  durationMinutes: number,
): WeeklyPlanningSessionBlock {
  return {
    ...session,
    durationMinutes,
    retryLevel: (session.retryLevel ?? 0) + 1,
  };
}

function calculatePreferredOverlapMinutes(
  defaults: WeeklyPlanningDefaultConditions,
  startMinutes: number,
  endMinutes: number,
): number {
  return defaults.preferredStudyRanges.reduce((total, range) => {
    const preferredStart = minutesFromTime(range.startTime);
    const preferredEnd = minutesFromTime(range.endTime);
    const overlapStart = Math.max(startMinutes, preferredStart);
    const overlapEnd = Math.min(endMinutes, preferredEnd);

    return total + Math.max(0, overlapEnd - overlapStart);
  }, 0);
}


function createStartMinuteCandidatesForSlot(params: {
  slot: AvailabilitySlot;
  durationMinutes: number;
  defaults: WeeklyPlanningDefaultConditions;
  adjacentStartMinutes?: number;
  subjectAnchorMinutes?: number;
}): number[] {
  const latestStartMinutes = params.slot.endMinutes - params.durationMinutes;
  const candidates = new Set<number>([params.slot.startMinutes]);

  if (
    params.adjacentStartMinutes !== undefined &&
    params.adjacentStartMinutes >= params.slot.startMinutes &&
    params.adjacentStartMinutes <= latestStartMinutes
  ) {
    candidates.add(params.adjacentStartMinutes);
  }

  if (params.subjectAnchorMinutes !== undefined) {
    [
      params.subjectAnchorMinutes,
      params.subjectAnchorMinutes - Math.floor(params.durationMinutes / 2),
      params.subjectAnchorMinutes - params.durationMinutes,
    ].forEach((candidate) => {
      const roundedCandidate = Math.round(candidate / 10) * 10;

      if (
        roundedCandidate >= params.slot.startMinutes &&
        roundedCandidate <= latestStartMinutes
      ) {
        candidates.add(roundedCandidate);
      }
    });
  }

  params.defaults.preferredStudyRanges.forEach((range) => {
    const preferredStart = minutesFromTime(range.startTime);
    const preferredEnd = minutesFromTime(range.endTime);
    const startAtPreferredStart = preferredStart;
    const startEndingAtPreferredEnd = preferredEnd - params.durationMinutes;
    const startCrossingPreferredStart =
      preferredStart - Math.floor(params.durationMinutes / 2);

    [
      startAtPreferredStart,
      startEndingAtPreferredEnd,
      startCrossingPreferredStart,
    ].forEach((candidate) => {
      const roundedCandidate = Math.round(candidate / 10) * 10;

      if (
        roundedCandidate >= params.slot.startMinutes &&
        roundedCandidate <= latestStartMinutes
      ) {
        candidates.add(roundedCandidate);
      }
    });
  });

  return Array.from(candidates).sort((left, right) => left - right);
}

function findPreviousBlockBefore(
  blocks: WeeklyPlanDraftBlock[],
  startMinutes: number,
): WeeklyPlanDraftBlock | undefined {
  return blocks
    .filter((block) => minutesFromTime(block.endTime) <= startMinutes)
    .sort(
      (left, right) =>
        minutesFromTime(right.endTime) - minutesFromTime(left.endTime),
    )[0];
}

function calculateSubjectAnchorBonus(params: {
  startMinutes: number;
  endMinutes: number;
  subjectAnchorMinutes?: number;
}): number {
  if (params.subjectAnchorMinutes === undefined) {
    return 0;
  }

  const midpoint = (params.startMinutes + params.endMinutes) / 2;
  const distance = Math.abs(midpoint - params.subjectAnchorMinutes);

  return Math.max(-90, 110 - distance / 2);
}

function isAdjacentToSameSubject(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  title: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
}): boolean {
  return params.dateBlocks.some((block) => {
    if (block.title !== params.title) {
      return false;
    }

    const blockStart = minutesFromTime(block.startTime);
    const blockEnd = minutesFromTime(block.endTime);

    return (
      Math.abs(blockEnd + params.breakMinutes - params.startMinutes) <= 5 ||
      Math.abs(params.endMinutes + params.breakMinutes - blockStart) <= 5
    );
  });
}

function calculateSameDaySequenceComponents(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  title: string;
  startMinutes: number;
  endMinutes: number;
}): Pick<
  PlacementScoreComponents,
  'sameDayFragmentationPenalty' | 'subjectSwitchPenalty'
> {
  const sequence = [
    ...params.dateBlocks.map((block) => ({
      title: block.title,
      startMinutes: minutesFromTime(block.startTime),
      endMinutes: minutesFromTime(block.endTime),
    })),
    {
      title: params.title,
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
    },
  ].sort((left, right) => left.startMinutes - right.startMinutes);
  const titles = sequence.map((block) => block.title);
  const uniqueTitleCount = new Set(titles).size;
  let switches = 0;
  const runsByTitle = new Map<string, number>();
  let previousTitle: string | undefined;

  titles.forEach((title) => {
    if (previousTitle !== undefined && previousTitle !== title) {
      switches += 1;
    }

    if (previousTitle !== title) {
      runsByTitle.set(title, (runsByTitle.get(title) ?? 0) + 1);
    }

    previousTitle = title;
  });

  const fragmentationCount = Array.from(runsByTitle.values()).reduce(
    (total, runs) => total + Math.max(0, runs - 1),
    0,
  );
  const naturalSwitches = Math.max(0, uniqueTitleCount - 1);
  const excessiveSwitches = Math.max(0, switches - naturalSwitches);

  return {
    sameDayFragmentationPenalty: -fragmentationCount * 140,
    subjectSwitchPenalty: -excessiveSwitches * 70,
  };
}

function calculateHeavyTaskLatePenalty(params: {
  session: WeeklyPlanningSessionBlock;
  startMinutes: number;
  endMinutes: number;
}): number {
  if (!isHeavyStudyTask(params.session)) {
    return 0;
  }

  const lateStartMinutes = 22 * 60;
  const lateMinutes = Math.max(0, params.endMinutes - Math.max(params.startMinutes, lateStartMinutes));

  return -lateMinutes * 3;
}

function calculateCompactnessPenalty(params: {
  dateBlocks: WeeklyPlanDraftBlock[];
  startMinutes: number;
  defaults: WeeklyPlanningDefaultConditions;
}): number {
  const previousBlock = findPreviousBlockBefore(params.dateBlocks, params.startMinutes);

  if (!previousBlock) {
    return 0;
  }

  const previousEndMinutes = minutesFromTime(previousBlock.endTime);
  const gapMinutes = params.startMinutes - previousEndMinutes;

  if (gapMinutes <= params.defaults.breakMinutes) {
    return 0;
  }

  if (intervalOverlapsUnavailableRange(params.defaults, previousEndMinutes, params.startMinutes)) {
    return 0;
  }

  return -(gapMinutes - params.defaults.breakMinutes) * 2;
}

function sumPlacementScoreComponents(components: PlacementScoreComponents): number {
  return (
    components.preferredWindowBonus +
    components.dailyLoadPenalty +
    components.sameTaskPenalty +
    components.subjectSpreadBonus +
    components.compactnessPenalty +
    components.explicitOverrideBonus +
    components.preferredDateBonus +
    components.fallbackPenalty +
    components.subjectAnchorBonus +
    components.sameDayFragmentationPenalty +
    components.subjectSwitchPenalty +
    components.heavyTaskLatePenalty
  );
}

function calculatePlacementScoreComponents(params: {
  session: WeeklyPlanningSessionBlock;
  date: string;
  startMinutes: number;
  endMinutes: number;
  blocksByDate: Map<string, WeeklyPlanDraftBlock[]>;
  dayLoads: Map<string, number>;
  defaults: WeeklyPlanningDefaultConditions;
  targetDailyMinutes: number;
  subjectAnchorMinutesByTitle: Map<string, number>;
}): PlacementScoreComponents {
  const dateBlocks = params.blocksByDate.get(params.date) ?? [];
  const sameTaskCount = dateBlocks.filter(
    (block) => block.title === params.session.title,
  ).length;
  const nextDayLoad = (params.dayLoads.get(params.date) ?? 0) + params.session.durationMinutes;
  const dailyLoadDistance = Math.abs(nextDayLoad - params.targetDailyMinutes);
  const preferredOverlapMinutes = calculatePreferredOverlapMinutes(
    params.defaults,
    params.startMinutes,
    params.endMinutes,
  );
  const isPreferredDate = params.session.preferredDate === params.date;
  const isExplicitOverride = Boolean(params.session.sessionIntentKind);
  const subjectAnchorMinutes = params.subjectAnchorMinutesByTitle.get(params.session.title);
  const isAdjacentSameSubject = isAdjacentToSameSubject({
    dateBlocks,
    title: params.session.title,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
    breakMinutes: params.defaults.breakMinutes,
  });
  const sequenceComponents = calculateSameDaySequenceComponents({
    dateBlocks,
    title: params.session.title,
    startMinutes: params.startMinutes,
    endMinutes: params.endMinutes,
  });

  return {
    preferredWindowBonus: preferredOverlapMinutes,
    dailyLoadPenalty: -dailyLoadDistance / 3,
    sameTaskPenalty: params.session.consolidationIntent
      ? 0
      : sameTaskCount === 0
        ? 0
        : isAdjacentSameSubject
          ? -10
          : -sameTaskCount * 65,
    subjectSpreadBonus: sameTaskCount === 0 ? 35 : isAdjacentSameSubject ? 20 : 0,
    compactnessPenalty: calculateCompactnessPenalty({
      dateBlocks,
      startMinutes: params.startMinutes,
      defaults: params.defaults,
    }),
    explicitOverrideBonus: isExplicitOverride ? 35 : 0,
    preferredDateBonus: isPreferredDate ? 220 : 0,
    fallbackPenalty: params.session.preferredDate && !isPreferredDate ? -120 : 0,
    subjectAnchorBonus: calculateSubjectAnchorBonus({
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
      subjectAnchorMinutes,
    }),
    sameDayFragmentationPenalty: sequenceComponents.sameDayFragmentationPenalty,
    subjectSwitchPenalty: sequenceComponents.subjectSwitchPenalty,
    heavyTaskLatePenalty: calculateHeavyTaskLatePenalty({
      session: params.session,
      startMinutes: params.startMinutes,
      endMinutes: params.endMinutes,
    }),
  };
}

function findBestSlot(params: {
  session: WeeklyPlanningSessionBlock;
  availableSlots: AvailabilitySlot[];
  blocksByDate: Map<string, WeeklyPlanDraftBlock[]>;
  dayLoads: Map<string, number>;
  defaults: WeeklyPlanningDefaultConditions;
  targetDailyMinutes: number;
  preferEarlierDates: boolean;
  preferredStartAfterMinutesByDate: Map<string, number>;
  subjectAnchorMinutesByTitle: Map<string, number>;
}): {
  slotIndex: number;
  startMinutes: number;
  score: number;
  components: PlacementScoreComponents;
  rejectedCandidates: SessionPlacementEvaluation['rejectedCandidates'];
} | null {
  const scoredCandidates = params.availableSlots
    .flatMap((slot, index) => {
      if (slot.endMinutes - slot.startMinutes < params.session.durationMinutes) {
        return [];
      }

      const adjacentStartMinutes = params.preferredStartAfterMinutesByDate.get(slot.date);

      return createStartMinuteCandidatesForSlot({
        slot,
        durationMinutes: params.session.durationMinutes,
        defaults: params.defaults,
        adjacentStartMinutes,
        subjectAnchorMinutes: params.subjectAnchorMinutesByTitle.get(params.session.title),
      }).map((startMinutes) => {
        const endMinutes = startMinutes + params.session.durationMinutes;
        const components = calculatePlacementScoreComponents({
          session: params.session,
          date: slot.date,
          startMinutes,
          endMinutes,
          blocksByDate: params.blocksByDate,
          dayLoads: params.dayLoads,
          defaults: params.defaults,
          targetDailyMinutes: params.targetDailyMinutes,
          subjectAnchorMinutesByTitle: params.subjectAnchorMinutesByTitle,
        });
        const score = sumPlacementScoreComponents(components);

        return {
          index,
          slot,
          startMinutes,
          endMinutes,
          components,
          score,
        };
      });
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (params.preferEarlierDates) {
        const dateDelta = left.slot.date.localeCompare(right.slot.date);

        if (dateDelta !== 0) {
          return dateDelta;
        }
      }

      const preferredDateDelta =
        (right.slot.date === params.session.preferredDate ? 1 : 0) -
        (left.slot.date === params.session.preferredDate ? 1 : 0);

      if (preferredDateDelta !== 0) {
        return preferredDateDelta;
      }

      const loadDelta =
        (params.dayLoads.get(left.slot.date) ?? 0) -
        (params.dayLoads.get(right.slot.date) ?? 0);

      if (loadDelta !== 0) {
        return loadDelta;
      }

      const dateDelta = left.slot.date.localeCompare(right.slot.date);

      if (dateDelta !== 0) {
        return dateDelta;
      }

      return left.startMinutes - right.startMinutes;
    });

  const selectedCandidate = scoredCandidates[0];

  if (!selectedCandidate) {
    return null;
  }

  return {
    slotIndex: selectedCandidate.index,
    startMinutes: selectedCandidate.startMinutes,
    score: selectedCandidate.score,
    components: selectedCandidate.components,
    rejectedCandidates: scoredCandidates.slice(1, 6).map((candidate) => ({
      date: candidate.slot.date,
      startMinutes: candidate.startMinutes,
      endMinutes: candidate.endMinutes,
      score: candidate.score,
      components: candidate.components,
      reason: candidate.score < selectedCandidate.score
        ? 'lower_score'
        : 'tie_breaker',
    })),
  };
}

export function looksLikeWeeklyPlanningRequest(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text);
  const durationMentions = normalizedText.match(/\d+(?:\.\d+)?\s*時間/g) ?? [];

  return /今週|来週|週間|週/.test(normalizedText) && durationMentions.length >= 2;
}

export function distributeWeeklyDraftBlocks(params: {
  blocks: WeeklyPlanDraftBlock[];
  startDate: string;
  dayCount?: number;
}): WeeklyPlanDraftBlock[] {
  if (params.blocks.length === 0) {
    return [];
  }

  const dayCount = Math.max(1, Math.floor(params.dayCount ?? 6));
  const groupedBlocks = new Map<string, WeeklyPlanDraftBlock[]>();
  const groupKeys: string[] = [];

  params.blocks.forEach((block) => {
    const key = resolveDistributionKey(block);
    const group = groupedBlocks.get(key);

    if (group) {
      group.push(block);
      return;
    }

    groupedBlocks.set(key, [block]);
    groupKeys.push(key);
  });

  const roundRobinBlocks: WeeklyPlanDraftBlock[] = [];
  let hasRemainingBlocks = true;

  while (hasRemainingBlocks) {
    hasRemainingBlocks = false;

    groupKeys.forEach((key) => {
      const group = groupedBlocks.get(key);
      const block = group?.shift();

      if (!block) {
        return;
      }

      roundRobinBlocks.push(block);
      hasRemainingBlocks = true;
    });
  }

  const dayBuckets = Array.from({ length: dayCount }, (_, index) => ({
    date: addDays(params.startDate, index),
    blocks: [] as WeeklyPlanDraftBlock[],
    keys: new Set<string>(),
    totalMinutes: 0,
  }));

  roundRobinBlocks.forEach((block) => {
    const key = resolveDistributionKey(block);
    const durationMinutes = getDraftBlockDurationMinutes(block);
    const bucketsWithoutSameKey = dayBuckets.filter(
      (bucket) => !bucket.keys.has(key),
    );
    const candidateBuckets =
      bucketsWithoutSameKey.length > 0 ? bucketsWithoutSameKey : dayBuckets;
    const selectedBucket = candidateBuckets
      .slice()
      .sort((left, right) => {
        const totalMinutesDelta = left.totalMinutes - right.totalMinutes;

        if (totalMinutesDelta !== 0) {
          return totalMinutesDelta;
        }

        return left.blocks.length - right.blocks.length;
      })[0];

    selectedBucket.blocks.push({
      ...block,
      date: selectedBucket.date,
    });
    selectedBucket.keys.add(key);
    selectedBucket.totalMinutes += durationMinutes;
  });
  const distributedBlocks = dayBuckets.flatMap((bucket) => bucket.blocks);
  const blocksByDate = new Map<string, WeeklyPlanDraftBlock[]>();

  distributedBlocks.forEach((block) => {
    const blocksForDate = blocksByDate.get(block.date);

    if (blocksForDate) {
      blocksForDate.push(block);
      return;
    }

    blocksByDate.set(block.date, [block]);
  });

  return distributedBlocks
    .map((block, originalIndex) => {
      const blocksForDate = blocksByDate.get(block.date) ?? [];
      const blockIndexInDate = blocksForDate.indexOf(block);
      const totalMinutesForDate = blocksForDate.reduce(
        (sum, dateBlock) => sum + getDraftBlockDurationMinutes(dateBlock),
        0,
      );
      const dateStartMinutes = Math.min(
        minutesFromTime(SIMPLE_DRAFT_START_TIME),
        Math.max(0, SIMPLE_DRAFT_DAY_END_MINUTES - totalMinutesForDate),
      );
      const minutesBeforeBlock = blocksForDate
        .slice(0, blockIndexInDate)
        .reduce(
          (sum, dateBlock) => sum + getDraftBlockDurationMinutes(dateBlock),
          0,
        );
      const durationMinutes = getDraftBlockDurationMinutes(block);
      const startMinutes = dateStartMinutes + minutesBeforeBlock;
      const endMinutes = startMinutes + durationMinutes;

      return {
        block: {
          ...block,
          startTime: timeFromMinutes(startMinutes),
          endTime: timeFromMinutes(endMinutes),
        },
        originalIndex,
      };
    })
    .sort((left, right) => {
      const dateOrder = left.block.date.localeCompare(right.block.date);

      if (dateOrder !== 0) {
        return dateOrder;
      }

      const startTimeOrder =
        minutesFromTime(left.block.startTime) - minutesFromTime(right.block.startTime);

      if (startTimeOrder !== 0) {
        return startTimeOrder;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ block }) => block);
}

export function createAvailabilityAwareWeeklyDraftBlocksFromText(params: {
  userId: string;
  selectedDate: string;
  text: string;
  existingPlans?: Plan[];
  allowPartialPlacement?: boolean;
  pendingConfig?: WeeklyPlanningPendingConfig;
}): AvailabilityAwareWeeklyDraftResult {
  const assessment: WeeklyPlanningRequestAssessment = params.pendingConfig
    ? {
        kind: 'ready',
        tasks: params.pendingConfig.tasks,
        defaults: cloneWeeklyPlanningDefaults(params.pendingConfig.defaults),
        questions: [],
        confirmationSummary: summarizeWeeklyPlanningPendingConfig(
          params.pendingConfig,
        ),
      }
    : assessWeeklyPlanningRequest({
        selectedDate: params.selectedDate,
        text: params.text,
        hasPendingConfirmation: true,
        confirmationText: 'この条件で作成',
      });
  const allowPartialPlacement =
    params.allowPartialPlacement ?? params.pendingConfig?.allowPartialPlacement ?? false;

  if (
    assessment.tasks.length === 0 ||
    assessment.kind === 'needs_time_estimate' ||
    assessment.tasks.some((task) => task.requiresTimeEstimate)
  ) {
    return {
      blocks: [],
      placedMinutes: 0,
      unplacedMinutes: 0,
      warnings: [...assessment.questions, assessment.confirmationSummary].filter(Boolean),
      defaults: assessment.defaults,
    };
  }

  const timestamp = nowIso();
  const slots = buildAvailabilitySlots({
    defaults: assessment.defaults,
    existingPlans: params.existingPlans ?? [],
  }).sort((left, right) => {
    const dateOrder = left.date.localeCompare(right.date);

    if (dateOrder !== 0) {
      return dateOrder;
    }

    return left.startMinutes - right.startMinutes;
  });
  const initialSlots = slots.map((slot) => ({ ...slot }));
  const requestedMinutes = assessment.tasks.reduce(
    (sum, task) => sum + task.durationMinutes,
    0,
  );
  const sessionQueue = buildWeeklyPlanningSessionBlocks(
    assessment.tasks,
    assessment.defaults,
    params.pendingConfig?.sessionIntentOverrides ??
      inferSessionIntentOverridesFromText({
        text: params.text,
        tasks: assessment.tasks,
      }),
  );
  const subjectAnchorMinutesByTitle = buildSubjectAnchorMinutes(
    assessment.tasks,
    assessment.defaults,
  );
  const dayLoads = new Map<string, number>();
  const datePreferredStartAfterMinutes = new Map<string, number>();
  const blocks: WeeklyPlanDraftBlock[] = [];
  const blocksByDate = new Map<string, WeeklyPlanDraftBlock[]>();
  const sessionEvaluations: SessionPlacementEvaluation[] = [];
  const fallbackPlacements: NonNullable<WeeklyPlacementDiagnostics['fallbackPlacements']> = [];
  const retryEvents: NonNullable<WeeklyPlacementDiagnostics['retryEvents']> = [];
  const tinyChunkViolations: NonNullable<WeeklyPlacementDiagnostics['tinyChunkViolations']> = [];
  const targetDailyMinutes = requestedMinutes / Math.max(1, assessment.defaults.dayCount);
  let unplacedMinutes = 0;
  let retryLimitReached = false;
  let processedSessions = 0;
  const maxPlacementAttempts = Math.max(200, sessionQueue.length * 20);
  const sessionAttemptCounts = new Map<string, number>();

  while (sessionQueue.length > 0) {
    const session = sessionQueue.shift();

    if (!session) {
      break;
    }

    processedSessions += 1;
    const retryLevel = session.retryLevel ?? 0;
    const attemptKey = `${session.title}|${session.durationMinutes}|${retryLevel}`;
    const attemptCount = (sessionAttemptCounts.get(attemptKey) ?? 0) + 1;
    sessionAttemptCounts.set(attemptKey, attemptCount);

    if (
      processedSessions > maxPlacementAttempts ||
      attemptCount > Math.max(20, sessionQueue.length + blocks.length + 1)
    ) {
      retryLimitReached = true;
      unplacedMinutes += session.durationMinutes;
      continue;
    }

    if (sessionQueue.length > maxPlacementAttempts) {
      retryLimitReached = true;
      unplacedMinutes += session.durationMinutes + sessionQueue.reduce(
        (sum, queuedSession) => sum + queuedSession.durationMinutes,
        0,
      );
      sessionQueue.length = 0;
      break;
    }

    if ((params.existingPlans?.length ?? 0) > 0 && session.durationMinutes > 90) {
      const retrySplitMinutes = splitSessionMinutesForRetry(
        session,
        assessment.defaults,
      );

      if (isProgressiveRetrySplit(session.durationMinutes, retrySplitMinutes)) {
        retryEvents.push({
          title: session.title,
          originalDurationMinutes: session.durationMinutes,
          retriedDurations: retrySplitMinutes,
          reason: 'existing_plan_large_session_pre_split',
        });
        const [nextMinutes, ...laterMinutes] = retrySplitMinutes;

        sessionQueue.unshift(withIncrementedRetryLevel(session, nextMinutes));
        sessionQueue.push(
          ...laterMinutes.map((durationMinutes) =>
            withIncrementedRetryLevel(session, durationMinutes),
          ),
        );
        continue;
      }
    }

    const placement = findBestSlot({
      session,
      availableSlots: slots,
      blocksByDate,
      dayLoads,
      defaults: assessment.defaults,
      targetDailyMinutes,
      preferEarlierDates:
        session.priority === 'high' || Boolean(session.deadlineDate),
      preferredStartAfterMinutesByDate: datePreferredStartAfterMinutes,
      subjectAnchorMinutesByTitle,
    });

    if (!placement) {
      const retrySplitMinutes = splitSessionMinutesForRetry(
        session,
        assessment.defaults,
      );

      if (isProgressiveRetrySplit(session.durationMinutes, retrySplitMinutes)) {
        retryEvents.push({
          title: session.title,
          originalDurationMinutes: session.durationMinutes,
          retriedDurations: retrySplitMinutes,
          reason: 'no_candidate_slot_rechunk',
        });
        sessionQueue.unshift(
          ...retrySplitMinutes.map((durationMinutes) =>
            withIncrementedRetryLevel(session, durationMinutes),
          ),
        );
        continue;
      }



      unplacedMinutes += session.durationMinutes;
      continue;
    }

    const slot = slots[placement.slotIndex];
    const startMinutes = placement.startMinutes;
    const endMinutes = startMinutes + session.durationMinutes;

    const placedBlock: WeeklyPlanDraftBlock = {
      id: createId('weekly-draft'),
      userId: params.userId,
      date: slot.date,
      startTime: timeFromMinutes(startMinutes),
      endTime: timeFromMinutes(endMinutes),
      title: session.title,
      subject: session.title,
      type: session.type,
      label: session.title,
      materialId: null,
      materialName: '',
      memo: [
        `元タスク: ${session.title}`,
        session.splitCount > 1
          ? `元見積もり: ${session.sourceTaskMinutes}分`
          : `見積もり: ${session.sourceTaskMinutes}分`,
        session.splitCount > 1
          ? `分割 ${session.splitIndex + 1}/${session.splitCount}`
          : '',
        `優先度: ${session.priority === 'high' ? '高' : '通常'}`,
        session.deadlineDate ? `締切: ${session.deadlineDate}` : '',
        `対象週: ${assessment.defaults.startDate}〜${assessment.defaults.reserveDate}`,
        `予備日: ${assessment.defaults.reserveDate}`,
        `配置済み: ${session.durationMinutes}分`,
        '既存予定・睡眠・バッファ考慮',
      ]
        .filter(Boolean)
        .join(' / '),
      source: 'ai',
      status: 'draft',
      userEdited: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    blocks.push(placedBlock);
    blocksByDate.set(slot.date, [
      ...(blocksByDate.get(slot.date) ?? []),
      placedBlock,
    ]);
    sessionEvaluations.push({
      title: session.title,
      durationMinutes: session.durationMinutes,
      preferredDate: session.preferredDate,
      selected: {
        date: slot.date,
        startMinutes,
        endMinutes,
        score: placement.score,
        components: placement.components,
      },
      rejectedCandidates: placement.rejectedCandidates,
    });

    if (session.preferredDate && session.preferredDate !== slot.date) {
      fallbackPlacements.push({
        title: session.title,
        durationMinutes: session.durationMinutes,
        preferredDate: session.preferredDate,
        actualDate: slot.date,
        reason: 'preferred_date_lower_scored_or_unavailable',
      });
    }

    const minimumUsefulMinutes = session.minimumUsefulSessionMinutes;

    if (session.durationMinutes < minimumUsefulMinutes) {
      tinyChunkViolations.push({
        title: session.title,
        durationMinutes: session.durationMinutes,
        allowed: session.allowTinySession,
        reason: 'below_minimum_useful_session_minutes',
      });
    }


    dayLoads.set(
      slot.date,
      (dayLoads.get(slot.date) ?? 0) + session.durationMinutes,
    );
    datePreferredStartAfterMinutes.set(
      slot.date,
      endMinutes + assessment.defaults.breakMinutes,
    );

    const nextSlots: AvailabilitySlot[] = [];
    const afterBreakStartMinutes = endMinutes + assessment.defaults.breakMinutes;

    const beforeBreakEndMinutes = startMinutes - assessment.defaults.breakMinutes;

    if (
      beforeBreakEndMinutes - slot.startMinutes >=
      assessment.defaults.minStudyBlockMinutes
    ) {
      nextSlots.push({
        ...slot,
        endMinutes: beforeBreakEndMinutes,
      });
    }

    if (
      slot.endMinutes - afterBreakStartMinutes >=
      assessment.defaults.minStudyBlockMinutes
    ) {
      nextSlots.push({
        ...slot,
        startMinutes: afterBreakStartMinutes,
      });
    }

    slots.splice(placement.slotIndex, 1, ...nextSlots);
  }

  const placedMinutes = blocks.reduce(
    (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
    0,
  );
  const diagnostics = calculateWeeklyPlacementDiagnostics({
    defaults: assessment.defaults,
    existingPlans: params.existingPlans ?? [],
    requestedMinutes,
    placedMinutes,
    unplacedMinutes,
    blocks,
    initialSlots,
    remainingSlots: slots,
    retryLimitReached,
    tasks: assessment.tasks,
    sessionEvaluations,
    fallbackPlacements,
    retryEvents,
    tinyChunkViolations,
  });
  const warnings =
    unplacedMinutes > 0
      ? diagnostics.failureReason === 'placement_retry_limit'
        ? [
            `\u914d\u7f6e\u5019\u88dc\u306e\u518d\u8a66\u884c\u4e0a\u9650\u306b\u9054\u3057\u305f\u305f\u3081\u3001${unplacedMinutes}\u5206\u3092\u672a\u914d\u7f6e\u306b\u3057\u307e\u3057\u305f\u3002\u914d\u7f6e\u6e08\u307f\u306f${placedMinutes}\u5206\u3001\u5fc5\u8981\u6642\u9593\u306f${diagnostics.requestedMinutes}\u5206\u3067\u3059\u3002`,
          ]
        : diagnostics.failureReason === 'existing_plan_conflict'
          ? [
            `既存予定とその前後${assessment.defaults.bufferMinutes}分を避けたため、${unplacedMinutes}分を配置できませんでした。既存予定で塞がれた時間は${diagnostics.existingPlanBlockedMinutes}分です。`,
          ]
        : diagnostics.failureReason === 'capacity_shortage'
          ? [
              `この条件では配置可能時間が不足しています。配置可能時間は${diagnostics.totalAvailableCapacity}分、必要時間は${diagnostics.requestedMinutes}分です。`,
            ]
          : diagnostics.unusedAvailableMinutes > 0
            ? [
                `空き時間は残っていますが、現在の配置ルールでは${unplacedMinutes}分を置けませんでした。未使用の配置可能時間は${diagnostics.unusedAvailableMinutes}分です。`,
              ]
            : [
                `配置可能な空き枠を使い切りましたが、${unplacedMinutes}分を置けませんでした。配置済みは${placedMinutes}分、必要時間は${diagnostics.requestedMinutes}分です。`,
              ]
      : [];

  if (unplacedMinutes > 0 && !allowPartialPlacement) {
    return {
      blocks: [],
      placedMinutes,
      unplacedMinutes: placedMinutes + unplacedMinutes,
      warnings: [
        ...warnings,
        diagnostics.failureReason === 'capacity_shortage' ||
        diagnostics.failureReason === 'existing_plan_conflict' ||
        diagnostics.failureReason === 'placement_retry_limit'
          ? '期間を延ばす / 夜も使う / 既存予定の少ない日にずらす / 「配置できる分だけでいい」と返信してください。'
          : '配置順や分割方法を変えて再配置します。必要なら「配置できる分だけでいい」と返信してください。',
      ],
      defaults: assessment.defaults,
      diagnostics,
    };
  }

  return {
    blocks: blocks.sort((left, right) => {
      const dateOrder = left.date.localeCompare(right.date);

      if (dateOrder !== 0) {
        return dateOrder;
      }

      return minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
    }),
    placedMinutes,
    unplacedMinutes,
    warnings,
    defaults: assessment.defaults,
    diagnostics,
  };
}

export function createSimpleWeeklyDraftBlocksFromText(params: {
  userId: string;
  selectedDate: string;
  text: string;
}): WeeklyPlanDraftBlock[] {
  const trimmedText = params.text.trim();

  if (!trimmedText) {
    return [];
  }

  const taskTexts = splitAddTaskTexts(trimmedText);
  const baseDate = /来週/.test(trimmedText)
    ? addDays(params.selectedDate, 7)
    : params.selectedDate;
  const timestamp = nowIso();
  const blocks: WeeklyPlanDraftBlock[] = [];

  taskTexts.forEach((taskText) => {
    const durationMinutes = parseDurationMinutes(taskText);

    if (!durationMinutes) {
      return;
    }

    const title = resolveSimpleTaskTitle(taskText);
    const splitMinutes = splitDurationIntoDraftBlockMinutes(durationMinutes);

    splitMinutes.forEach((blockMinutes, splitIndex) => {
      blocks.push({
        id: createId('weekly-draft'),
        userId: params.userId,
        date: addDays(baseDate, blocks.length),
        startTime: SIMPLE_DRAFT_START_TIME,
        endTime: buildSimpleDraftEndTime(blockMinutes),
        title,
        subject: title,
        type: detectType(taskText),
        label: title,
        materialId: null,
        materialName: '',
        memo:
          splitMinutes.length > 1
            ? `元見積もり: ${durationMinutes}分 / 分割 ${splitIndex + 1}/${splitMinutes.length} / 簡易生成`
            : `見積もり: ${durationMinutes}分 / 簡易生成`,
        source: 'ai',
        status: 'draft',
        userEdited: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });

  return distributeWeeklyDraftBlocks({
    blocks,
    startDate: baseDate,
    dayCount: 6,
  });
}

export function createWeeklyDraftBlockFromPlanDraft(
  draft: PlanDraft,
): WeeklyPlanDraftBlock {
  const timestamp = nowIso();
  const label = resolveDraftLabel(draft);

  return {
    id: createId('weekly-draft'),
    userId: draft.userId,
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    title: draft.title.trim() || label,
    subject: draft.subject.trim() || label,
    type: draft.type,
    label,
    materialId: draft.materialId ?? null,
    materialName: draft.materialName?.trim() ?? '',
    memo: draft.memo.trim(),
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createFallbackWeeklyDraftBlock(params: {
  userId: string;
  selectedDate: string;
  text: string;
}): WeeklyPlanDraftBlock {
  const title = params.text.trim() || '学習予定';
  const timestamp = nowIso();

  return {
    id: createId('weekly-draft'),
    userId: params.userId,
    date: params.selectedDate,
    startTime: '19:00',
    endTime: '20:00',
    title,
    subject: '学習',
    type: 'study',
    label: '学習',
    materialId: null,
    materialName: '',
    memo: '週間計画MVPで仮作成',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createSampleWeeklyDraftBlocks(params: {
  userId: string;
  selectedDate: string;
}): WeeklyPlanDraftBlock[] {
  const weekStartDate = startOfWeek(params.selectedDate);
  return [
    {
      ...createFallbackWeeklyDraftBlock({
        userId: params.userId,
        selectedDate: weekStartDate,
        text: '計算理論の復習',
      }),
      startTime: '20:00',
      endTime: '21:00',
      subject: '計算理論',
      label: '計算理論',
    },
    {
      ...createFallbackWeeklyDraftBlock({
        userId: params.userId,
        selectedDate: addDays(weekStartDate, 2),
        text: '英語課題',
      }),
      startTime: '19:00',
      endTime: '20:00',
      subject: '英語',
      label: '英語',
    },
  ];
}

export function createPlanDraftFromWeeklyDraftBlock(
  block: WeeklyPlanDraftBlock,
  userId: string,
): PlanDraft {
  const label = resolveBlockLabel(block);

  return {
    userId,
    title: block.title.trim() || label,
    subject: block.subject.trim() || label,
    date: block.date,
    startTime: block.startTime,
    endTime: block.endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: block.type,
    memo: block.memo?.trim() ?? '',
    sourceType: 'manual',
    sourceId: null,
    materialId: block.materialId ?? null,
    materialName: block.materialName?.trim() ?? '',
  };
}
