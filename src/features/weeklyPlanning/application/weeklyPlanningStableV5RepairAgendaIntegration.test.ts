import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

function documentWithSoftPreferenceUncertainty(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: {
      localId: 'window', kind: 'absolute', value: '2026-08-17',
      start: '2026-08-17', end: '2026-08-23', sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 'task-math', category: 'study', title: '数学',
      study: { purpose: 'homework', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math', quantityRole: 'target', amount: 30,
        unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '数学30ページ',
      }],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'pref-night', targetLocalId: 'task-math', kind: 'preferred_window',
        constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night',
        startTime: null, endTime: null, precision: 'unspecified', sourceText: 'できれば夜がいい',
      }],
      recurrence: [], sourceText: '数学30ページ、できれば夜がいい',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [{
      localId: 'uncertainty-night', targetLocalId: 'pref-night',
      field: 'preferred_time_precision',
      reason: 'The soft preference has no exact clock bounds.',
      sourceText: 'できれば夜がいい',
    }],
    corrections: [], decisions: [],
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
      attemptCount: 1, repairAttempted: false, requestBytes: [100], responseLengths: [100],
      latencyMs: 1, validationErrors: [], algorithmicRepairs: [], providerError: null,
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
  startedAtIso: '2026-08-11T05:55:00.000Z', timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-11', currentTime: '14:55', notBeforeDate: '2026-08-11',
  notBeforeTime: '14:55', weekStartsOn: 'monday' as const,
};

describe('Stable V5 repair agenda runtime integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('passes over a soft preference uncertainty while asking for required effort', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(documentWithSoftPreferenceUncertainty()));

    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined, messages: [],
      userText: '8月17日から23日で数学30ページ。できれば夜がいい',
      selectedDate: '2026-09-10', userId: 'owner-1', plans: [], scheduleTemplates: [],
      conversationId: 'conversation-repair', traceRequestId: 'request-repair-1', requestContext,
    });

    expect(result.state.lastQuestionContext).toMatchObject({
      targetSlot: 'stable_v5:missing_effort_estimate',
      intent: 'duration_per_unit',
    });
    expect(result.message).not.toContain('意味を一つに決められません');
    expect(result.state.repairAgenda).toEqual([
      expect.objectContaining({
        domain: 'semantic_uncertainty',
        impact: 'low',
        status: 'deferred',
        reopenBefore: 'preview',
      }),
    ]);
  });
});
