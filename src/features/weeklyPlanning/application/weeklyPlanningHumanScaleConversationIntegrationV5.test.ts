import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticWorkloadUnitCodeV5,
  type WeeklyPlanningSemanticDocumentV5,
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

async function runTwoTurnPlanningConversation(params: {
  conversationId: string;
  firstUserText: string;
  planningDocument: WeeklyPlanningSemanticDocumentV5;
  answerMinutes: number;
}) {
  normalizeMock.mockResolvedValueOnce(acceptedResult(params.planningDocument));
  const firstRequestId = `${params.conversationId}:request:1`;
  const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
    conversationId: params.conversationId,
    userText: params.firstUserText,
    traceRequestId: firstRequestId,
  }));
  expect(first.state.draftGenerationIntent).toBe('user_authorized');
  finalizeWeeklyPlanningStableV5RuntimeGraph({
    ownerId: 'owner-human-scale',
    conversationId: params.conversationId,
    requestId: firstRequestId,
  });

  normalizeMock.mockResolvedValueOnce(acceptedResult(durationAnswerDocument(params.answerMinutes)));
  const second = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
    conversationId: params.conversationId,
    previousState: first.state,
    userText: `${params.answerMinutes}分くらい`,
    traceRequestId: `${params.conversationId}:request:2`,
    messages: [
      { id: 'u1', role: 'user', content: params.firstUserText, createdAt: '2026-08-12T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-12T00:00:01.000Z' },
    ],
  }));
  return { first, second };
}

function candidateRole(candidate: unknown): {
  sessionRole?: 'learning' | 'review';
  reviewRound?: 1 | 2;
} {
  const metadata = (candidate as { stableV5Metadata?: unknown }).stableV5Metadata;
  return (metadata ?? {}) as {
    sessionRole?: 'learning' | 'review';
    reviewRound?: 1 | 2;
  };
}

describe('Stable V5 human-scale conversation integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('splits 220 vocabulary words into 70/70/80 and carries each batch through two spaced reviews', async () => {
    const { first, second } = await runTwoTurnPlanningConversation({
      conversationId: 'conversation-vocabulary-220',
      firstUserText: '8月17日から23日で英単語220語を覚える予定を作りたい',
      planningDocument: planningDocument({
        title: '英単語',
        amount: 220,
        unitCode: 'word',
        unitLabel: '語',
        sourceText: '英単語220語',
      }),
      answerMinutes: 30,
    });

    expect(first.draftCandidates).toEqual([]);
    expect(first.message).toContain('70語・70語・80語');
    expect(first.message).toContain('1回分（70〜80語）');
    expect(second.state.status).toBe('draft_ready');
    expect(second.message).toContain('9件の仮予定候補');

    const learning = second.draftCandidates.filter(
      (candidate) => candidateRole(candidate).sessionRole === 'learning',
    );
    const reviews = second.draftCandidates.filter(
      (candidate) => candidateRole(candidate).sessionRole === 'review',
    );
    expect(learning.map((candidate) => ({
      title: candidate.title,
      date: candidate.date,
      durationMinutes: candidate.durationMinutes,
    }))).toEqual([
      { title: '英単語 70語（1/3）', date: '2026-08-17', durationMinutes: 30 },
      { title: '英単語 70語（2/3）', date: '2026-08-18', durationMinutes: 30 },
      { title: '英単語 80語（3/3）', date: '2026-08-19', durationMinutes: 30 },
    ]);
    expect(reviews.map((candidate) => ({
      title: candidate.title,
      date: candidate.date,
      durationMinutes: candidate.durationMinutes,
      reviewRound: candidateRole(candidate).reviewRound,
    }))).toEqual([
      { title: '英単語 70語（1/3）・復習1回目', date: '2026-08-18', durationMinutes: 15, reviewRound: 1 },
      { title: '英単語 70語（2/3）・復習1回目', date: '2026-08-19', durationMinutes: 15, reviewRound: 1 },
      { title: '英単語 70語（1/3）・復習2回目', date: '2026-08-20', durationMinutes: 15, reviewRound: 2 },
      { title: '英単語 80語（3/3）・復習1回目', date: '2026-08-20', durationMinutes: 15, reviewRound: 1 },
      { title: '英単語 70語（2/3）・復習2回目', date: '2026-08-21', durationMinutes: 15, reviewRound: 2 },
      { title: '英単語 80語（3/3）・復習2回目', date: '2026-08-22', durationMinutes: 15, reviewRound: 2 },
    ]);
    expect(second.draftCandidates.some((candidate) => candidate.date === '2026-08-23')).toBe(false);
  });

  it('asks for the whole-batch time for 80 vocabulary words and adds shorter spaced reviews', async () => {
    const { first, second } = await runTwoTurnPlanningConversation({
      conversationId: 'conversation-vocabulary-80',
      firstUserText: '8月17日から23日で英単語80語を覚える予定を作りたい',
      planningDocument: planningDocument({
        title: '英単語',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        sourceText: '英単語80語',
      }),
      answerMinutes: 35,
    });

    expect(first.message).toContain('80語をまとめて覚えるのに');
    expect(first.message).not.toContain('1語あたり');
    expect(second.state.status).toBe('draft_ready');
    expect(second.message).toContain('3件の仮予定候補');
    expect(second.draftCandidates.map((candidate) => ({
      title: candidate.title,
      date: candidate.date,
      durationMinutes: candidate.durationMinutes,
      sessionRole: candidateRole(candidate).sessionRole,
      reviewRound: candidateRole(candidate).reviewRound,
    }))).toEqual([
      { title: '英単語 80語', date: '2026-08-17', durationMinutes: 35, sessionRole: 'learning', reviewRound: undefined },
      { title: '英単語 80語・復習1回目', date: '2026-08-18', durationMinutes: 20, sessionRole: 'review', reviewRound: 1 },
      { title: '英単語 80語・復習2回目', date: '2026-08-20', durationMinutes: 15, sessionRole: 'review', reviewRound: 2 },
    ]);
  });

  it('splits a long problem workload into quantity-preserving daily quotas', async () => {
    const { first, second } = await runTwoTurnPlanningConversation({
      conversationId: 'conversation-problems-40',
      firstUserText: '8月17日から23日で数学40問を進める予定を作りたい',
      planningDocument: planningDocument({
        title: '数学',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
        sourceText: '数学40問',
      }),
      answerMinutes: 8,
    });

    expect(first.message).toContain('1問あたりどれくらい時間がかかりますか');
    expect(second.state.status).toBe('draft_ready');
    expect(second.message).toContain('5件の仮予定候補');
    expect(second.draftCandidates.map((candidate) => ({
      title: candidate.title,
      date: candidate.date,
      durationMinutes: candidate.durationMinutes,
    }))).toEqual([
      { title: '数学 8問（1〜8問）', date: '2026-08-17', durationMinutes: 70 },
      { title: '数学 8問（9〜16問）', date: '2026-08-18', durationMinutes: 65 },
      { title: '数学 8問（17〜24問）', date: '2026-08-19', durationMinutes: 65 },
      { title: '数学 8問（25〜32問）', date: '2026-08-20', durationMinutes: 65 },
      { title: '数学 8問（33〜40問）', date: '2026-08-21', durationMinutes: 65 },
    ]);
    expect(second.draftCandidates.reduce(
      (sum, candidate) => sum + candidate.durationMinutes,
      0,
    )).toBe(330);
  });
});
