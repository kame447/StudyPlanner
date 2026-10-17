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

// Each bit marks one stale identity field. Enumerate every nonempty subset;
// the old three-field audit domain is included in the five-field turn domain.
function staleIdentities<T extends object>(current: T, staleValues: Partial<T>): T[] {
  const keys = Object.keys(staleValues) as (keyof T)[];
  return Array.from({ length: 2 ** keys.length - 1 }, (_, index) => {
    const stale = { ...current };
    keys.forEach((key, bit) => {
      if ((index + 1) & (1 << bit)) stale[key] = staleValues[key] as T[keyof T];
    });
    return stale;
  });
}

type SessionKind = 'empty' | 'drafts' | 'preview' | 'turn' | 'approval';

interface RevisionCase {
  action: WeeklyPlanningAction;
  acceptedIn: readonly SessionKind[];
  changes: Partial<PlanningState>;
}

// Contract oracle: acceptance is declared before observing the reducer result.
// Ordinary mutations advance the session revision once; rejection preserves all
// data. load_state restores a checkpoint's own revision (checked separately).
// See current-contract-v5.md: Fact Graph / lifecycle, pending question binding,
// and preview / approval / save. This is session revision, not graph revision.
function revisionCases(state: PlanningState, kind: SessionKind): RevisionCase[] {
  const ready = ['empty', 'drafts', 'preview'] as const;
  const all = [...ready, 'turn', 'approval'] as const;
  const turn = state.pendingTurn ?? pendingTurn(state.revision);
  const approval = state.pendingApproval ?? pendingApproval(state.revision);
  const intake = createInitialPlanningIntakeState();
  const appended = message('appended-message');
  const user = message('begin-user', 'user');
  const committed = message('commit-assistant');
  const failed = message('fail-assistant');
  const completed = message('approval-complete');
  return [
    {
      action: { type: 'set_week_anchor', weekStartDate: '2026-07-20' },
      acceptedIn: ready, changes: { weekStartDate: '2026-07-20' },
    },
    {
      action: { type: 'set_week_anchor', weekStartDate: WEEK_START },
      acceptedIn: [], changes: {},
    },
    {
      action: { type: 'add_draft_blocks', blocks: [draftBlock('draft-added')] },
      acceptedIn: ready,
      changes: { draftBlocks: [...state.draftBlocks, draftBlock('draft-added')], previewCandidates: [], mode: 'awaiting_approval' },
    },
    { action: { type: 'add_draft_blocks', blocks: [] }, acceptedIn: [], changes: {} },
    {
      action: { type: 'remove_draft_block', blockId: 'draft-1' },
      acceptedIn: ['drafts', 'preview'], changes: { draftBlocks: [draftBlock('draft-2')] },
    },
    {
      action: { type: 'remove_draft_blocks', blockIds: ['draft-1', 'draft-2'] },
      acceptedIn: ['drafts', 'preview'], changes: { draftBlocks: [], mode: 'idle' },
    },
    {
      action: { type: 'clear_draft_blocks' }, acceptedIn: ['drafts', 'preview'],
      changes: { draftBlocks: [], previewCandidates: [], mode: kind === 'preview' ? 'collecting_tasks' : 'idle' },
    },
    {
      action: { type: 'remove_preview_candidate', candidateId: 'preview-1' },
      acceptedIn: ['preview'], changes: { previewCandidates: [], mode: 'awaiting_approval' },
    },
    {
      action: { type: 'mark_draft_block_user_edited', blockId: 'draft-1' },
      acceptedIn: ['drafts', 'preview'],
      changes: { draftBlocks: [{ ...draftBlock('draft-1'), userEdited: true, updatedAt: expect.any(String) }, draftBlock('draft-2')] },
    },
    {
      action: { type: 'append_message', message: appended }, acceptedIn: ready,
      changes: { messages: [...state.messages, appended], mode: kind === 'empty' ? 'collecting_tasks' : state.mode },
    },
    {
      action: { type: 'append_message', message: message('previous') },
      acceptedIn: ['empty', 'drafts'],
      changes: { messages: [...state.messages, message('previous')], mode: kind === 'empty' ? 'collecting_tasks' : state.mode },
    },
    { action: { type: 'set_intake_state', state: intake }, acceptedIn: ready, changes: { intakeState: intake } },
    { action: { type: 'set_intake_state', state: null }, acceptedIn: ready, changes: { intakeState: undefined } },
    {
      action: { type: 'clear_conversation' }, acceptedIn: ready,
      changes: { messages: [], lastAssistantMessage: undefined },
    },
    {
      action: { type: 'reset_session' }, acceptedIn: all,
      changes: {
        conversationRequestSequence: 0, approvalRecovery: undefined, mode: 'idle',
        draftBlocks: [], previewCandidates: [], messages: [], intakeState: undefined,
        pendingTurn: undefined, pendingApproval: undefined, lastAssistantMessage: undefined,
      },
    },
    {
      action: { type: 'set_last_assistant_message', message: 'latest message' }, acceptedIn: ready,
      changes: {
        messages: [...state.messages, { id: expect.any(String), role: 'assistant', content: 'latest message', createdAt: expect.any(String) }],
        lastAssistantMessage: 'latest message',
      },
    },
    {
      action: { type: 'begin_turn', pending: turn, userMessage: user }, acceptedIn: ready,
      changes: {
        conversationRequestSequence: 1, pendingTurn: turn, messages: [...state.messages, user],
        mode: kind === 'empty' ? 'collecting_tasks' : state.mode,
      },
    },
    {
      action: { type: 'commit_turn', pending: turn, intakeState: intake, assistantMessage: committed, draftCandidates: [previewCandidate()] },
      acceptedIn: ['turn'],
      changes: { pendingTurn: undefined, intakeState: intake, messages: [...state.messages, committed], lastAssistantMessage: committed.content, previewCandidates: [previewCandidate()], mode: 'draft_created' },
    },
    {
      action: { type: 'fail_turn', pending: turn, assistantMessage: failed }, acceptedIn: ['turn'],
      changes: { pendingTurn: undefined, messages: [...state.messages, failed], lastAssistantMessage: failed.content },
    },
    { action: { type: 'cancel_turn', pending: turn }, acceptedIn: ['turn'], changes: { pendingTurn: undefined } },
    { action: { type: 'begin_approval', pending: approval }, acceptedIn: ['drafts', 'preview'], changes: { pendingApproval: approval } },
    {
      action: { type: 'complete_approval', pending: approval, completedBlockIds: ['draft-1'], assistantMessage: completed },
      acceptedIn: ['approval'],
      changes: { pendingApproval: undefined, approvalRecovery: undefined, draftBlocks: [draftBlock('draft-2')], messages: [...state.messages, completed], lastAssistantMessage: completed.content, mode: 'awaiting_approval' },
    },
    { action: { type: 'fail_approval', pending: approval }, acceptedIn: ['approval'], changes: { pendingApproval: undefined, approvalRecovery: undefined } },
  ];
}

