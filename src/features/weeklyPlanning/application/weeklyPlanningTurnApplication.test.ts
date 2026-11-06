import { describe, expect, it, vi } from 'vitest';
import * as firebaseClient from '../../../lib/firebaseClient';
import type { PlannerDataAvailability } from '../../../domain/plannerDataReadAuthority';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningAction } from '../types';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { executeDurableWeeklyTurn, type DurableTurnClientPorts } from './weeklyPlanningDurableTurnClient';
import type { WeeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from './weeklyPlanningTurnApplication';

function createHarness() {
  let state = createInitialPlanningState('2026-07-27');
  return {
    getState: () => state,
    dispatch: (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function createServices(overrides: Partial<WeeklyPlanningTurnApplicationServices> = {}) {
  return {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      execute: vi.fn(async () => ({
        state: createInitialPlanningIntakeState(),
        message: '確認しました。',
        draftCandidates: [],
      })),
    },
    stagingLifecycle: {
      prepare: vi.fn(() => ({
        rollback: vi.fn(),
        complete: vi.fn(),
      })),
      discard: vi.fn(),
    },
    outcomeLifecycle: {
      committed: vi.fn(),
      discarded: vi.fn(),
      failed: vi.fn(),
    },
    ...overrides,
  } as WeeklyPlanningTurnApplicationServices;
}

function readyPlannerDataAvailability(): PlannerDataAvailability {
  return {
    status: 'ready',
    ownerId: 'user-1',
    observedAt: '2026-07-27T00:00:00.000Z',
    lastSuccessfulAt: '2026-07-27T00:00:00.000Z',
  };
}

function baseParams() {
  const store = createHarness();
  return {
    store,
    params: {
      session: createWeeklyPlanningControllerSession(
        'user-1',
        '2026-07-27',
        'conversation-1',
      ),
      userId: 'user-1',
      ownerId: 'user-1',
      plannerDataAvailability: readyPlannerDataAvailability(),
      userText: '来週の予定を作りたい',
      selectedDate: '2026-07-27',
      plans: [],
      scheduleTemplates: [],
      timetableTermId: '2026-full-year',
      weekStartsOn: 'monday' as const,
      getState: store.getState,
      dispatch: store.dispatch,
    },
  };
}

describe('submitWeeklyPlanningApplicationTurn', () => {
  it('resumes accepted work without constructing a new candidate-choice observation or selection', async () => {
    const { params } = baseParams();
    let configurationReads = 0;
    const execute = vi.fn(async () => ({ state: createInitialPlanningIntakeState(), message: '回収した返信', draftCandidates: [] }));
    const continueSelectedTurn = vi.fn(() => execute());
    const services = createServices({ runtimeGateway: { execute, continueSelectedTurn },
      candidateChoice: { get configuration() { configurationReads += 1; return null; } } });
    const resumePending = { conversationId: 'conversation-1', turnId: 'conversation-1:turn:1',
      requestId: 'conversation-1:request:1', weekStartDate: '2026-07-27', baseRevision: 0,
      startedAt: '2026-07-27T01:00:00.000Z' };
    const result = await submitWeeklyPlanningApplicationTurn({ ...params, resumePending,
      isPlannerDataSnapshotCurrent: () => true }, services);
    expect(result.accepted).toBe(true);
    expect(configurationReads).toBe(0); expect(continueSelectedTurn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ resumeDurable: true, pending: resumePending }));
  });

  it('fails closed before starting a turn when planner data is unavailable, stale, or owned by another user', async () => {
    const blockedAvailability: PlannerDataAvailability[] = [
      {
        status: 'unavailable',
        ownerId: 'user-1',
        observedAt: '2026-07-27T00:01:00.000Z',
        lastSuccessfulAt: null,
      },
      {
        status: 'stale',
        ownerId: 'user-1',
        observedAt: '2026-07-27T00:02:00.000Z',
        lastSuccessfulAt: '2026-07-27T00:00:00.000Z',
      },
      {
        status: 'ready',
        ownerId: 'user-2',
        observedAt: '2026-07-27T00:03:00.000Z',
        lastSuccessfulAt: '2026-07-27T00:03:00.000Z',
      },
    ];

    for (const plannerDataAvailability of blockedAvailability) {
      const { store, params } = baseParams();
      params.plannerDataAvailability = plannerDataAvailability;
      const services = createServices();

      const submission = await submitWeeklyPlanningApplicationTurn(params, services);

      expect(submission).toEqual({ accepted: false, draftCandidates: [] });
      expect(services.runtimeGateway.execute).not.toHaveBeenCalled();
      expect(store.getState().messages).toEqual([]);
      expect(store.getState().pendingTurn).toBeUndefined();
    }
  });

  it('prepares authoritative state before completing a committed turn', async () => {
    const { store, params } = baseParams();
    const resultState = createInitialPlanningIntakeState();
    const runtimeGateway = {
      execute: vi.fn(async () => ({
        state: resultState,
        message: '期間を確認しました。',
        draftCandidates: [],
      })),
    };
    const rollback = vi.fn();
    const complete = vi.fn();
    const stagingLifecycle = {
      prepare: vi.fn(() => ({ rollback, complete })),
      discard: vi.fn(),
    };
    const services = createServices({ runtimeGateway, stagingLifecycle });

    const submission = await submitWeeklyPlanningApplicationTurn(params, services);

    expect(submission.accepted).toBe(true);
    expect(runtimeGateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        weekStartDate: '2026-07-27',
        messages: [],
      }),
      pending: expect.objectContaining({
        conversationId: 'conversation-1',
        requestId: 'conversation-1:request:1',
      }),
      userText: '来週の予定を作りたい',
      selectedDate: '2026-07-27',
      userId: 'user-1',
      timetableTermId: '2026-full-year',
      weekStartsOn: 'monday',
      timeZone: undefined,
    }));
    expect(stagingLifecycle.prepare).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      pending: expect.objectContaining({
        conversationId: 'conversation-1',
        requestId: 'conversation-1:request:1',
      }),
    }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.committed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      result: expect.objectContaining({ state: resultState }),
      committed: store.getState(),
    }));
    expect(services.outcomeLifecycle.discarded).not.toHaveBeenCalled();
    expect(store.getState().intakeState).toBe(resultState);
  });

  it('keeps authenticated runtime identity separate from normalized storage ownership', async () => {
    const { params } = baseParams();
    params.ownerId = 'normalized-owner';
    const services = createServices();

    await submitWeeklyPlanningApplicationTurn(params, services);

    expect(services.runtimeGateway.execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
    }));
    expect(services.stagingLifecycle.prepare).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
    }));
    expect(services.outcomeLifecycle.committed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'normalized-owner',
    }));
  });

  it('does not expose a success turn when authoritative preparation fails', async () => {
    const { store, params } = baseParams();
    const failure = new Error('graph finalize failed');
    const resultState = createInitialPlanningIntakeState();
    const services = createServices({
      runtimeGateway: {
        execute: vi.fn(async () => ({
          state: resultState,
          message: '成功しました。',
          draftCandidates: [],
        })),
      },
      stagingLifecycle: {
        prepare: vi.fn(() => { throw failure; }),
        discard: vi.fn(),
      },
    });

    await expect(submitWeeklyPlanningApplicationTurn(params, services)).rejects.toBe(failure);

    expect(services.outcomeLifecycle.committed).not.toHaveBeenCalled();
    expect(store.getState().intakeState).not.toBe(resultState);
    expect(store.getState().messages.some((message) => message.content === '成功しました。')).toBe(false);
    expect(store.getState().pendingTurn).toBeUndefined();
    const messages = store.getState().messages;
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'assistant',
      content: '週間計画の会話状態を更新できませんでした。',
    });
  });

  it('rolls prepared authoritative state back when the conversation commit is rejected', async () => {
    const { store, params } = baseParams();
    const rollback = vi.fn();
    const complete = vi.fn();
    const stagingLifecycle = {
      prepare: vi.fn(() => ({ rollback, complete })),
      discard: vi.fn(),
    };
    const services = createServices({ stagingLifecycle });
    const realDispatch = params.dispatch;
    params.dispatch = (action: WeeklyPlanningAction) => (
      action.type === 'commit_turn' ? store.getState() : realDispatch(action)
    );

    const submission = await submitWeeklyPlanningApplicationTurn(params, services);

    expect(submission.accepted).toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.committed).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.discarded).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'commit_rejected',
    }));
  });

  it('delegates controlled failure cleanup and persistence before rethrowing', async () => {
    const { store, params } = baseParams();
    const failure = new Error('provider unavailable');
    const services = createServices({
      runtimeGateway: {
        execute: vi.fn(async () => { throw failure; }),
      },
    });

    await expect(submitWeeklyPlanningApplicationTurn(params, services)).rejects.toBe(failure);

    expect(services.stagingLifecycle.discard).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:1',
    }));
    expect(services.outcomeLifecycle.discarded).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.failed).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-1',
      userText: '来週の予定を作りたい',
      error: failure,
      failedState: store.getState(),
      assistantMessage: expect.objectContaining({
        role: 'assistant',
        content: '週間計画の会話状態を更新できませんでした。',
      }),
    }));
    expect(store.getState().pendingTurn).toBeUndefined();
  });

  it.each([401, 403] as const)('keeps a %i durable denial as an unsaved consultation and accepts the next turn', async (status) => {
    const { store, params } = baseParams();
    const draft = createWeeklyPlanningTestDraftBlock({ id: 'existing-draft', overrides: { date: '2026-07-27' } });
    const preview = { stableKey: 'existing-preview', date: '2026-07-28', startTime: '18:00', endTime: '19:00',
      durationMinutes: 60, title: '英語', field: '英語', year: 1, estimatedMinutes: 60,
      source: 'weekly_exam_prep' as const, approvalStatus: 'unapproved' as const, workItemKey: 'english:preview' };
    store.dispatch({ type: 'load_state', state: { ...store.getState(), mode: 'awaiting_approval',
      draftBlocks: [draft], previewCandidates: [preview] } });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    const token = vi.fn(async () => 'owner-token');
    const wait = vi.fn(async () => { throw new Error('unexpected retry'); });
    let failure: unknown;
    let attempts = 0;
    const execute: WeeklyPlanningTurnRuntimeGateway['execute'] = vi.fn(async (input) => {
      if (++attempts === 1) {
        const ports: DurableTurnClientPorts = { fetch, token, wait,
          endpoint: 'https://proxy.test/weekly-planning/turns', now: () => Date.parse(input.pending.startedAt) };
        const receipt = { version: 1 as const, ownerId: input.userId, snapshot: input.snapshot,
          pending: input.pending, payload: { input: { userId: input.userId,
            conversationId: input.pending.conversationId, traceRequestId: input.pending.requestId } } };
        try { await executeDurableWeeklyTurn(receipt, { ports }); }
        catch (error) { failure = error; throw error; }
        throw new Error('unexpected durable completion');
      }
      return { state: createInitialPlanningIntakeState(), message: '相談を続けます。', draftCandidates: [] };
    });
    const services = createServices({ runtimeGateway: { execute } });

    await submitWeeklyPlanningApplicationTurn(params, services).catch(() => undefined);
    const state = store.getState();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
    expect(token).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(services.stagingLifecycle.prepare).not.toHaveBeenCalled();
    expect(services.outcomeLifecycle.committed).not.toHaveBeenCalled();
    expect(state.pendingTurn).toBeUndefined();
    expect(state.draftBlocks).toEqual([draft]);
    expect(state.previewCandidates).toEqual([preview]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: params.userText });
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].content).toContain(status === 401 ? '認証' : '権限');
    expect(state.messages[1].content).toContain('保存');
    expect(state.messages[1].content).toContain('承認');
    expect(state.messages[1].content).toContain('再ログイン');
    expect(state.messages[1].content).toContain('相談');
    expect(state.messages[1].content).not.toContain('保存しました');
    expect(failure).toMatchObject({ name: 'WeeklyPlanningDurableAccessDeniedError', status });

    const next = await submitWeeklyPlanningApplicationTurn({ ...params, userText: '続けて相談したい' }, services);
    expect(next.accepted).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    const messages = store.getState().messages;
    expect(messages[messages.length - 1]).toMatchObject({ role: 'assistant', content: '相談を続けます。' });
  });

  it.each(['signed_out', 'different_owner'] as const)('keeps %s unsaved and resumes transport only after the same owner logs in', async (authState) => {
    const { store, params } = baseParams();
    const draft = createWeeklyPlanningTestDraftBlock({ id: 'owner-draft', overrides: { date: '2026-07-27' } });
    const preview = { stableKey: 'owner-preview', date: '2026-07-28', startTime: '18:00', endTime: '19:00',
      durationMinutes: 60, title: '英語', field: '英語', year: 1, estimatedMinutes: 60,
      source: 'weekly_exam_prep' as const, approvalStatus: 'unapproved' as const, workItemKey: 'english:owner-preview' };
    store.dispatch({ type: 'load_state', state: { ...store.getState(), mode: 'awaiting_approval',
      draftBlocks: [draft], previewCandidates: [preview] } });
    const getIdToken = vi.fn(async () => 'owner-token');
    const getAuth = vi.spyOn(firebaseClient, 'getFirebaseAuth').mockReturnValue(authState === 'signed_out' ? null : {
      currentUser: { uid: 'another-owner', getIdToken },
    } as unknown as ReturnType<typeof firebaseClient.getFirebaseAuth>);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network request'));
    let failure: unknown;
    const execute: WeeklyPlanningTurnRuntimeGateway['execute'] = vi.fn(async (input) => {
      const receipt = { version: 1 as const, ownerId: input.userId, snapshot: input.snapshot,
        pending: input.pending, payload: { input: { userId: input.userId,
          conversationId: input.pending.conversationId, traceRequestId: input.pending.requestId } } };
      try {
        const completed = await executeDurableWeeklyTurn(receipt, { isCurrent: input.isCurrentTurn });
        return completed.result;
      } catch (error) { failure = error; throw error; }
    });
    const services = createServices({ runtimeGateway: { execute } });
    try {
      await submitWeeklyPlanningApplicationTurn(params, services).catch(() => undefined);
      const state = store.getState();
      expect(getAuth).toHaveBeenCalledTimes(1);
      expect(getIdToken).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(services.stagingLifecycle.prepare).not.toHaveBeenCalled();
      expect(services.outcomeLifecycle.committed).not.toHaveBeenCalled();
      expect(state.pendingTurn).toBeUndefined();
      expect(state.draftBlocks).toEqual([draft]);
      expect(state.previewCandidates).toEqual([preview]);
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toMatchObject({ role: 'user', content: params.userText });
      expect(state.messages[1].role).toBe('assistant');
      expect(state.messages[1].content).toContain('ログイン状態');
      expect(state.messages[1].content).toContain('保存');
      expect(state.messages[1].content).toContain('承認');
      expect(state.messages[1].content).toContain('同じアカウント');
      expect(state.messages[1].content).toContain('相談');
      expect(state.messages[1].content).not.toContain('保存しました');
      expect(failure).toMatchObject({ name: 'WeeklyPlanningDurableOwnerMismatchError' });

      getAuth.mockReturnValue({ currentUser: { uid: params.ownerId, getIdToken } } as unknown as ReturnType<typeof firebaseClient.getFirebaseAuth>);
      fetch.mockImplementation(async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        return Response.json({ status: 'completed', identity: { ownerId: params.ownerId,
          conversationId: request.conversationId, requestId: request.requestId,
          baseRevision: request.baseRevision, startedAt: request.startedAt }, result: JSON.stringify({
          result: { state: createInitialPlanningIntakeState(), message: '同じ会話で相談を続けます。', draftCandidates: [] },
          stagedContextFacts: [], observedDate: '2026-07-27',
        }) });
      });
      const next = await submitWeeklyPlanningApplicationTurn({ ...params, userText: '相談を続けたい' }, services);
      expect(next.accepted).toBe(true);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(getIdToken).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer owner-token' } });
      const messages = store.getState().messages;
      expect(messages[messages.length - 1]).toMatchObject({ role: 'assistant', content: '同じ会話で相談を続けます。' });
    } finally {
      fetch.mockRestore();
      getAuth.mockRestore();
    }
  });

  it.each(['cancel', 'owner_change', 'revision_change'])('passes a live recovery guard that closes after %s', async (change) => {
    const { params, store } = baseParams();
    const services = createServices();
    let before: boolean | undefined;
    let after: boolean | undefined;
    services.runtimeGateway.execute = async (input) => {
      before = input.isCurrentTurn?.();
      if (change === 'cancel') store.dispatch({ type: 'cancel_turn', pending: input.pending });
      if (change === 'owner_change') params.session.ownerId = 'other-user';
      if (change === 'revision_change') store.dispatch({ type: 'load_state',
        state: { ...store.getState(), revision: store.getState().revision + 1 } });
      after = input.isCurrentTurn?.();
      return { state: createInitialPlanningIntakeState(), message: '終了', draftCandidates: [] };
    };
    await submitWeeklyPlanningApplicationTurn(params, services);
    expect(before).toBe(true);
    expect(after).toBe(false);
  });

});
