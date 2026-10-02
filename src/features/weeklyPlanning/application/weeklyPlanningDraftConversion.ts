import type { PlanDraft } from '../../../types/domain';
import type { WeeklyPlanDraftBlock } from '../types';

function resolveBlockLabel(block: WeeklyPlanDraftBlock): string {
  return (
    block.label.trim() ||
    block.materialName?.trim() ||
    block.subject.trim() ||
    block.title.trim() ||
    '学習予定'
  );
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
