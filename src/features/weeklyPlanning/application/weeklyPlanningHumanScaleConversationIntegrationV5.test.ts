import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticStudyActivityKindV5,
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
  activityKind?: SemanticStudyActivityKindV5;
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
        ...(params.activityKind ? { activityKind: params.activityKind } : {}),
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

function proposalDecisionDocument(params: {
  proposalId: string;
  decision: 'accept' | 'reject';
}): WeeklyPlanningSemanticDocumentV5 {
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
      localId: 'proposal-decision',
      target: {
        kind: 'proposal',
        publicId: params.proposalId,
        localId: null,
        mention: null,
      },
      decision: params.decision,
      sourceText: params.decision === 'accept' ? 'それでお願いします' : '今回はやめておく',
    }],
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

function observedPacePlanningDocument(): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = '数学のワークは80ページ中30ページ終わっていて、残り50ページを今週進めたいです';
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
      title: '数学のワーク',
      study: {
        purpose: 'self_study',
        contextLabel: '数学のワーク',
        components: [],
      },
      workloads: [
        {
          localId: 'completed-workload',
          quantityRole: 'completed',
          amount: 30,
          unitCode: 'page',
          unitLabel: 'ページ',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText,
        },
        {
          localId: 'remaining-workload',
          quantityRole: 'remaining',
          amount: 50,
          unitCode: 'page',
          unitLabel: 'ページ',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText,
        },
        {
          localId: 'target-workload',
          quantityRole: 'target',
          amount: 50,
          unitCode: 'page',
          unitLabel: 'ページ',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: '2026-08-17〜2026-08-23',
          sourceText,
        },
      ],
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

function candidateSourceFactRefs(candidate: unknown): string[] {
  const metadata = (candidate as { stableV5Metadata?: unknown }).stableV5Metadata;
  if (typeof metadata !== 'object' || metadata === null) return [];
  const sourceFactRefs = (metadata as { sourceFactRefs?: unknown }).sourceFactRefs;
  return Array.isArray(sourceFactRefs)
    ? sourceFactRefs.filter((value): value is string => typeof value === 'string')
    : [];
}

describe('Stable V5 human-scale conversation integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('proposes spaced memory practice before asking for a duration', async () => {
    const conversationId = 'conversation-memory-proposal';
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningDocument({
      title: '英単語',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
      sourceText: '英単語220語',
      activityKind: 'memorization_retrieval',
    })));

    const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
      traceRequestId: `${conversationId}:request:1`,
    }));

    expect(first.draftCandidates).toEqual([]);
    expect(first.state.lastQuestionContext?.kind).toBe('options');
    expect(first.state.lastQuestionContext?.intent).toBe('learning_strategy_proposal');
    expect(first.state.learningStrategyProposalRecords).toHaveLength(1);
    expect(first.state.learningStrategyProposalRecords?.[0]).toMatchObject({
      kind: 'spaced_memory_practice',
      status: 'pending',
      suggestedSessionMinutes: { min: 15, max: 30 },
    });
    expect(first.message).toContain('15〜30分');
    expect(first.message).toContain('定着');
    expect(first.message).not.toContain('合計でどれくらい時間');
  });

  it('asks for one-session duration only after the memory strategy is accepted', async () => {
    const conversationId = 'conversation-memory-accepted';
    const firstRequestId = `${conversationId}:request:1`;
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningDocument({
      title: '英単語',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
      sourceText: '英単語220語',
      activityKind: 'memorization_retrieval',
    })));
    const first = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
      traceRequestId: firstRequestId,
    }));
    const proposalId = first.state.learningStrategyProposalRecords?.[0]?.id;
    expect(proposalId).toBeTruthy();
    finalizeWeeklyPlanningStableV5RuntimeGraph({
      ownerId: 'owner-human-scale',
      conversationId,
      requestId: firstRequestId,
    });

    normalizeMock.mockResolvedValueOnce(acceptedResult(proposalDecisionDocument({
      proposalId: proposalId!,
      decision: 'accept',
    })));
    const second = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      conversationId,
      previousState: first.state,
      userText: 'それでお願いします',
      traceRequestId: `${conversationId}:request:2`,
      messages: [
        { id: 'u1', role: 'user', content: '英単語220語を覚える予定を作りたい', createdAt: '2026-08-12T00:00:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-12T00:00:01.000Z' },
      ],
    }));

    expect(second.draftCandidates).toEqual([]);
    expect(second.state.learningStrategyProposalRecords?.[0]).toMatchObject({
      id: proposalId,
      status: 'accepted',
    });
    expect(second.state.lastQuestionContext?.topicId).toBe(
      first.state.learningStrategyProposalRecords?.[0]?.workloadFactId,
    );
    expect(second.state.lastQuestionContext?.intent).toBe('session_duration');
    expect(second.message).toContain('1回');
    expect(second.message).not.toContain('合計でどれくらい時間');
  });

  it('asks for completed duration and derives the remaining preview from observed pace', async () => {
    const { first, second } = await runTwoTurnPlanningConversation({
      conversationId: 'conversation-observed-pace',
      firstUserText: '8月17日から23日で、数学のワークは80ページ中30ページ終わっていて、残り50ページです',
      planningDocument: observedPacePlanningDocument(),
      answerMinutes: 90,
    });

    const completedWorkload = first.stableV5Graph?.workloads.find(
      (workload) => workload.quantityRole === 'completed',
    );
    expect(first.message).toContain('完了した30ページ');
    expect(first.message).toContain('合計でどれくらい時間がかかりましたか');
    expect(first.state.lastQuestionContext?.topicId).toBe(completedWorkload?.id);

    expect(second.state.status).toBe('draft_ready');
    const observedEffort = second.stableV5Graph?.effortEstimates.find(
      (estimate) => estimate.targetFactId === completedWorkload?.id,
    );
    const remainingWorkload = second.stableV5Graph?.workloads.find(
      (workload) => workload.quantityRole === 'remaining',
    );
    expect(observedEffort).toMatchObject({
      targetFactId: completedWorkload?.id,
      kind: 'total_duration',
      minutes: 90,
      unitCode: null,
    });
    const targetWorkload = second.stableV5Graph?.workloads.find(
      (workload) => workload.quantityRole === 'target',
    );
    expect(second.draftCandidates).toHaveLength(2);
    expect(second.draftCandidates.reduce(
      (sum, candidate) => sum + candidate.durationMinutes,
      0,
    )).toBe(150);
    expect(second.draftCandidates.every((candidate) =>
      [completedWorkload?.id, remainingWorkload?.id, targetWorkload?.id, observedEffort?.id].every(
        (factId) => factId && candidateSourceFactRefs(candidate).includes(factId),
      ))).toBe(true);
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