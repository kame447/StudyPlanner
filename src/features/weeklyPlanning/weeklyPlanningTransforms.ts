import { createId } from '../../lib/id';
import { addDays, minutesFromTime, startOfWeek, timeFromMinutes } from '../../lib/date';
import {
  detectType,
  parseDurationMinutes,
  sanitizeSuggestedTitle,
  splitAddTaskTexts,
} from '../../services/naturalLanguageRules';
import type { PlanDraft } from '../../types/domain';
import type { WeeklyPlanDraftBlock } from './types';

const SIMPLE_DRAFT_START_TIME = '19:00';
const SIMPLE_DRAFT_MAX_BLOCK_MINUTES = 120;
const SIMPLE_DRAFT_DAY_END_MINUTES = 24 * 60;

function normalizeWeeklyPlanningText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[　]/g, ' ');
}

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

function resolveBlockLabel(block: WeeklyPlanDraftBlock): string {
  return (
    block.label.trim() ||
    block.materialName?.trim() ||
    block.subject.trim() ||
    block.title.trim() ||
    '学習予定'
  );
}

function resolveSimpleTaskTitle(text: string): string {
  const sanitizedTitle = sanitizeSuggestedTitle(text)
    .replace(/\s*(?:やりたい|したい|勉強したい|学習したい|進めたい|取り組みたい)\s*$/g, '')
    .replace(/[をはにでがへよりの]+$/g, '')
    .trim();

  return sanitizedTitle || '学習';
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
