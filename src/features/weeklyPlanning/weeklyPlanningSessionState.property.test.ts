import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type {
  WeeklyPlanDraftBlock,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './types';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';

function draftBlock(id: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    title: id,
    subject: '英語',
    type: 'study',
    label: '英語',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function pendingTurn(baseRevision = 0): WeeklyPlanningPendingTurn {
  return {
    requestId: 'request-current',
    weekStartDate: '2026-07-13',
    baseRevision,
    startedAt: '2026-07-16T00:00:00.000Z',
  };
}

function pendingApproval(baseRevision: number): WeeklyPlanningPendingApproval {
  return {
    requestId: 'approval-current',
    weekStartDate: '2026-07-13',
    baseRevision,
    blockIds: ['draft-1', 'draft-2'],
    startedAt: '2026-07-16T00:00:00.000Z',
  };
}

describe('weekly planning session reducer properties', () => {
  it('never commits an arbitrary stale turn identity', () => {
    fc.assert(fc.property(
      fc.record({
        requestId: fc.string({ minLength: 1 }).filter((value) => value !== 'request-current'),
        weekStartDate: fc.date().map((date) => date.toISOString().slice(0, 10)),
        baseRevision: fc.nat({ max: 50 }),
      }),
      (stale) => {
        const initial = createInitialPlanningState('2026-07-13');
        const current = pendingTurn(initial.revision);
        const begun = weeklyPlanningReducer(initial, {
          type: 'begin_turn',
          pending: current,
          userMessage: {
            id: 'user-message', role: 'user', content: '予定', createdAt: current.startedAt,
          },
        });
        const stalePending = { ...current, ...stale };
        const committed = weeklyPlanningReducer(begun, {
          type: 'commit_turn',
          pending: stalePending,
          intakeState: createInitialPlanningIntakeState(),
          assistantMessage: {
            id: 'assistant-message', role: 'assistant', content: '古い結果', createdAt: current.startedAt,
          },
        });
        expect(committed).toBe(begun);
      },
    ));
  });

  it('keeps the whole session immutable for arbitrary mutations during a pending turn', () => {
    const actionArbitrary = fc.oneof(
      fc.string().map((blockId) => ({ type: 'remove_draft_block' as const, blockId })),
      fc.array(fc.string(), { maxLength: 5 }).map((blockIds) => ({
        type: 'remove_draft_blocks' as const,
        blockIds,
      })),
      fc.constant({ type: 'clear_draft_blocks' as const }),
      fc.string().map((content) => ({
        type: 'append_message' as const,
        message: {
          id: `extra-${content}`,
          role: 'user' as const,
          content,
          createdAt: '2026-07-16T00:00:00.000Z',
        },
      })),
    );

    fc.assert(fc.property(fc.array(actionArbitrary, { maxLength: 30 }), (actions) => {
      const withDrafts = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), {
        type: 'add_draft_blocks',
        blocks: [draftBlock('draft-1'), draftBlock('draft-2')],
      });
      const pending = pendingTurn(withDrafts.revision);
      const begun = weeklyPlanningReducer(withDrafts, {
        type: 'begin_turn',
        pending,
        userMessage: {
          id: 'user-message', role: 'user', content: '予定', createdAt: pending.startedAt,
        },
      });
      const after = actions.reduce(weeklyPlanningReducer, begun);
      expect(after).toBe(begun);
      expect(after.pendingTurn).toEqual(pending);
    }));
  });

  it('keeps draft blocks immutable for arbitrary mutation sequences during approval', () => {
    const actionArbitrary = fc.oneof(
      fc.string().map((blockId) => ({ type: 'remove_draft_block' as const, blockId })),
      fc.array(fc.string(), { maxLength: 5 }).map((blockIds) => ({
        type: 'remove_draft_blocks' as const,
        blockIds,
      })),
      fc.constant({ type: 'clear_draft_blocks' as const }),
    );

    fc.assert(fc.property(fc.array(actionArbitrary, { maxLength: 30 }), (actions) => {
      const withDrafts = weeklyPlanningReducer(createInitialPlanningState('2026-07-13'), {
        type: 'add_draft_blocks',
        blocks: [draftBlock('draft-1'), draftBlock('draft-2')],
      });
      const pending = pendingApproval(withDrafts.revision);
      const approving = weeklyPlanningReducer(withDrafts, { type: 'begin_approval', pending });
      const after = actions.reduce(weeklyPlanningReducer, approving);
      expect(after).toBe(approving);
      expect(after.draftBlocks).toEqual(approving.draftBlocks);
    }));
  });

  it('keeps revision monotonic for arbitrary accepted non-load mutations', () => {
    fc.assert(fc.property(fc.array(fc.string(), { maxLength: 40 }), (contents) => {
      let state = createInitialPlanningState('2026-07-13');
      for (const [index, content] of contents.entries()) {
        const previousRevision = state.revision;
        state = weeklyPlanningReducer(state, {
          type: 'append_message',
          message: {
            id: `message-${index}`, role: 'user', content, createdAt: '2026-07-16T00:00:00.000Z',
          },
        });
        expect(state.revision).toBe(previousRevision + 1);
      }
    }));
  });
});
