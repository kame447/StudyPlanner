import type { WeekPlanMoveTarget } from '../../../lib/weekPlanDrag';
import type { WeeklyPlanDraftBlock } from '../types';

export function applyWeeklyPlanningPreviewMove(
  block: WeeklyPlanDraftBlock,
  target: WeekPlanMoveTarget,
  updatedAt = new Date().toISOString(),
): WeeklyPlanDraftBlock {
  return {
    ...block,
    date: target.date,
    startTime: target.startTime,
    endTime: target.endTime,
    userEdited: true,
    updatedAt,
  };
}

export function applyEditedPreviewPositions(
  baseBlocks: readonly WeeklyPlanDraftBlock[],
  editedBlocks: readonly WeeklyPlanDraftBlock[],
  updatedAt = new Date().toISOString(),
): { blocks: WeeklyPlanDraftBlock[]; changed: boolean } {
  const editedById = new Map(editedBlocks.map((block) => [block.id, block]));
  let changed = false;

  const blocks = baseBlocks.map((block) => {
    const edited = editedById.get(block.id);
    if (!edited) return block;

    const positionChanged =
      block.date !== edited.date ||
      block.startTime !== edited.startTime ||
      block.endTime !== edited.endTime;
    if (!positionChanged) return block;

    changed = true;
    return applyWeeklyPlanningPreviewMove(
      block,
      {
        date: edited.date,
        startTime: edited.startTime,
        endTime: edited.endTime,
      },
      updatedAt,
    );
  });

  return { blocks, changed };
}
