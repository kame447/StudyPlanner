import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningPendingTurn } from '../types';
import {
  recordCommittedWeeklyPlanningApplicationTurn,
  recordDiscardedWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnSideEffectServices,
} from './weeklyPlanningTurnSideEffects';

const pending: WeeklyPlanningPendingTurn = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:1',
  requestId: 'conversation-1:request:1',
  weekStartDate: '2026-07-27',
  baseRevision: 0,
  startedAt: '2026-07-30T00:00:00.000Z',
};

const rendererTrace: WeeklyPlanningDialogueRendererTrace = {
  actionId: 'stable-v5:conversation-1:request:1:status',
  actionKind: 'status',
  questionCode: null,
  request: {
    purpose: 'weekly_planning_renderer',
    requiredLabels: [],
    fallbackText: '条件を整理しました。',
    previewCount: 0,
  },
  response: {
    status: 'rendered',
    reason: null,
    rawResponse: '{"actionId":"stable-v5:conversation-1:request:1:status","text":"整理できました。"}',
    renderedText: '整理できました。',
  },
  decision: {
    branch: 'ai_rendered',
    responseSource: 'ai',
    finalMessage: '整理できました。',
  },
};

function createServices() {
  const recordTurnTrace = vi.fn<WeeklyPlanningTurnSideEffectServices['recordTurnTrace']>(
    async () => undefined,
  );
  const services: WeeklyPlanningTurnSideEffectServices = {
    isStableV5Enabled: vi.fn(() => true),
    hasStagedGraph: vi.fn(() => true),
    finalizeRuntimeGraph: vi.fn(),
    discardStagedGraph: vi.fn(),
    getRuntimeSession: vi.fn(() => ({
      ownerId: 'owner-1',
      weekStartDate: '2026-07-27',
      conversationId: 'conversation-1',
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      updatedAt: Date.parse('2026-07-30T00:00:00.000Z'),
    })),
    recordTurnTrace,
  };
  return { recordTurnTrace, services };
}

function executionResult(trace: WeeklyPlanningDialogueRendererTrace = rendererTrace) {
  return {
    state: {
      ...createInitialPlanningIntakeState(),
      status: 'revision_pending' as const,
    },
    message: '整理できました。',
    draftCandidates: [],
    responseSource: 'ai' as const,
    dialogueRendererTrace: trace,
  };
}

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
});

describe('weeklyPlanningTurnSideEffects renderer trace', () => {
  it('forwards the adopted renderer trace with the committed turn', async () => {
    const { recordTurnTrace, services } = createServices();

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'owner-1',
      pending,
      userText: '予定を作りたい',
      result: executionResult(),
    }, services);

    expect(recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      responseSource: 'ai',
      dialogueRendererTrace: rendererTrace,
      assistantMessage: '整理できました。',
      outcome: 'revision_pending',
    }));
  });

  it('bounds renderer details and removes duplicated renderer debug stages before outbox storage', async () => {
    const { recordTurnTrace, services } = createServices();
    const largeTrace: WeeklyPlanningDialogueRendererTrace = {
      ...rendererTrace,
      response: {
        ...rendererTrace.response,
        rawResponse: 'あ'.repeat(20_000),
      },
    };
    beginWeeklyPlanningStableV5DebugTrace(pending.requestId);
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'dialogue_renderer_request',
      data: { input: largeTrace.request },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'dialogue_renderer_response',
      data: { rawResponse: largeTrace.response.rawResponse },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'dialogue_renderer_decision',
      data: { branch: 'ai_rendered' },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: pending.requestId,
      stage: 'turn_executor_result_projected',
      data: {
        branch: 'no_recorded_failure',
        projectedResult: executionResult(largeTrace),
      },
    });

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'owner-1',
      pending,
      userText: '予定を作りたい',
      result: executionResult(largeTrace),
    }, services);

    const recorded = recordTurnTrace.mock.calls[0]?.[0];
    expect(recorded?.dialogueRendererTrace?.response.rawResponse).toContain('[trace truncated]');
    const persistedStages = recorded?.debugTraceEvents?.map((event) => event.stage) ?? [];
    expect(persistedStages).not.toEqual(expect.arrayContaining([
      'dialogue_renderer_request',
      'dialogue_renderer_response',
      'dialogue_renderer_decision',
    ]));
    const projection = recorded?.debugTraceEvents?.find(
      (event) => event.stage === 'turn_executor_result_projected',
    );
    const projectedResult = projection?.data && typeof projection.data === 'object'
      ? (projection.data as Record<string, unknown>).projectedResult
      : null;
    expect(projectedResult).not.toEqual(expect.objectContaining({
      dialogueRendererTrace: expect.anything(),
    }));
  });

  it('keeps attempted renderer diagnostics for a stale result without persisting assistant output', async () => {
    const { recordTurnTrace, services } = createServices();

    await recordDiscardedWeeklyPlanningApplicationTurn({
      ownerId: 'owner-1',
      pending,
      userText: '予定を作りたい',
      result: executionResult(),
      reason: 'stale',
    }, services);

    expect(recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      responseSource: 'system',
      dialogueRendererTrace: rendererTrace,
      outcome: 'discarded_stale',
      errorCode: 'stale_async_result_discarded',
    }));
    expect(recordTurnTrace).toHaveBeenCalledWith(expect.not.objectContaining({
      assistantMessage: expect.anything(),
    }));
  });
});
