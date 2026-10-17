import { createId } from '../../lib/id';
import { addDays, minutesFromTime, timeFromMinutes } from '../../lib/date';

import {
  detectType,
  parseDurationMinutes,
  splitAddTaskTexts,
} from '../../services/naturalLanguageRules';
import type { PlanDraft } from '../../types/domain';
import type { WeeklyPlanDraftBlock } from './types';
import { normalizeWeeklyPlanningText } from './parsing/weeklyPlanningText';
import { resolveSimpleTaskTitle } from './parsing/weeklyTitleCleanup';
export { resolveSimpleTaskTitle, stripWeeklyPlanningTaskTitle } from './parsing/weeklyTitleCleanup';
import { extractSimpleWeeklyPlanningTasks } from './parsing/weeklyTaskExtraction';
export { extractSimpleWeeklyPlanningTasks } from './parsing/weeklyTaskExtraction';
export { looksLikeWeeklyPlanningRequest } from './parsing/weeklyPlanningText';
import { inferSessionIntentOverridesFromText } from './parsing/weeklyConditionParser';
export { parseWeeklyPlanningConditionOperations } from './parsing/weeklyConditionParser';
export {
  applyWeeklyPlanningConditionOverride,
  WEEKLY_PLANNING_CONDITION_OVERRIDE_HELP,
} from './config/weeklyPendingConfigUpdater';

export {
  clampProfileScore,
  inferStudyTaskProfile,
  normalizeTaskProfileText,
} from './profiling/studyTaskProfile';

export {
  createDefaultUserPlanningProfile,
  derivePersonalizedSessionPolicy,
  deriveSessionLengthPolicy,
  mergeSessionLengthPolicyOverride,
  mergeUserPolicyWithExplicitOverride,
  updateUserPlanningProfileFromFeedback,
} from './profiling/sessionPolicy';

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
  SimpleWeeklyTask,
  WeeklyPlanningDefaultConditions,
  WeeklyPlanningPendingConfig,
  WeeklyPlanningRequestAssessment,
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
  WeeklyPlanningTimetableConstraints,
} from './weeklyPlanningTypes';
function nowIso(): string {
  return new Date().toISOString();
}

function resolveDraftLabel(draft: PlanDraft): string {
  return (
    draft.materialName?.trim() ||
    draft.subject.trim() ||
    draft.title.trim() ||
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

function formatStudyRanges(
  ranges: WeeklyPlanningDefaultConditions['preferredStudyRanges'],
): string {
  return ranges.map((range) => `${range.startTime}-${range.endTime}`).join('、');
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
