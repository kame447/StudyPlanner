import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
  type SemanticWorkloadUnitCodeV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeExecutor';
import {
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

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

function planningDocument(params: {
  title: string;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  sourceText: string;
}): WeeklyPlanningSemanticDocumentV5 {
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
      title: params.title,
      study: {
        purpose: 'self_study',
        contextLabel: params.title,
        components: [],
      },
      workloads: [{
        localId: 'workload',
        quantityRole: 'target',
        amount: params.amount,
        unitCode: params.unitCode,
        unitLabel: params.unitLabel,
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: params.sourceText,
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: params.sourceText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function durationAnswerDocument(minutes: number): WeeklyPlanningSemanticDocumentV5 {
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
  startedAtIso: '2026-08-12T00:00:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-12',
  currentTime: '09:00',
  notBeforeDate: '2026-08-12',
  notBeforeTime: '09:00',
  weekStartsOn: 'monday' as const,
};

function turnInput(params: {
  conversationId: string;
  userText: string;
  traceRequestId: string;
  previousState?: PlanningIntakeState;
  messages?: ExecuteWeeklyPlanningStableV5RuntimeTurnInput['messages'];
}): ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  return {
    previousState: params.previousState,
    messages: params.messages ?? [],
    userText: params.userText,
    selectedDate: '2026-08-17',
    userId: 'owner-human-scale',
    plans: [],
    scheduleTemplates: [],
    conversationId: params.conversationId,
    traceRequestId: params.traceRequestId,
    requestContext,
  };
}

function finalizeTurn(conversationId: string, requestId: string): void {
  finalizeWeeklyPlanningStableV5RuntimeGraph({
    ownerId: 'owner-human-scale',
    conversationId,
    requestId,
  });
}

describe('Stable V5 human-scale conversation integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('splits 220 vocabulary words into 70/70/80 and previews three independent learning sessions', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningDocument({
      title: '英単語',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
      sourceText: '英単語220語',
    })));
    const firstUserText = '8月17日から23日で英単語220語を覚える予定を作りたい';
    const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId: 'conversation-vocabulary-220',
      userText: firstUserText,
      traceRequestId: 'request-vocabulary-220-1',
    }));

    expect(first.draftCandidates).toEqual([]);
    expect(first.message).toContain('70語・70語・80語');
    expect(first.message).toContain('1回分（70〜80語）');
    expect(first.state.draftGenerationIntent).toBe('user_authorized');
    finalizeTurn('conversation-vocabulary-220', 'request-vocabulary-220-1');

    normalizeMock.mockResolvedValueOnce(acceptedResult(durationAnswerDocument(30)));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId: 'conversation-vocabulary-220',
      previousState: first.state,
      userText: '30分くらい',
      traceRequestId: 'request-vocabulary-220-2',
      messages: [
        { id: 'u1', role: 'user', content: firstUserText, createdAt: '2026-08-12T00:00:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-12T00:00:01.000Z' },
      ],
    }));

    expect(second.state.status).toBe('draft_ready');
    expect(second.draftCandidates.map((candidate) => candidate.title)).toEqual([
      '英単語 70語（1/3）',
      '英単語 70語（2/3）',
      '英単語 80語（3/3）',
    ]);
    expect(second.draftCandidates.map((candidate) => ({
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      durationMinutes: candidate.durationMinutes,
    }))).toEqual([
      { date: '2026-08-17', startTime: '09:00', endTime: '09:30', durationMinutes: 30 },
      { date: '2026-08-17', startTime: '09:40', endTime: '10:10', durationMinutes: 30 },
      { date: '2026-08-17', startTime: '10:20', endTime: '10:50', durationMinutes: 30 },
    ]);
  });

  it('asks for the whole-batch time for 80 vocabulary words and previews one learning block', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningDocument({
      title: '英単語',
      amount: 80,
      unitCode: 'word',
      unitLabel: '語',
      sourceText: '英単語80語',
    })));
    const firstUserText = '8月17日から23日で英単語80語を覚える予定を作りたい';
    const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId: 'conversation-vocabulary-80',
      userText: firstUserText,
      traceRequestId: 'request-vocabulary-80-1',
    }));

    expect(first.message).toContain('80語をまとめて覚えるのに');
    expect(first.message).not.toContain('1語あたり');
    expect(first.state.draftGenerationIntent).toBe('user_authorized');
    finalizeTurn('conversation-vocabulary-80', 'request-vocabulary-80-1');

    normalizeMock.mockResolvedValueOnce(acceptedResult(durationAnswerDocument(35)));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId: 'conversation-vocabulary-80',
      previousState: first.state,
      userText: '35分くらい',
      traceRequestId: 'request-vocabulary-80-2',
      messages: [
        { id: 'u1', role: 'user', content: firstUserText, createdAt: '2026-08-12T00:00:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-12T00:00:01.000Z' },
      ],
    }));

    expect(second.state.status).toBe('draft_ready');
    expect(second.draftCandidates).toHaveLength(1);
    expect(second.draftCandidates[0]).toMatchObject({
      title: '英単語 80語',
      date: '2026-08-17',
      startTime: '09:00',
      endTime: '09:35',
      durationMinutes: 35,
    });
  });

  it('asks per problem for discrete problem workloads and uses that scale in the preview estimate', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningDocument({
      title: '数学',
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      sourceText: '数学40問',
    })));
    const firstUserText = '8月17日から23日で数学40問を進める予定を作りたい';
    const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId: 'conversation-problems-40',
      userText: firstUserText,
      traceRequestId: 'request-problems-40-1',
    }));

    expect(first.message).toContain('1問あたりどれくらい時間がかかりますか');
    expect(first.state.draftGenerationIntent).toBe('user_authorized');
    finalizeTurn('conversation-problems-40', 'request-problems-40-1');

    normalizeMock.mockResolvedValueOnce(acceptedResult(durationAnswerDocument(8)));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId: 'conversation-problems-40',
      previousState: first.state,
      userText: '8分くらい',
      traceRequestId: 'request-problems-40-2',
      messages: [
        { id: 'u1', role: 'user', content: firstUserText, createdAt: '2026-08-12T00:00:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-12T00:00:01.000Z' },
      ],
    }));

    expect(second.state.status).toBe('draft_ready');
    expect(second.draftCandidates).toHaveLength(1);
    expect(second.draftCandidates[0]).toMatchObject({
      title: '数学 40問',
      date: '2026-08-17',
      startTime: '09:00',
      endTime: '14:30',
      durationMinutes: 330,
    });
  });
});
