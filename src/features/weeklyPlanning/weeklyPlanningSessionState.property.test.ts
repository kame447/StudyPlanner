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
    conversationId: 'conversation-current',
    turnId: 'conversation-current:turn:1',
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
        && action.type !== 'cancel_turn'
        && action.type !== 'reset_session',
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
      (action) => action.type !== 'complete_approval'
        && action.type !== 'fail_approval'
        && action.type !== 'reset_session',
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

  it('accepts and rejects each action as the session contract says, independent of the reducer (#382)', () => {
    // Independent accept/reject table: derived from the session contract (no pending work ->
    // ordinary edits apply when their target exists; a pending turn admits only its own
    // commit/fail/cancel and reset; a pending approval admits only its own complete/fail and
    // reset; terminal results without a pending operation are stale). 'either' marks pairs the
    // contract leaves open; only the revision invariant is checked for them.
    type Expected = 'accept' | 'reject' | 'either';
    const idle = (hasDrafts: boolean): Record<WeeklyPlanningAction['type'], Expected> => ({
      add_draft_blocks: 'accept',
      remove_draft_block: hasDrafts ? 'accept' : 'reject',
      remove_draft_blocks: hasDrafts ? 'accept' : 'reject',
      clear_draft_blocks: hasDrafts ? 'accept' : 'reject',
      remove_preview_candidate: 'reject',
      mark_draft_block_user_edited: hasDrafts ? 'accept' : 'reject',
      append_message: 'accept',
      set_intake_state: 'either',
      clear_conversation: 'either',
      reset_session: hasDrafts ? 'accept' : 'either',
      set_last_assistant_message: 'accept',
      begin_turn: 'accept',
      commit_turn: 'reject',
      fail_turn: 'reject',
      cancel_turn: 'reject',
      begin_approval: hasDrafts ? 'accept' : 'either',
      complete_approval: 'reject',
      fail_approval: 'reject',
    } as Record<WeeklyPlanningAction['type'], Expected>);
    const onlyAdmits = (admitted: WeeklyPlanningAction['type'][]) => (type: WeeklyPlanningAction['type']): Expected =>
      admitted.includes(type) ? 'accept' : 'reject';
    const cases: Array<{ label: string; state: () => PlanningState; expected: (type: WeeklyPlanningAction['type']) => Expected }> = [
      { label: 'initial', state: () => createInitialPlanningState(WEEK_START), expected: (type) => idle(false)[type] },
      { label: 'with drafts', state: stateWithDrafts, expected: (type) => idle(true)[type] },
      { label: 'pending turn', state: stateWithPendingTurn, expected: onlyAdmits(['commit_turn', 'fail_turn', 'cancel_turn', 'reset_session']) },
      { label: 'pending approval', state: stateWithPendingApproval, expected: onlyAdmits(['complete_approval', 'fail_approval', 'reset_session']) },
    ];
    let checked = 0;
    for (const testCase of cases) {
      for (const action of actionsForState(testCase.state())) {
        const current = testCase.state();
        const next = weeklyPlanningReducer(current, action);
        const expected = testCase.expected(action.type);
        const label = `${testCase.label} / ${action.type}`;
        if (expected === 'accept') {
          expect(next, label).not.toBe(current);
          expect(next.revision, label).toBe(current.revision + 1);
        } else if (expected === 'reject') {
          expect(next, label).toBe(current);
        } else {
          expect(next.revision, label).toBe(next === current ? current.revision : current.revision + 1);
        }
        checked += 1;
      }
    }
    // 4 states x 19 actions, enumerated (a bounded matrix, not every reducer state).
    expect(checked).toBe(76);
  });
});
