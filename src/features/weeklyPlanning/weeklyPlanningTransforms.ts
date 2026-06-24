import { createId } from '../../lib/id';
import { addDays, minutesFromTime, startOfWeek, timeFromMinutes } from '../../lib/date';
import {
  detectType,
  parseDurationMinutes,
  splitAddTaskTexts,
} from '../../services/naturalLanguageRules';
import type { Plan, PlanDraft } from '../../types/domain';
import type { WeeklyPlanDraftBlock } from './types';
import {
  normalizeConditionText,
  normalizeWeeklyPlanningText,
  parseJapaneseSmallInteger,
} from './parsing/weeklyPlanningText';
import { resolveSimpleTaskTitle } from './parsing/weeklyTitleCleanup';
export { resolveSimpleTaskTitle, stripWeeklyPlanningTaskTitle } from './parsing/weeklyTitleCleanup';
import { extractSimpleWeeklyPlanningTasks } from './parsing/weeklyTaskExtraction';
export { extractSimpleWeeklyPlanningTasks } from './parsing/weeklyTaskExtraction';
import {
  classifyQualityPreferenceOperations,
  getQualityPreferenceMessage,
  hasQualityAvoidanceCue,
  mergeWeeklyPlanningQualityPreferences,
} from './parsing/weeklyQualityPreferenceParser';
export { looksLikeWeeklyPlanningRequest } from './parsing/weeklyPlanningText';
import {
  allowsTinySessionForTask,
  inferStudyTaskProfile,
  isHeavyStudyTask,
  resolveMinimumUsefulSessionMinutes,
} from './profiling/studyTaskProfile';
export {
  clampProfileScore,
  inferStudyTaskProfile,
  normalizeTaskProfileText,
} from './profiling/studyTaskProfile';
import {
  derivePersonalizedSessionPolicy,
  deriveSessionLengthPolicy,
} from './profiling/sessionPolicy';
export {
  createDefaultUserPlanningProfile,
  derivePersonalizedSessionPolicy,
  deriveSessionLengthPolicy,
  mergeSessionLengthPolicyOverride,
  mergeUserPolicyWithExplicitOverride,
  updateUserPlanningProfileFromFeedback,
} from './profiling/sessionPolicy';
import {
  buildSubjectAnchorMinutes,
  distributeMinutesAcrossBuckets,
  resolveTaskSpreadDateIndexes,
  resolveTaskSpreadDayCount,
} from './scheduling/dailyDistribution';
import {
  buildAvailabilitySlots,
  intersectInterval,
  sumIntervals,
  sumSlotMinutes,
} from './scheduling/availabilitySlots';
import { splitDurationIntoSessionChunks } from './scheduling/sessionChunking';
import {
  calculatePlacementScoreComponents,
  calculatePreferredOverlapMinutes,
  comparePlacementRank,
  createPlacementRank,
  createStartMinuteCandidatesForSlot,
  intervalOverlapsUnavailableRange,
  makeDateTitleKey,
  sumPlacementScoreComponents,
} from './scheduling/placementScoring';
export {
  createSessionChunkCandidates,
  normalizeSessionChunkMinutes,
  scoreSessionChunkPlan,
  splitDurationIntoDraftBlockMinutesWithMax,
  splitDurationIntoSessionChunks,
} from './scheduling/sessionChunking';

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

