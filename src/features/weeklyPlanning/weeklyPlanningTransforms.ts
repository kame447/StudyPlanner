import { createId } from '../../lib/id';
import { addDays, startOfWeek } from '../../lib/date';
import type { PlanDraft } from '../../types/domain';
import type { WeeklyPlanDraftBlock } from './types';

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
