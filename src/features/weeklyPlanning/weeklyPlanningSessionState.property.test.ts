import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './types';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';

const NOW = '2026-07-16T00:00:00.000Z';
const WEEK_START = '2026-07-13';

function message(id: string, role: WeeklyPlanningMessage['role'] = 'assistant'): WeeklyPlanningMessage {
  return { id, role, content: id, createdAt: NOW };
}

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
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function previewCandidate(id = 'preview-1'): WeeklyDraftCandidate {
  return {
    stableKey: id,
    date: '2026-07-16',
    startTime: '18:00',
    endTime: '19:00',
    durationMinutes: 60,
    title: id,
    field: '英語',
    year: 1,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: `英語:${id}`,
  };
}

function pendingTurn(baseRevision = 0): WeeklyPlanningPendingTurn {
  return {
    requestId: 'request-current',
    weekStartDate: WEEK_START,
    baseRevision,
    startedAt: NOW,
  };
}

function pendingApproval(baseRevision: number): WeeklyPlanningPendingApproval {
  return {
    requestId: 'approval-current',
    weekStartDate: WEEK_START,
    baseRevision,
    blockIds: ['draft-1', 'draft-2'],
    startedAt: NOW,
  };
}

function stateWithDrafts(): PlanningState {
  return weeklyPlanningReducer(
    createInitialPlanningState(WEEK_START),
    { type: 'add_draft_blocks', blocks: [draftBlock('draft-1'), draftBlock('draft-2')] },
  );
}

function stateWithPendingTurn(): PlanningState {
  const initial = createInitialPlanningState(WEEK_START);
  const pending = pendingTurn(initial.revision);
  return weeklyPlanningReducer(initial, {
    type: 'begin_turn',
    pending,
    userMessage: message('user-message', 'user'),
  });
}

function stateWithPendingApproval(): PlanningState {
  const withDrafts = stateWithDrafts();
  return weeklyPlanningReducer(withDrafts, {
    type: 'begin_approval',
    pending: pendingApproval(withDrafts.revision),
  });
}

function actionsForState(state: PlanningState): WeeklyPlanningAction[] {
  const turn = state.pendingTurn ?? pendingTurn(state.revision);
  const approval = state.pendingApproval ?? pendingApproval(state.revision);
  return [
    { type: 'add_draft_blocks', blocks: [draftBlock('draft-added')] },
    { type: 'remove_draft_block', blockId: 'draft-1' },
    { type: 'remove_draft_blocks', blockIds: ['draft-1', 'draft-2'] },
    { type: 'clear_draft_blocks' },
    { type: 'remove_preview_candidate', candidateId: 'preview-1' },
    { type: 'mark_draft_block_user_edited', blockId: 'draft-1' },
    { type: 'append_message', message: message('appended-message') },
    { type: 'set_intake_state', state: createInitialPlanningIntakeState() },
    { type: 'set_intake_state', state: null },
    { type: 'clear_conversation' },
    { type: 'reset_session' },
    { type: 'set_last_assistant_message', message: 'latest message' },
    { type: 'begin_turn', pending: turn, userMessage: message('begin-user', 'user') },
    {
      type: 'commit_turn',
      pending: turn,
      intakeState: createInitialPlanningIntakeState(),
      assistantMessage: message('commit-assistant'),
      draftCandidates: [previewCandidate()],
    },
    { type: 'fail_turn', pending: turn, assistantMessage: message('fail-assistant') },
    { type: 'cancel_turn', pending: turn },
    { type: 'begin_approval', pending: approval },
    {
      type: 'complete_approval',
      pending: approval,
      completedBlockIds: ['draft-1'],
      assistantMessage: message('approval-complete'),
    },
    { type: 'fail_approval', pending: approval },
  ];
}

const identityMasks = fc.constantFrom(
  [false, true, true] as const,
  [true, false, true] as const,
  [true, true, false] as const,
  [false, false, true] as const,
  [false, true, false] as const,
  [true, false, false] as const,
  [false, false, false] as const,
);

