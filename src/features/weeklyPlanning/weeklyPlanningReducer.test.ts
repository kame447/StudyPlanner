import { describe, expect, it } from 'vitest';
import type { WeeklyPlanDraftBlock } from './types';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';

function draftBlock(
  id: string,
  overrides: Partial<WeeklyPlanDraftBlock> = {},
): WeeklyPlanDraftBlock {
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
    ...overrides,
  };
}

function assistantMessage(id: string, content: string) {
  return {
    id,
    role: 'assistant' as const,
    content,
    createdAt: '2026-06-19T00:00:00.000Z',
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


  it('removes only the matching draft block id while preserving the other blocks unchanged', () => {
    const first = draftBlock('draft-1', {
      title: 'math 2020',
      subject: 'math',
      startTime: '09:00',
      endTime: '10:00',
    });
    const target = draftBlock('draft-2', {
      title: 'math 2020',
      subject: 'math',
      startTime: '09:00',
      endTime: '10:00',
    });
    const third = draftBlock('draft-3', {
      title: 'math 2020',
      subject: 'math',
      startTime: '11:00',
      endTime: '12:00',
    });
    const state = weeklyPlanningReducer(createInitialPlanningState('2026-06-22'), {
      type: 'add_draft_blocks',
      blocks: [first, target, third],
    });

    const afterRemove = weeklyPlanningReducer(state, {
      type: 'remove_draft_block',
      blockId: target.id,
    });

    expect(afterRemove.draftBlocks).toEqual([first, third]);
    expect(afterRemove.mode).toBe('awaiting_approval');
  });

  it('keeps individually removed blocks out of the later bulk approval removal path', () => {
    const removed = draftBlock('draft-1');
    const remaining = draftBlock('draft-2');
    const state = weeklyPlanningReducer(createInitialPlanningState('2026-06-22'), {
      type: 'add_draft_blocks',
      blocks: [removed, remaining],
    });
    const afterIndividualRemove = weeklyPlanningReducer(state, {
      type: 'remove_draft_block',
      blockId: removed.id,
    });
    const blockIdsApprovedFromCurrentState = afterIndividualRemove.draftBlocks
      .filter((block) => block.status === 'draft')
      .map((block) => block.id);
    const afterBulkApprovalRemoval = weeklyPlanningReducer(afterIndividualRemove, {
      type: 'remove_draft_blocks',
      blockIds: blockIdsApprovedFromCurrentState,
    });

    expect(blockIdsApprovedFromCurrentState).toEqual([remaining.id]);
    expect(afterBulkApprovalRemoval.draftBlocks).toEqual([]);
    expect(afterBulkApprovalRemoval.mode).toBe('idle');
  });

  it('ignores a consecutive duplicate assistant message even when ids differ', () => {
    const initial = createInitialPlanningState('2026-06-22');
    const first = weeklyPlanningReducer(initial, {
      type: 'append_message',
      message: assistantMessage('assistant-1', '了解です。\n対象分野を教えてください。'),
    });
    const second = weeklyPlanningReducer(first, {
      type: 'append_message',
      message: assistantMessage('assistant-2', '了解です。  対象分野を教えてください。'),
    });

    expect(second).toBe(first);
    expect(second.messages).toHaveLength(1);
  });

  it('does not append the same last assistant message twice', () => {
    const first = weeklyPlanningReducer(createInitialPlanningState('2026-06-22'), {
      type: 'set_last_assistant_message',
      message: '対象分野を教えてください。',
    });
    const second = weeklyPlanningReducer(first, {
      type: 'set_last_assistant_message',
      message: '対象分野を教えてください。',
    });

    expect(second).toBe(first);
    expect(second.messages).toHaveLength(1);
  });

  it('keeps bulk discard behavior intact after an individual removal', () => {
    const state = weeklyPlanningReducer(createInitialPlanningState('2026-06-22'), {
      type: 'add_draft_blocks',
      blocks: [draftBlock('draft-1'), draftBlock('draft-2')],
    });
    const afterRemove = weeklyPlanningReducer(state, {
      type: 'remove_draft_block',
      blockId: 'draft-1',
    });
    const afterDiscard = weeklyPlanningReducer(afterRemove, {
      type: 'clear_draft_blocks',
    });

    expect(afterRemove.draftBlocks.map((block) => block.id)).toEqual(['draft-2']);
    expect(afterDiscard.draftBlocks).toEqual([]);
    expect(afterDiscard.mode).toBe('idle');
  });
});
