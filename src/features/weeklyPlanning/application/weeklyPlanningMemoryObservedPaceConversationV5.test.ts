import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actual, Plan } from '../../../types/domain';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  clearWeeklyPlanningMemoryPaceRuntimeV5,
  setWeeklyPlanningMemoryPaceRuntimeV5,
} from '../personalization/weeklyPlanningMemoryPaceRuntimeV5';
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

import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';

const ownerId = 'owner-memory-returning';

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

function memoryDocument(): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = '英単語220語を覚える';
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window', kind: 'absolute', value: '2026-08-17/2026-08-23',
      start: '2026-08-17', end: '2026-08-23', sourceText: '来週',
    },
    tasks: [{
      localId: 'task', category: 'study', title: '英単語', sourceText,
      study: {
        purpose: 'self_study', activityKind: 'memorization_retrieval',
        contextLabel: '英単語', components: [],
      },
      workloads: [{
        localId: 'workload', quantityRole: 'target', amount: 220,
        unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText,
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [],
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function decisionDocument(proposalId: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [],
    decisions: [{
      localId: 'decision', target: { kind: 'proposal', publicId: proposalId, localId: null, mention: null },
      decision: 'accept', sourceText: 'それで',
    }],
  };
}

function durationDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss', planningWindow: null,
    tasks: [{
      localId: 'answer-task', category: 'study', title: '直前の質問対象', study: null,
      workloads: [],
      effortEstimates: [{
        localId: 'answer-effort', targetLocalId: 'answer-task', kind: 'total_duration',
        minutes: 20, unitCode: null, precision: 'approximate', sourceText: '20分くらい',
      }],
      temporalConstraints: [], recurrence: [], sourceText: '20分くらい',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function historicalPlan(): Plan {
  return {
    id: 'historical-plan', seriesId: 'historical-plan', userId: ownerId,
    title: '暗記ペース計測', subject: '英語', date: '2026-08-10',
    startTime: '09:00', endTime: '09:20', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    weeklyPlanningObservationSource: {
      version: 1, kind: 'memory_pace_calibration', activityKind: 'memorization_retrieval',
      conversationId: 'old-conversation', graphRevision: 4, taskId: 'old-task',
      workloadFactId: 'old-workload', sessionEffortFactId: 'old-session-effort',
      unitCode: 'word', unitLabel: '語', targetAmount: 220, plannedSessionMinutes: 20,
    },
  };
}

function historicalActual(): Actual {
  return {
    id: 'historical-actual', userId: ownerId, planId: 'historical-plan',
    occurrenceDate: '2026-08-10', actualStartTime: '09:00', actualEndTime: '09:20',
    subject: '英語', isAlignedToPlan: true, note: '', updatedAt: '2026-08-10T10:00:00.000Z',
    weeklyPlanningObservationResult: {
      version: 1, kind: 'memory_pace_calibration', progressAmount: 35,
      unitCode: 'word', unitLabel: '語',
    },
  };
}

const requestContext = {
  startedAtIso: '2026-08-16T00:00:00.000Z', timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-16', currentTime: '09:00', notBeforeDate: '2026-08-16',
  notBeforeTime: '09:00', weekStartsOn: 'monday' as const,
};

function input(params: {
  conversationId: string;
  requestId: string;
  userText: string;
  previousState?: PlanningIntakeState;
}): ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  return {
    previousState: params.previousState, messages: [], userText: params.userText,
    selectedDate: '2026-08-17', userId: ownerId, plans: [], scheduleTemplates: [],
    conversationId: params.conversationId, traceRequestId: params.requestId, requestContext,
  };
}

function finalize(conversationId: string, requestId: string): void {
  finalizeWeeklyPlanningStableV5RuntimeGraph({ ownerId, conversationId, requestId });
}

describe('Stable V5 returning memorization learner', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningMemoryPaceRuntimeV5(ownerId);
    setWeeklyPlanningMemoryPaceRuntimeV5({
      ownerId, plans: [historicalPlan()], actuals: [historicalActual()],
    });
    normalizeMock.mockReset();
  });

  it('uses observed pace for effort, still asks current session length, and skips cold-start calibration', async () => {
    const conversationId = 'memory-observed-returning';
    normalizeMock.mockResolvedValueOnce(acceptedResult(memoryDocument()));
    const firstId = `${conversationId}:1`;
    const first = await executeWeeklyPlanningStableV5RuntimeTurn(input({
      conversationId, requestId: firstId, userText: '来週、英単語220語を覚えたい',
    }));
    expect(first.draftCandidates).toEqual([]);
    const spacing = first.state.learningStrategyProposalRecords?.find(
      (record) => record.kind === 'spaced_memory_practice',
    );
    expect(spacing?.status).toBe('pending');
    finalize(conversationId, firstId);

    normalizeMock.mockResolvedValueOnce(acceptedResult(decisionDocument(spacing!.id)));
    const secondId = `${conversationId}:2`;
    const second = await executeWeeklyPlanningStableV5RuntimeTurn(input({
      conversationId, requestId: secondId, previousState: first.state, userText: 'それで',
    }));
    expect(second.draftCandidates).toEqual([]);
    expect(second.state.lastQuestionContext?.intent).toBe('session_duration');
    expect(second.state.learningStrategyProposalRecords?.some(
      (record) => record.kind === 'calibrate_memory_pace',
    )).toBe(false);
    finalize(conversationId, secondId);

    normalizeMock.mockResolvedValueOnce(acceptedResult(durationDocument()));
    const third = await executeWeeklyPlanningStableV5RuntimeTurn(input({
      conversationId, requestId: `${conversationId}:3`, previousState: second.state,
      userText: '20分くらい',
    }));
    expect(third.state.learningStrategyProposalRecords?.some(
      (record) => record.kind === 'calibrate_memory_pace',
    )).toBe(false);
    expect(third.state.status).toBe('draft_ready');
    expect(third.draftCandidates).toHaveLength(7);
    const durations = third.draftCandidates.map((candidate) => candidate.durationMinutes);
    expect(durations.filter((duration) => duration === 20)).toHaveLength(6);
    expect(durations.filter((duration) => duration !== 20)).toEqual([6]);
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBe(126);
  });
});
