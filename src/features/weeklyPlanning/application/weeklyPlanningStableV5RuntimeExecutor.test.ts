import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

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
    normalize: async () => ({
      status: 'accepted',
      document: document(),
      diagnostics: {
        schemaVersion: 'weekly-planning-semantic-v5',
        jsonSchemaName: 'weekly_planning_semantic_document_v5',
        normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
        attemptCount: 1,
        repairAttempted: false,
        requestBytes: [100],
        responseLengths: [100],
        latencyMs: 1,
        validationErrors: [],
        providerError: null,
      },
    }),
  }),
}));

import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './weeklyPlanningStableV5RuntimeExecutor';

describe('Stable V5 runtime executor', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
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
  });
});