import type {
  AvailabilityAwareWeeklyDraftResult,
  AvailabilitySlot,
  PlacementScoreComponents,
  SessionIntentOverride,
  SessionIntentScope,
  SessionLengthPolicy,
  SessionLengthPolicyOverride,
  SessionPlacementEvaluation,
  SimpleWeeklyTask,
  StudyTaskProfile,
  WeeklyConditionOperation,
  WeeklyPlacementDiagnostics,
  WeeklyPlacementQualityDiagnostics,
  WeeklyPlanningConditionOverrideResult,
  WeeklyPlanningDefaultConditions,
  WeeklyPlanningPendingConfig,
  WeeklyPlanningQualityPreference,
  WeeklyPlanningRequestAssessment,
  WeeklyPlanningSessionBlock,
} from './weeklyPlanningTypes';
export type {
  AvailabilityAwareWeeklyDraftResult,
  AvailabilitySlot,
  PersonalizedSessionPolicy,
  PersonalizedSessionPolicyInput,
  PlacementScoreComponents,
  SessionChunkPlan,
  SessionIntentKind,
  SessionIntentOverride,
  SessionIntentScope,
  SessionLengthPolicy,
  SessionLengthPolicyMode,
  SessionLengthPolicyOptions,
  SessionLengthPolicyOverride,
  SessionPlacementEvaluation,
  SimpleWeeklyTask,
  StudyTaskProfile,
  StudyTaskProfileInput,
  StudyTaskProfileScore,
  TimeInterval,
  UserPlanningProfile,
  UserTaskPreferenceProfile,
  WeeklyConditionOperation,
  WeeklyPlacementDiagnostics,
  WeeklyPlacementQualityDiagnostics,
  WeeklyPlanningConditionOverrideResult,
  WeeklyPlanningDefaultConditions,
  WeeklyPlanningFeedbackSignal,
  WeeklyPlanningPendingConfig,
  WeeklyPlanningQualityPreference,
  WeeklyPlanningRequestAssessment,
  WeeklyPlanningSessionBlock,
} from './weeklyPlanningTypes';
export const WEEKLY_PLANNING_CONDITION_OVERRIDE_HELP =
  '対応できる条件変更例: 「7日間で」「勉強開始9時から」「22時までで」「9時から22時で」「お昼は13〜14時」「1回90分で」「休憩15分で」「睡眠は2時から9時」「配置できる分だけでいい」。';

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
  qualityPreferences?: WeeklyPlanningQualityPreference[];
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
    qualityPreferences: params.qualityPreferences,
    failureReason,
  };
}


function hasTaskConsolidationIntent(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text);

  return /\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u7247\u3065\u3051|\u7247\u4ed8\u3051|\u5148\u306b|\u4eca\u65e5\u4e2d|\u512a\u5148|\u9577\u3081|(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(
    normalizedText,
  );
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

function findBestSlot(params: {
  session: WeeklyPlanningSessionBlock;
  availableSlots: AvailabilitySlot[];
  blocksByDate: Map<string, WeeklyPlanDraftBlock[]>;
  dayLoads: Map<string, number>;
  defaults: WeeklyPlanningDefaultConditions;
  targetDailyMinutes: number;
  preferEarlierDates: boolean;
  preferredStartAfterMinutesByDate: Map<string, number>;
  preferredStartAfterMinutesByDateAndTitle: Map<string, number>;
  subjectAnchorMinutesByTitle: Map<string, number>;
  qualityPreferences?: WeeklyPlanningQualityPreference[];
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

      const dateBlocks = params.blocksByDate.get(slot.date) ?? [];
      const adjacentStartMinutes =
        params.preferredStartAfterMinutesByDateAndTitle.get(
          makeDateTitleKey(slot.date, params.session.title),
        ) ?? params.preferredStartAfterMinutesByDate.get(slot.date);

      return createStartMinuteCandidatesForSlot({
        slot,
        durationMinutes: params.session.durationMinutes,
        defaults: params.defaults,
        adjacentStartMinutes,
        subjectAnchorMinutes: params.subjectAnchorMinutesByTitle.get(params.session.title),
        dateBlocks,
        title: params.session.title,
        subject: params.session.title,
        label: params.session.title,
        breakMinutes: params.defaults.breakMinutes,
        minStudyBlockMinutes: params.defaults.minStudyBlockMinutes,
        fallbackStepMinutes: 15,
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
        const rank = createPlacementRank({
          session: params.session,
          date: slot.date,
          startMinutes,
          endMinutes,
          components,
          blocksByDate: params.blocksByDate,
          dayLoads: params.dayLoads,
          defaults: params.defaults,
          targetDailyMinutes: params.targetDailyMinutes,
          qualityPreferences: params.qualityPreferences,
        });

        return {
          index,
          slot,
          startMinutes,
          endMinutes,
          components,
          score,
          rank,
        };
      });
    })
    .sort((left, right) => {
      const rankOrder = comparePlacementRank(left.rank, right.rank);

      if (rankOrder !== 0) {
        return rankOrder;
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
  const dateTitlePreferredStartAfterMinutes = new Map<string, number>();
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
      preferredStartAfterMinutesByDateAndTitle: dateTitlePreferredStartAfterMinutes,
      subjectAnchorMinutesByTitle,
      qualityPreferences: params.pendingConfig?.qualityPreferences ?? [],
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
    dateTitlePreferredStartAfterMinutes.set(
      makeDateTitleKey(slot.date, session.title),
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
    qualityPreferences: params.pendingConfig?.qualityPreferences ?? [],
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
