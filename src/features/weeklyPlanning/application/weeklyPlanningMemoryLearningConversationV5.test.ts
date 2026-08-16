import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeExecutor';
import {
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

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

function memoryPlanningDocument(): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = '英単語220語を覚える';
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
      localId: 'task',
      category: 'study',
      title: '英単語',
      study: {
        purpose: 'self_study',
        activityKind: 'memorization_retrieval',
        contextLabel: '英単語',
        components: [],
      },
      workloads: [{
        localId: 'workload',
        quantityRole: 'target',
        amount: 220,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText,
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function decisionDocument(proposalId: string, sourceText: string): WeeklyPlanningSemanticDocumentV5 {
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
    decisions: [{
      localId: `decision-${proposalId}`,
      target: {
        kind: 'proposal',
        publicId: proposalId,
        localId: null,
        mention: null,
      },
      decision: 'accept',
      sourceText,
    }],
  };
}

function durationDocument(minutes: number): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: null,
      workloads: [],
      effortEstimates: [{
        localId: 'answer-effort',
        targetLocalId: 'answer-task',
        kind: 'total_duration',
        minutes,
        unitCode: null,
        precision: 'approximate',
        sourceText: `${minutes}分くらい`,
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: `${minutes}分くらい`,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const requestContext = {
  startedAtIso: '2026-08-15T09:00:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-15',
  currentTime: '18:00',
  notBeforeDate: '2026-08-15',
  notBeforeTime: '18:00',
  weekStartsOn: 'monday' as const,
};

function turnInput(params: {
  conversationId: string;
  userText: string;
  requestId: string;
  previousState?: PlanningIntakeState;
  messages?: ExecuteWeeklyPlanningStableV5RuntimeTurnInput['messages'];
}): ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  return {
    previousState: params.previousState,
    messages: params.messages ?? [],
    userText: params.userText,
    selectedDate: '2026-08-17',
    userId: 'owner-memory-integration',
    plans: [],
    scheduleTemplates: [],
    conversationId: params.conversationId,
    traceRequestId: params.requestId,
    requestContext,
  };
}

function finalize(conversationId: string, requestId: string): void {
  finalizeWeeklyPlanningStableV5RuntimeGraph({
    ownerId: 'owner-memory-integration',
    conversationId,
    requestId,
  });
}

describe('Stable V5 adaptive memory conversation', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('previews only one accepted pace-calibration session before full-scope estimation exists', async () => {
    const conversationId = 'memory-calibration-flow';

    normalizeMock.mockResolvedValueOnce(acceptedResult(memoryPlanningDocument()));
    const firstRequestId = `${conversationId}:1`;
    const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      requestId: firstRequestId,
      userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
    }));
    expect(first.draftCandidates).toEqual([]);
    const spacing = first.state.learningStrategyProposalRecords?.find(
      (record) => record.kind === 'spaced_memory_practice',
    );
    expect(spacing?.status).toBe('pending');
    finalize(conversationId, firstRequestId);

    normalizeMock.mockResolvedValueOnce(acceptedResult(decisionDocument(
      spacing!.id,
      'それでお願いします',
    )));
    const secondRequestId = `${conversationId}:2`;
    const second = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      requestId: secondRequestId,
      previousState: first.state,
      userText: 'それでお願いします',
    }));
    expect(second.draftCandidates).toEqual([]);
    expect(second.state.lastQuestionContext?.intent).toBe('session_duration');
    finalize(conversationId, secondRequestId);

    normalizeMock.mockResolvedValueOnce(acceptedResult(durationDocument(20)));
    const thirdRequestId = `${conversationId}:3`;
    const third = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      requestId: thirdRequestId,
      previousState: second.state,
      userText: '20分くらいがいいです',
    }));
    expect(third.draftCandidates).toEqual([]);
    const calibration = third.state.learningStrategyProposalRecords?.find(
      (record) => record.kind === 'calibrate_memory_pace',
    );
    expect(calibration).toMatchObject({
      status: 'pending',
      selectedSessionMinutes: 20,
    });
    const originalWorkloadId = spacing!.workloadFactId;
    expect(third.stableV5Graph?.effortEstimates).toEqual([
      expect.objectContaining({
        targetFactId: originalWorkloadId,
        kind: 'session_duration',
        minutes: 20,
      }),
    ]);
    expect(third.stableV5Graph?.effortEstimates.some((estimate) =>
      estimate.targetFactId === originalWorkloadId && estimate.kind === 'total_duration')).toBe(false);
    finalize(conversationId, thirdRequestId);

    normalizeMock.mockResolvedValueOnce(acceptedResult(decisionDocument(
      calibration!.id,
      'まずそれで試したいです',
    )));
    const fourth = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      requestId: `${conversationId}:4`,
      previousState: third.state,
      userText: 'まずそれで試したいです',
    }));

    expect(fourth.state.status).toBe('draft_ready');
    expect(fourth.draftCandidates).toHaveLength(1);
    expect(fourth.draftCandidates[0]).toMatchObject({
      durationMinutes: 20,
    });
    expect(fourth.draftCandidates[0].title).toContain('ペース計測');
    expect(fourth.draftCandidates[0].title).not.toContain('220語');
    expect(fourth.stableV5Graph?.workloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: originalWorkloadId,
          amount: 220,
          unitCode: 'word',
        }),
      ]),
    );
    expect(fourth.stableV5Graph?.effortEstimates.some((estimate) =>
      estimate.targetFactId === originalWorkloadId && estimate.kind === 'total_duration')).toBe(false);
  });
});
