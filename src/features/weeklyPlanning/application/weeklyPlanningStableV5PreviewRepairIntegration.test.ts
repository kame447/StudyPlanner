import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeExecutor';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

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

function initialPreviewDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window',
      kind: 'absolute',
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
      sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: { purpose: 'homework', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math',
        quantityRole: 'target',
        amount: 30,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学30ページ',
      }],
      effortEstimates: [{
        localId: 'effort-math',
        targetLocalId: 'workload-math',
        kind: 'duration_per_unit',
        minutes: 5,
        unitCode: 'page',
        precision: 'approximate',
        sourceText: '1ページ5分くらい',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学30ページ。1ページ5分くらい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function addedTaskMissingEffortDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-english',
      category: 'study',
      title: '英単語',
      study: { purpose: 'self_study', contextLabel: '英単語', components: [] },
      workloads: [{
        localId: 'workload-english',
        quantityRole: 'target',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '英単語80語',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英単語80語も追加',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function incompatiblePendingReplyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
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
  createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';

const requestContext = {
  startedAtIso: '2026-08-11T05:55:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-11',
  currentTime: '14:55',
  notBeforeDate: '2026-08-11',
  notBeforeTime: '14:55',
  weekStartsOn: 'monday' as const,
};

function turnInput(
  overrides: Pick<
    ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
    'userText' | 'traceRequestId' | 'previousState'
  >,
): ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  return {
    messages: [],
    selectedDate: '2026-08-17',
    userId: 'owner-preview-repair',
    plans: [],
    scheduleTemplates: [],
    conversationId: 'conversation-preview-repair',
    requestContext,
    ...overrides,
  };
}

describe('Stable V5 repair-safe preview integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('keeps the previous preview visible but non-promotable across unresolved repair turns', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(initialPreviewDocument()));
    const initial = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      userText: '8月17日から23日で数学30ページ。1ページ5分くらいで予定を作って',
      traceRequestId: 'request-preview-repair-1',
    }));

    expect(initial.draftCandidates.length).toBeGreaterThan(0);
    expect(initial.state.status).toBe('draft_ready');

    normalizeMock.mockResolvedValueOnce(acceptedResult(addedTaskMissingEffortDocument()));
    const repair = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      previousState: initial.state,
      userText: '英単語80語も追加したい',
      traceRequestId: 'request-preview-repair-2',
    }));

    expect(repair.draftCandidates).toEqual([]);
    expect(repair.preserveExistingPreview).toBe(true);
    expect(repair.state.status).toBe('revision_pending');
    expect(repair.state.shouldCreateDraft).toBe(false);
    expect(repair.state.draftGenerationIntent).toBe('user_authorized');
    expect(repair.state.questions.length).toBe(1);

    normalizeMock.mockResolvedValueOnce(acceptedResult(incompatiblePendingReplyDocument()));
    const stillRepairing = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      previousState: repair.state,
      userText: 'ちょっと待って',
      traceRequestId: 'request-preview-repair-3',
    }));

    expect(stillRepairing.draftCandidates).toEqual([]);
    expect(stillRepairing.preserveExistingPreview).toBe(true);
    expect(stillRepairing.state.status).toBe('revision_pending');
    expect(stillRepairing.state.shouldCreateDraft).toBe(false);
  });
});