describe('weekly planning session reducer properties', () => {
  it('rejects turn results when any identity component is stale', () => {
    fc.assert(fc.property(
      identityMasks,
      fc.constantFrom('commit', 'fail', 'cancel'),
      ([requestMatches, weekMatches, revisionMatches], terminalKind) => {
        const begun = stateWithPendingTurn();
        const current = begun.pendingTurn as WeeklyPlanningPendingTurn;
        const stalePending: WeeklyPlanningPendingTurn = {
          ...current,
          requestId: requestMatches ? current.requestId : `${current.requestId}-stale`,
          weekStartDate: weekMatches ? current.weekStartDate : '2026-07-20',
          baseRevision: revisionMatches ? current.baseRevision : current.baseRevision + 1,
        };
        const action: WeeklyPlanningAction = terminalKind === 'commit'
          ? {
              type: 'commit_turn',
              pending: stalePending,
              intakeState: createInitialPlanningIntakeState(),
              assistantMessage: message('stale-commit'),
              draftCandidates: [previewCandidate()],
            }
          : terminalKind === 'fail'
            ? { type: 'fail_turn', pending: stalePending, assistantMessage: message('stale-fail') }
            : { type: 'cancel_turn', pending: stalePending };

        expect(weeklyPlanningReducer(begun, action)).toBe(begun);
      },
    ));
  });

  it('rejects approval results when any identity component is stale', () => {
    fc.assert(fc.property(
      identityMasks,
      fc.constantFrom('complete', 'fail'),
      ([requestMatches, weekMatches, revisionMatches], terminalKind) => {
        const begun = stateWithPendingApproval();
        const current = begun.pendingApproval as WeeklyPlanningPendingApproval;
        const stalePending: WeeklyPlanningPendingApproval = {
          ...current,
          requestId: requestMatches ? current.requestId : `${current.requestId}-stale`,
          weekStartDate: weekMatches ? current.weekStartDate : '2026-07-20',
          baseRevision: revisionMatches ? current.baseRevision : current.baseRevision + 1,
        };
        const action: WeeklyPlanningAction = terminalKind === 'complete'
          ? {
              type: 'complete_approval',
              pending: stalePending,
              completedBlockIds: ['draft-1'],
              assistantMessage: message('stale-approval'),
            }
          : { type: 'fail_approval', pending: stalePending };

        expect(weeklyPlanningReducer(begun, action)).toBe(begun);
      },
    ));
  });

  it('keeps the entire session immutable for arbitrary non-terminal actions during a pending turn', () => {
    const begun = stateWithPendingTurn();
    const blockedActions = actionsForState(begun).filter(
      (action) => action.type !== 'commit_turn'
        && action.type !== 'fail_turn'
        && action.type !== 'cancel_turn',
    );

    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: blockedActions.length - 1 }), { maxLength: 40 }),
      (indexes) => {
        const reduced = indexes.reduce(
          (state, index) => weeklyPlanningReducer(state, blockedActions[index]),
          begun,
        );
        expect(reduced).toBe(begun);
      },
    ));
  });

  it('keeps the entire session immutable for arbitrary non-terminal actions during approval', () => {
    const begun = stateWithPendingApproval();
    const blockedActions = actionsForState(begun).filter(
      (action) => action.type !== 'complete_approval' && action.type !== 'fail_approval',
    );

    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: blockedActions.length - 1 }), { maxLength: 40 }),
      (indexes) => {
        const reduced = indexes.reduce(
          (state, index) => weeklyPlanningReducer(state, blockedActions[index]),
          begun,
        );
        expect(reduced).toBe(begun);
      },
    ));
  });

  it('increments revision by exactly one for accepted mutations and preserves identity for rejected ones', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 3 }),
      fc.nat(),
      (stateIndex, actionIndex) => {
        const states = [
          createInitialPlanningState(WEEK_START),
          stateWithDrafts(),
          stateWithPendingTurn(),
          stateWithPendingApproval(),
        ];
        const current = states[stateIndex];
        const actions = actionsForState(current);
        const action = actions[actionIndex % actions.length];
        const next = weeklyPlanningReducer(current, action);

        if (next === current) {
          expect(next.revision).toBe(current.revision);
        } else {
          expect(next.revision).toBe(current.revision + 1);
        }
      },
    ));
  });
});
