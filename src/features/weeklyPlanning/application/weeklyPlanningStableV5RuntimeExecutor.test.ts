import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({
  normalizeMock: vi.fn(),
}));

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-27',
      start: '2026-07-27',
      end: '2026-07-27',
      sourceText: '7月27日',
    },
    tasks: [{
      localId: 'task-1',
      category: 'non_study',
      title: '部屋の掃除',
      study: null,
      workloads: [{
        localId: 'workload-1',
        quantityRole: 'target',
        amount: 60,
        unitCode: 'minute',
        unitLabel: '分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '部屋の掃除を1時間する',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '部屋の掃除を1時間する',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function todayOnlyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-today',
      kind: 'relative_day',
      value: 'today',
      start: null,
      end: null,
      sourceText: '今日',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function acceptedResult(semanticDocument: WeeklyPlanningSemanticDocumentV5) {
  return {
    status: 'accepted' as const,
    document: semanticDocument,
    diagnostics: {
      schemaVersion: 'weekly-planning-semantic-v5' as const,
      jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5' as const,
      attemptCount: 1,
      repairAttempted: false,
      requestBytes: [100],
      responseLengths: [100],
      latencyMs: 1,
      validationErrors: [],
      providerError: null,
    },
  };
}

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    baseUrl: 'https://example.invalid/v1',
    model: 'test-model',
    apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));

vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({
    createChatCompletion: async () => JSON.stringify(document()),
  }),
}));

vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({
    normalize: normalizeMock,
  }),
}));

import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './weeklyPlanningStableV5RuntimeExecutor';

describe('Stable V5 runtime executor', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    normalizeMock.mockReset();
    normalizeMock.mockResolvedValue(acceptedResult(document()));
  });

  it('runs structured semantic normalization through deterministic preview placement', async () => {
    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '7月27日に部屋の掃除を1時間する予定を作って',
      selectedDate: '2026-07-27',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-1',
      traceRequestId: 'request-1',
    });

    expect(result.message).toContain('1件の仮予定候補');
    expect(result.state).toMatchObject({
      status: 'draft_ready',
      shouldCreateDraft: true,
      draftGenerationIntent: 'user_authorized',
    });
    expect(result.draftCandidates).toHaveLength(1);
    expect(result.draftCandidates[0]).toMatchObject({
      date: '2026-07-27',
      startTime: '09:00',
      endTime: '10:00',
      title: '部屋の掃除 60分',
    });

    const events = takeWeeklyPlanningStableV5DebugTrace('request-1');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'runtime_configuration_evaluated' }),
      expect.objectContaining({ stage: 'runtime_session_context_prepared' }),
      expect.objectContaining({ stage: 'runtime_semantic_result_received' }),
      expect.objectContaining({ stage: 'runtime_graph_staged' }),
      expect.objectContaining({
        stage: 'runtime_scheduler_dialogue_evaluated',
        data: expect.objectContaining({
          dialogue: expect.objectContaining({ status: 'ready_for_preview' }),
          authorization: expect.objectContaining({ authorized: true }),
        }),
      }),
      expect.objectContaining({
        stage: 'runtime_preview_scheduler_evaluated',
        data: expect.objectContaining({
          status: 'ready',
          candidateCount: 1,
          unscheduledCount: 0,
        }),
      }),
      expect.objectContaining({
        stage: 'runtime_branch_selected',
        data: expect.objectContaining({ branch: 'preview_ready' }),
      }),
    ]));
  });

  it('accepts 今日 as the planning window and asks for the missing work instead of rejecting normalization', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(todayOnlyDocument()));

    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '今日の計画を立ててください',
      selectedDate: '2026-07-24',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-today',
      traceRequestId: 'request-today',
    });

    expect(result.state).toMatchObject({
      status: 'needs_scope',
      shouldCreateDraft: false,
    });
    expect(result.message).toBe(
      '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
    );
    expect(result.message).not.toContain('構造化結果を安全に採用できませんでした');
    expect(result.draftCandidates).toEqual([]);

    expect(takeWeeklyPlanningStableV5DebugTrace('request-today')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'runtime_branch_selected',
          data: expect.objectContaining({ branch: 'nothing_to_schedule' }),
        }),
      ]),
    );
  });
});
