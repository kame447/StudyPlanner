import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
} from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';

function draftBlock(id: string): WeeklyPlanDraftBlock {
  return {
    id,
    userId: 'user-1',
    date: '2026-07-27',
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
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
  };
}

describe('weekly planning conversation clear', () => {
  it('removes only visible messages and keeps the same planning work and conversation', async () => {
    const intakeState = createInitialPlanningIntakeState();
    const draftBlocks = [draftBlock('draft-1')];
    const previewCandidates = [{ stableKey: 'preview-1' } as never];
    let state: PlanningState = {
      ...createInitialPlanningState('2026-07-27'),
      revision: 8,
      conversationRequestSequence: 5,
      mode: 'draft_created',
      draftBlocks,
      previewCandidates,
      messages: [
        {
          id: 'conversation-1:turn:5:user',
          role: 'user',
          content: '英語の予定を作りたい',
          createdAt: '2026-07-24T10:00:00.000Z',
        },
        {
          id: 'conversation-1:turn:5:assistant',
          role: 'assistant',
          content: '条件を確認しました。',
          createdAt: '2026-07-24T10:00:01.000Z',
        },
      ],
      intakeState,
      lastAssistantMessage: '条件を確認しました。',
    };
    const store = {
      getState: () => state,
      dispatch: (action: WeeklyPlanningAction) => {
        state = weeklyPlanningReducer(state, action);
        return state;
      },
    };
    const session = createWeeklyPlanningControllerSession(
      'user-1',
      '2026-07-27',
      'conversation-1',
    );
    session.requestSequence = 5;

    const beforeClear = state;
    expect(clearWeeklyPlanningControlledConversation(store)).toBe(true);

    const cleared = state;
    expect(cleared.messages).toEqual([]);
    expect(cleared.lastAssistantMessage).toBeUndefined();
    expect(cleared.intakeState).toBe(intakeState);
    expect(cleared.draftBlocks).toBe(draftBlocks);
    expect(cleared.previewCandidates).toBe(previewCandidates);
    expect(cleared.mode).toBe(beforeClear.mode);
    expect(cleared.conversationRequestSequence).toBe(5);
    expect(cleared.revision).toBe(beforeClear.revision + 1);
    expect(session.conversationId).toBe('conversation-1');
    expect(session.requestSequence).toBe(5);

    let capturedConversationId = '';
    let capturedRequestId = '';
    let capturedSnapshot: PlanningState | undefined;
    const submission = await submitWeeklyPlanningControlledTurn({
      session,
      ownerId: 'user-1',
      userText: 'そのまま続けて',
      getState: store.getState,
      dispatch: store.dispatch,
      async execute({ snapshot, pending }) {
        capturedSnapshot = snapshot;
        capturedConversationId = pending.conversationId;
        capturedRequestId = pending.requestId;
        return {
          state: intakeState,
          message: '続きとして確認します。',
          draftCandidates: [],
        };
      },
    });

    expect(submission.accepted).toBe(true);
    expect(capturedSnapshot?.intakeState).toBe(intakeState);
    expect(capturedConversationId).toBe('conversation-1');
    expect(capturedRequestId).toBe('conversation-1:request:6');
  });
});
