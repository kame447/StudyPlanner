import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

function nextWeekOnlyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-next-week',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    },
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function workOnlyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: { purpose: 'school', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math', quantityRole: 'target', amount: 30,
        unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '数学30ページ',
      }],
      effortEstimates: [{
        localId: 'effort-math', targetLocalId: 'workload-math', kind: 'total_duration',
        minutes: 60, unitCode: null, precision: 'approximate', sourceText: '1時間くらい',
      }],
      temporalConstraints: [], recurrence: [], sourceText: '数学30ページを1時間くらい',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function acceptedResult(document: WeeklyPlanningSemanticDocumentV5) {
  return {
    status: 'accepted' as const,
    document,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5' as const,
      attemptCount: 1,
      repairAttempted: false,
      requestBytes: [100],
      responseLengths: [100],
      latencyMs: 1,
      validationErrors: [],
      algorithmicRepairs: [],
      providerError: null,
    },
  };
}

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test-model', apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5RuntimeExecutor';

const requestContext = {
  startedAtIso: '2026-08-11T05:55:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-11',
  currentTime: '14:55',
  notBeforeDate: '2026-08-11',
  notBeforeTime: '14:55',
  weekStartsOn: 'monday' as const,
};

describe('Stable V5 planning-window grounding integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('shows the absolute interpretation of next week while moving on to the task question', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(nextWeekOnlyDocument()));

    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を立てたい',
      selectedDate: '2026-09-10',
      userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding', traceRequestId: 'request-grounding-1',
      requestContext,
    });

    expect(result.message).toContain('8月17日〜23日');
    expect(result.message).toContain('教えてください');
    expect(result.state.groundingRecords).toEqual([
      expect.objectContaining({
        status: 'proposed', targetFactId: expect.any(String),
        startDate: '2026-08-17', endDate: '2026-08-23',
      }),
    ]);
  });

  it('treats a relevant answer to the projected task question as continuation acceptance', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(nextWeekOnlyDocument()));
    const first = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '来週の予定を立てたい', selectedDate: '2026-09-10',
      userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding', traceRequestId: 'request-grounding-1',
      requestContext,
    });
    finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: 'owner-1', conversationId: 'conversation-grounding', requestId: 'request-grounding-1',
    });

    normalizeMock.mockResolvedValueOnce(acceptedResult(workOnlyDocument()));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: first.state,
      messages: [
        { id: 'u1', role: 'user', content: '来週の予定を立てたい', createdAt: '2026-08-11T05:55:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-11T05:55:01.000Z' },
      ],
      userText: '数学30ページを1時間くらい', selectedDate: '2026-09-10',
      userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-grounding', traceRequestId: 'request-grounding-2',
      requestContext,
    });

    expect(second.state.groundingRecords).toEqual([
      expect.objectContaining({
        status: 'continuation_accepted',
        acceptedAtTurnId: 'request-grounding-2',
      }),
    ]);
  });
});
