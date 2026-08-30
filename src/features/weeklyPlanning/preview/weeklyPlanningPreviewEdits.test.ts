import { describe, expect, it } from 'vitest';
import type { WeeklyPlanDraftBlock } from '../types';
import {
  applyEditedPreviewPositions,
  applyWeeklyPlanningPreviewMove,
} from './weeklyPlanningPreviewEdits';

function makeBlock(
  id: string,
  overrides: Partial<WeeklyPlanDraftBlock> = {},
): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date: '2026-08-29',
    startTime: '10:00',
    endTime: '11:00',
    title: '数学',
    subject: '数学',
    type: 'study',
    label: '数学',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('applyWeeklyPlanningPreviewMove', () => {
  it('moves only the temporal fields and marks the block as user edited', () => {
    const block = makeBlock('block-1', { memo: 'keep me' });

    const moved = applyWeeklyPlanningPreviewMove(
      block,
      {
        date: '2026-08-30',
        startTime: '13:15',
        endTime: '14:15',
      },
      '2026-08-29T01:00:00.000Z',
    );

    expect(moved).toMatchObject({
      id: 'block-1',
      date: '2026-08-30',
      startTime: '13:15',
      endTime: '14:15',
      memo: 'keep me',
      userEdited: true,
      updatedAt: '2026-08-29T01:00:00.000Z',
    });
  });
});

describe('applyEditedPreviewPositions', () => {
  it('overlays preview drag positions onto the generated draft without losing metadata', () => {
    const base = makeBlock('stable-key', {
      memo: 'generated metadata',
      materialName: '教材A',
    });
    const edited = makeBlock('stable-key', {
      date: '2026-08-31',
      startTime: '15:00',
      endTime: '16:00',
    });

    const result = applyEditedPreviewPositions(
      [base],
      [edited],
      '2026-08-29T02:00:00.000Z',
    );

    expect(result.changed).toBe(true);
    expect(result.blocks[0]).toMatchObject({
      id: 'stable-key',
      date: '2026-08-31',
      startTime: '15:00',
      endTime: '16:00',
      memo: 'generated metadata',
      materialName: '教材A',
      userEdited: true,
      updatedAt: '2026-08-29T02:00:00.000Z',
    });
  });

  it('does not rewrite untouched blocks', () => {
    const base = makeBlock('block-1');
    const edited = makeBlock('block-1');

    const result = applyEditedPreviewPositions([base], [edited]);

    expect(result.changed).toBe(false);
    expect(result.blocks[0]).toBe(base);
  });
});
