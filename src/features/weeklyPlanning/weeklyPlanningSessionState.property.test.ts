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

const validIsoDate = fc.integer({
  min: Date.UTC(2000, 0, 1),
  max: Date.UTC(2100, 11, 31),
}).map((timestamp) => new Date(timestamp).toISOString().slice(0, 10));

describe('weekly planning session reducer properties', () => {
  it('never commits an arbitrary stale turn identity', () => {
    fc.assert(fc.property(
      fc.record({
        requestId: fc.string({ minLength: 1 }).filter((value) => value !== 'request-current'),
        weekStartDate: validIsoDate,
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
        message: { id: `message-${content}`, role: 'assistant' as const, content, createdAt: 'now' },
      })),
    );

    fc.assert(fc.property(fc.array(actionArbitrary, { maxLength: 25 }), (actions) => {
      const initial = createInitialPlanningState('2026-07-13');
      const current = pendingTurn(initial.revision);
      const begun = weeklyPlanningReducer(initial, {
        type: 'begin_turn',
        pending: current,
        userMessage: {
          id: 'user-message', role: 'user', content: '予定', createdAt: current.startedAt,
        },
      });
      const reduced = actions.reduce(weeklyPlanningReducer, begun);
      expect(reduced).toBe(begun);
    }));
  });

  it('keeps draft blocks immutable for arbitrary mutation sequences during approval', () => {
    const blockIdArbitrary = fc.oneof(fc.constant('draft-1'), fc.constant('draft-2'), fc.string());
    const draftMutationArbitrary = fc.oneof(
      blockIdArbitrary.map((blockId) => ({ type: 'remove_draft_block' as const, blockId })),
      fc.array(blockIdArbitrary, { maxLength: 5 }).map((blockIds) => ({
        type: 'remove_draft_blocks' as const,
        blockIds,
      })),
      fc.constant({ type: 'clear_draft_blocks' as const }),
    );

    fc.assert(fc.property(fc.array(draftMutationArbitrary, { maxLength: 25 }), (actions) => {
      const withDrafts = weeklyPlanningReducer(
        createInitialPlanningState('2026-07-13'),
        { type: 'set_draft_blocks', draftBlocks: [draftBlock('draft-1'), draftBlock('draft-2')] },
      );
      const approval = pendingApproval(withDrafts.revision);
      const begun = weeklyPlanningReducer(withDrafts, { type: 'begin_approval', pending: approval });
      const reduced = actions.reduce(weeklyPlanningReducer, begun);
      expect(reduced.draftBlocks).toEqual(begun.draftBlocks);
      expect(reduced.pendingApproval).toEqual(approval);
    }));
  });

  it('keeps revision monotonic for arbitrary accepted non-load mutations', () => {
    const acceptedMutationArbitrary = fc.oneof(
      fc.string().map((content) => ({
        type: 'append_message' as const,
        message: { id: `message-${content}`, role: 'assistant' as const, content, createdAt: 'now' },
      })),
      fc.array(fc.string(), { maxLength: 5 }).map((blockIds) => ({
        type: 'remove_draft_blocks' as const,
        blockIds,
      })),
      fc.constant({ type: 'clear_draft_blocks' as const }),
    );

    fc.assert(fc.property(fc.array(acceptedMutationArbitrary, { maxLength: 25 }), (actions) => {
      let current = createInitialPlanningState('2026-07-13');
      for (const action of actions) {
        const next = weeklyPlanningReducer(current, action);
        expect(next.revision).toBeGreaterThanOrEqual(current.revision);
        current = next;
      }
    }));
  });
});