describe('weekly planning session reducer properties', () => {
  it('rejects turn results when any identity component is stale', () => {
    const begun = stateWithPendingTurn();
    const current = begun.pendingTurn as WeeklyPlanningPendingTurn;
    const identities = staleIdentities(current, {
      conversationId: 'stale-conversation', turnId: 'stale-turn',
      requestId: 'stale-request', weekStartDate: '2026-07-20', baseRevision: current.baseRevision + 1,
    });
    expect(identities).toHaveLength(31);
    let checked = 0;
    for (const pending of identities) {
      const actions: WeeklyPlanningAction[] = [
        { type: 'commit_turn', pending, intakeState: createInitialPlanningIntakeState(), assistantMessage: message('stale-commit'), draftCandidates: [previewCandidate()] },
        { type: 'fail_turn', pending, assistantMessage: message('stale-fail') },
        { type: 'cancel_turn', pending },
      ];
      for (const action of actions) {
        const before = structuredClone(begun);
        const label = JSON.stringify({ action: action.type, pending });
        const next = weeklyPlanningReducer(begun, action);
        expect(next, label).toBe(begun);
        expect(next, label).toEqual(before);
        checked += 1;
      }
    }
    expect(checked).toBe(93);
  });

  it('rejects approval results when any identity component is stale', () => {
    const begun = stateWithPendingApproval();
    const current = begun.pendingApproval as WeeklyPlanningPendingApproval;
    const identities = staleIdentities(current, {
      requestId: 'stale-request', weekStartDate: '2026-07-20', baseRevision: current.baseRevision + 1,
    });
    expect(identities).toHaveLength(7);
    let checked = 0;
    for (const pending of identities) {
      const actions: WeeklyPlanningAction[] = [
        { type: 'complete_approval', pending, completedBlockIds: ['draft-1'], assistantMessage: message('stale-approval') },
        { type: 'fail_approval', pending },
      ];
      for (const action of actions) {
        const before = structuredClone(begun);
        const label = JSON.stringify({ action: action.type, pending });
        const next = weeklyPlanningReducer(begun, action);
        expect(next, label).toBe(begun);
        expect(next, label).toEqual(before);
        checked += 1;
      }
    }
    expect(checked).toBe(14);
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

  it('applies the independent acceptance and data table with exactly one revision per mutation', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 1_000_000 }), (revision) => {
      const states: Record<SessionKind, PlanningState> = {
        empty: createInitialPlanningState(WEEK_START),
        drafts: stateWithDrafts(),
        preview: {
          ...stateWithDrafts(), mode: 'draft_created', previewCandidates: [previewCandidate()],
          messages: [message('previous')], lastAssistantMessage: 'previous',
          intakeState: createInitialPlanningIntakeState(),
        },
        turn: stateWithPendingTurn(),
        approval: stateWithPendingApproval(),
      };
      for (const [kind, fixture] of Object.entries(states) as [SessionKind, PlanningState][]) {
        const current: PlanningState = {
          ...fixture, revision,
          ...(fixture.pendingTurn ? { pendingTurn: { ...fixture.pendingTurn, baseRevision: revision - 1 } } : {}),
          ...(fixture.pendingApproval ? { pendingApproval: { ...fixture.pendingApproval, baseRevision: revision - 1 } } : {}),
        };
        for (const { action, acceptedIn, changes } of revisionCases(current, kind)) {
          const before = structuredClone(current);
          const label = `${kind}: ${JSON.stringify(action)}`;
          const next = weeklyPlanningReducer(current, action);
          if (acceptedIn.includes(kind)) {
            expect(next.revision, label).toBe(revision + 1);
            expect(next, label).toEqual({ ...before, ...changes, revision: revision + 1, updatedAt: expect.any(String) });
          } else {
            expect(next, label).toBe(current);
            expect(next, label).toEqual(before);
          }
          expect(current, label).toEqual(before);
        }
        // Restoration is allowed even while busy and preserves checkpoint data
        // and revision, rather than manufacturing a new local mutation.
        const checkpoint = { ...states.preview, revision: 42 };
        expect(weeklyPlanningReducer(current, { type: 'load_state', state: checkpoint })).toEqual(checkpoint);
      }
    }));
  });
});
