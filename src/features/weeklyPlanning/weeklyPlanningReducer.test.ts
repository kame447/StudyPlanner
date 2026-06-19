import { describe, expect, it } from 'vitest';
import type { WeeklyPlanDraftBlock } from './types';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';

function draftBlock(id: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date: '2026-06-22',
    startTime: '19:00',
    endTime: '20:00',
    title: '英語課題',
    subject: '英語',
    type: 'study',
    label: '英語',
    materialId: null,
    materialName: '',
    memo: '',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
  };
}

describe('weeklyPlanningReducer', () => {
  it('adds draft blocks without saving them as plans', () => {
    const state = weeklyPlanningReducer(createInitialPlanningState('2026-06-22'), {
      type: 'add_draft_blocks',
      blocks: [draftBlock('draft-1')],
    });

    expect(state.mode).toBe('awaiting_approval');
    expect(state.draftBlocks).toHaveLength(1);
    expect(state.draftBlocks[0].status).toBe('draft');
  });

  it('supports individual removal and bulk clearing of pending drafts', () => {
    const state = weeklyPlanningReducer(createInitialPlanningState('2026-06-22'), {
      type: 'add_draft_blocks',
      blocks: [draftBlock('draft-1'), draftBlock('draft-2')],
    });
    const afterRemove = weeklyPlanningReducer(state, {
      type: 'remove_draft_block',
      blockId: 'draft-1',
    });
    const afterClear = weeklyPlanningReducer(afterRemove, {
      type: 'clear_draft_blocks',
    });

    expect(afterRemove.draftBlocks.map((block) => block.id)).toEqual(['draft-2']);
    expect(afterClear.draftBlocks).toEqual([]);
    expect(afterClear.mode).toBe('idle');
  });
});
