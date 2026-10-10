import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { hydrateWeeklyPlanningStableV5RuntimeSession } from './weeklyPlanningStableV5RuntimeSession';
import { loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { takeWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession, WeeklyPlanningTraceEntry } from '../trace/weeklyPlanningTraceTypes';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { resolveWeeklyPlanningQuestionPresentationFreshness, withoutWeeklyPlanningQuestionPresentation } from '../intake/weeklyPlanningQuestionPresentation';
import { createPresentedWeeklyPlanningConversation } from '../testUtils/__tests__/weeklyPlanningPresentedConversation';
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
  getWeeklyPlanningStableV5RuntimeSession,
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

function directionalDurationAnswerDocument(params: {
  minutes: number;
  quantityRole: 'completed' | 'remaining';
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
}): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = `${params.minutes}分くらい`;
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: null,
      workloads: [{
        localId: 'answer-directional-workload',
        quantityRole: params.quantityRole,
        amount: params.amount,
        unitCode: params.unitCode,
        unitLabel: params.unitLabel,
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText,
      }],
      effortEstimates: [{
        localId: 'answer-effort',
        targetLocalId: 'answer-directional-workload',
        kind: 'total_duration',
        minutes: params.minutes,
        unitCode: null,
        precision: 'approximate',
        sourceText,
      }],
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

let conversation: ReturnType<typeof createPresentedWeeklyPlanningConversation>;

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
  answerDirection?: {
    quantityRole: 'completed' | 'remaining';
    amount: number;
    unitCode: SemanticWorkloadUnitCodeV5;
    unitLabel: string;
  };
}) {
  normalizeMock.mockResolvedValueOnce(acceptedResult(params.planningDocument));
  const firstRequestId = `${params.conversationId}:request:1`;
  const first = await conversation.run(turnInput({
    conversationId: params.conversationId,
    userText: params.firstUserText,
    traceRequestId: firstRequestId,
  }));
  expect(first.state.draftGenerationIntent).toBe('user_authorized');

  const answerDocument = params.answerDirection
    ? directionalDurationAnswerDocument({
        minutes: params.answerMinutes,
        ...params.answerDirection,
      })
    : durationAnswerDocument(params.answerMinutes);
  normalizeMock.mockResolvedValueOnce(acceptedResult(answerDocument));
  const second = await conversation.run(turnInput({
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


// Validate the provider-shaped document against the runtime's actual public
// state and graph before supplying it to the existing typed normalizer fixture.
function queueValidatedProposalDocument(document: WeeklyPlanningSemanticDocumentV5) {
  normalizeMock.mockImplementationOnce(async (input: WeeklyPlanningSemanticNormalizerInputV5) => {
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
      currentUserText: input.userText,
      supplementalContext: input.supplementalContext,
      selectedStarterTarget: input.selectedStarterTarget,
      recentConversation: input.recentConversation,
      publicStateSummary: input.publicStateSummary,
      committedGraph: input.committedGraph,
    });
    expect(validation.errors).toEqual([]);
    expect(validation.document).not.toBeNull();
    return acceptedResult(validation.document!);
  });
}

async function createFreshProposalAWithPendingB(conversationId: string) {
  queueValidatedProposalDocument(planningDocument({
    title: '英単語', amount: 220, unitCode: 'word', unitLabel: '語',
    sourceText: '英単語220語', activityKind: 'memorization_retrieval',
  }));
  const first = await conversation.run(turnInput({
    conversationId, userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
    traceRequestId: `${conversationId}:create-b`,
  }));
  const proposalB = first.state.learningStrategyProposalRecords?.[0];
  expect(proposalB).toMatchObject({ status: 'pending', decidedAtTurnId: null });
  const secondDocument = planningDocument({
    title: '歴史用語', amount: 80, unitCode: 'word', unitLabel: '語',
    sourceText: '歴史用語80語', activityKind: 'memorization_retrieval',
  });
  secondDocument.planningIntent = 'update_plan';
  secondDocument.planningWindow = null;
  queueValidatedProposalDocument(secondDocument);
  const second = await conversation.run(turnInput({
    conversationId, userText: '歴史用語80語を覚える予定も追加してください',
    traceRequestId: `${conversationId}:create-a`,
  }));
  const records = second.state.learningStrategyProposalRecords ?? [];
  expect(records).toHaveLength(2);
  expect(records.every((record) => record.status === 'pending' && record.decidedAtTurnId === null)).toBe(true);
  const proposalA = records.find((record) => record.id !== proposalB!.id)!;
  expect(proposalA).toBeDefined();
  expect(proposalA.workloadFactId).not.toBe(proposalB!.workloadFactId);
  for (const id of [proposalA.workloadFactId, proposalB!.workloadFactId]) {
    expect(second.stableV5Graph!.factLifecycles.find((entry) => entry.factId === id)?.status).toBe('active');
  }
  const state = conversation.getState();
  expect(resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: state.intakeState, inputStateRevision: state.revision,
    messages: state.messages, graphRevision: second.stableV5Graph!.revision,
  }).status).toBe('fresh');
  expect(state.intakeState?.lastQuestionContext).toMatchObject({
    targetSlot: 'stable_v5:learning_strategy_proposal', actionId: proposalA.id,
    topicId: proposalA.workloadFactId,
  });
  return { proposalA, proposalB: proposalB!, graph: second.stableV5Graph! };
}

function explicitProposalDecisions(ids: string[], sourceText: string): WeeklyPlanningSemanticDocumentV5 {
  const document = proposalDecisionDocument({ proposalId: ids[0], decision: 'accept' });
  document.decisions = ids.map((id, index) => ({
    ...document.decisions[0], localId: `explicit-proposal-${index}`,
    target: { kind: 'proposal', publicId: id, localId: null, mention: null }, sourceText,
  }));
  return document;
}

function proposalTraceRepository() {
  type Write = { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] };
  const attempts: Write[] = [];
  const writes: Write[] = [];
  let failNext = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(write) {
      attempts.push(structuredClone(write));
      if (failNext) { failNext = false; throw new Error('injected proposal trace append failure'); }
      writes.push(structuredClone(write));
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  return { repository, attempts, writes };
}

function proposalTraceInput(params: {
  conversationId: string; requestId: string; userText: string;
  result: Awaited<ReturnType<typeof conversation.run>>;
  events: ReturnType<typeof takeWeeklyPlanningStableV5DebugTrace>;
}) {
  return {
    userId: 'owner-human-scale', conversationId: params.conversationId,
    requestId: params.requestId, userText: params.userText,
    assistantMessage: params.result.message, responseSource: params.result.responseSource,
    outcome: params.result.state.status, previewCount: params.result.draftCandidates.length,
    debugTraceEvents: params.events,
  };
}

// Bounded summaries may retain explicit head/tail fragments instead of an object.
// Match each complete serialized record in a retained fragment, never infer identity
// from separate occurrences of an ID and status or reconstruct omitted bytes.
function expectProposalRecordsInStoredSummary(value: unknown, records: unknown[]) {
  const bounded = value as { traceTruncated?: boolean; jsonHead?: string; jsonTail?: string };
  const fragments = bounded?.traceTruncated
    ? [bounded.jsonHead ?? '', bounded.jsonTail ?? ''] : [JSON.stringify(value)];
  for (const record of records) {
    expect(fragments.some((fragment) => fragment.includes(JSON.stringify(record)))).toBe(true);
  }
}

describe('Stable V5 human-scale conversation integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
    conversation = createPresentedWeeklyPlanningConversation();
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

    const first = await conversation.run(turnInput({
      conversationId,
      userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
      traceRequestId: `${conversationId}:request:1`,
    }));

    expect(first.draftCandidates).toEqual([]);
    expect(first.state.lastQuestionContext?.kind).toBe('options');
    expect(first.state.lastQuestionContext?.intent).toBe('learning_strategy_proposal');
    expect(first.state.learningStrategyProposalRecords).toHaveLength(1);
    const proposal = first.state.learningStrategyProposalRecords?.[0];
    expect(proposal).toMatchObject({
      kind: 'spaced_memory_practice',
      status: 'pending',
      suggestedSessionMinutes: { min: 15, max: 30 },
    });
    expect(first.state.lastQuestionContext?.actionId).toBe(proposal?.id);
    expect(first.state.lastQuestionContext?.topicId).toBe(proposal?.workloadFactId);
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
    const first = await conversation.run(turnInput({
      conversationId,
      userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
      traceRequestId: firstRequestId,
    }));
    const proposalId = first.state.learningStrategyProposalRecords?.[0]?.id;
    expect(proposalId).toBeTruthy();

    normalizeMock.mockResolvedValueOnce(acceptedResult(proposalDecisionDocument({
      proposalId: proposalId!,
      decision: 'accept',
    })));
    const second = await conversation.run(turnInput({
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
    expect(second.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
  });

  it('asks for completed duration and reserves buffer around the observed-pace estimate', async () => {
    const { first, second } = await runTwoTurnPlanningConversation({
      conversationId: 'conversation-observed-pace',
      firstUserText: '8月17日から23日で、数学のワークは80ページ中30ページ終わっていて、残り50ページです',
      planningDocument: observedPacePlanningDocument(),
      answerMinutes: 90,
      answerDirection: {
        quantityRole: 'completed',
        amount: 30,
        unitCode: 'page',
        unitLabel: 'ページ',
      },
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
    )).toBe(165);
    expect(second.draftCandidates.every((candidate) =>
      [completedWorkload?.id, remainingWorkload?.id, targetWorkload?.id, observedEffort?.id].every(
        (factId) => factId && candidateSourceFactRefs(candidate).includes(factId),
      ))).toBe(true);
  });

  it('splits a long problem workload while preserving buffered time and total quantity semantics', async () => {
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
    expect(second.draftCandidates).toHaveLength(6);
    expect(second.draftCandidates.map((candidate) => candidate.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);
    expect(second.draftCandidates.every(
      (candidate) => candidate.durationMinutes === 60,
    )).toBe(true);
    expect(second.draftCandidates.reduce(
      (sum, candidate) => sum + candidate.durationMinutes,
      0,
    )).toBe(360);
  });
  it.each(['unbound', 'stale'] as const)('does not attach a short duration to an %s question', async (presentation) => {
    const conversationId = `human-scale-${presentation}`;
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningDocument({
      title: '数学', amount: 40, unitCode: 'problem', unitLabel: '問', sourceText: '数学40問',
    })));
    const first = await conversation.run(turnInput({
      conversationId, userText: '8月17日から23日で数学40問を進める予定を作りたい', traceRequestId: 'first',
    }));
    const state = conversation.getState();
    const workloadId = first.stableV5Graph!.workloads[0].id;
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: state.intakeState, inputStateRevision: state.revision,
      messages: state.messages, graphRevision: first.stableV5Graph!.revision,
    }).status).toBe('fresh');
    if (presentation === 'unbound') {
      conversation.dispatch({ type: 'load_state', state: { ...state, intakeState: {
        ...state.intakeState!, lastQuestionContext: withoutWeeklyPlanningQuestionPresentation(state.intakeState!.lastQuestionContext),
      } } });
    } else {
      conversation.dispatch({ type: 'set_last_assistant_message', message: '別の案内を表示しました。' });
    }
    normalizeMock.mockResolvedValueOnce(acceptedResult(durationAnswerDocument(8)));
    const second = await conversation.run(turnInput({ conversationId, userText: '8分くらい', traceRequestId: 'second' }));
    expect(normalizeMock.mock.calls[1][0].publicStateSummary.pendingQuestion).toBeNull();
    expect(second.state.status).not.toBe('draft_ready');
    expect(second.draftCandidates).toEqual([]);
    const acceptedGraph = getWeeklyPlanningStableV5RuntimeSession(conversationId)?.graph;
    expect(acceptedGraph).toBeDefined();
    expect(acceptedGraph!.workloads.find((workload) => workload.id === workloadId)).toEqual(first.stableV5Graph!.workloads[0]);
    expect(acceptedGraph!.effortEstimates.filter((effort) => effort.targetFactId === workloadId)).toEqual([]);
  });

  it('accepts the exact fresh displayed proposal A without granting save authority', async () => {
    const conversationId = 'proposal-presentation-positive-a';
    const { proposalA, proposalB } = await createFreshProposalAWithPendingB(conversationId);
    const userText = '今表示された歴史用語の提案を採用します';
    queueValidatedProposalDocument(explicitProposalDecisions([proposalA.id], userText));
    const result = await conversation.run(turnInput({ conversationId, userText, traceRequestId: 'accept-a' }));
    expect(result.state.learningStrategyProposalRecords?.find((record) => record.id === proposalA.id))
      .toMatchObject({ status: 'accepted' });
    expect(result.state.learningStrategyProposalRecords?.find((record) => record.id === proposalB.id))
      .toMatchObject({ status: 'pending', decidedAtTurnId: null });
    expect(result.state.shouldSavePlan).toBe(false);
    expect(result.draftCandidates).toEqual([]);
  });

  it('leaves valid pending B undecided when collective A and B decisions follow fresh displayed A', async () => {
    const conversationId = 'proposal-presentation-collective';
    const { proposalA, proposalB } = await createFreshProposalAWithPendingB(conversationId);
    const userText = '歴史用語と英単語の両方の提案を採用します';
    queueValidatedProposalDocument(explicitProposalDecisions([proposalA.id, proposalB.id], userText));
    const result = await conversation.run(turnInput({ conversationId, userText, traceRequestId: 'accept-collective' }));
    const publicState = normalizeMock.mock.calls[2][0].publicStateSummary;
    expect(publicState.pendingQuestion.actionId).toBe(proposalA.id);
    expect(publicState.learningStrategyProposals.map((record: { publicId: string }) => record.publicId))
      .toEqual(expect.arrayContaining([proposalA.id, proposalB.id]));
    expect(result.state.learningStrategyProposalRecords?.filter((record) => record.status === 'accepted')
      .map((record) => record.id)).toEqual([proposalA.id]);
    expect(result.state.learningStrategyProposalRecords?.find((record) => record.id === proposalB.id))
      .toMatchObject({ status: 'pending', decidedAtTurnId: null });
    expect(result.state.shouldSavePlan).toBe(false);
  });

  it('does not redirect an explicit B-only proposal decision to fresh displayed A or settle B', async () => {
    const conversationId = 'proposal-presentation-explicit-b';
    const { proposalA, proposalB } = await createFreshProposalAWithPendingB(conversationId);
    const userText = '英単語の提案だけ採用します';
    queueValidatedProposalDocument(explicitProposalDecisions([proposalB.id], userText));
    const result = await conversation.run(turnInput({ conversationId, userText, traceRequestId: 'accept-b-only' }));
    const acceptedReading = await normalizeMock.mock.results[2].value;
    expect(acceptedReading.document.decisions.map((decision: { target: { publicId: string } }) => decision.target.publicId))
      .toEqual([proposalB.id]);
    expect(result.state.learningStrategyProposalRecords?.find((record) => record.id === proposalA.id))
      .toMatchObject({ status: 'pending', decidedAtTurnId: null });
    expect(result.state.learningStrategyProposalRecords?.find((record) => record.id === proposalB.id))
      .toMatchObject({ status: 'pending', decidedAtTurnId: null });
    expect(result.state.shouldSavePlan).toBe(false);
  });

  it.each(['unbound', 'stale', 'no_question'] as const)('does not settle a known proposal A through an %s presentation', async (presentation) => {
    const conversationId = `proposal-presentation-${presentation}`;
    const { proposalA, proposalB, graph } = await createFreshProposalAWithPendingB(conversationId);
    const state = conversation.getState();
    if (presentation === 'unbound' || presentation === 'no_question') {
      conversation.dispatch({ type: 'load_state', state: { ...state, intakeState: {
        ...state.intakeState!, lastQuestionContext: presentation === 'no_question' ? undefined
          : withoutWeeklyPlanningQuestionPresentation(state.intakeState!.lastQuestionContext),
      } } });
    } else {
      conversation.dispatch({ type: 'set_last_assistant_message', message: '別の案内を表示しました。' });
    }
    const changedState = conversation.getState();
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: changedState.intakeState, inputStateRevision: changedState.revision,
      messages: changedState.messages, graphRevision: graph.revision,
    }).status).toBe(presentation);
    const userText = '歴史用語の提案を採用します';
    queueValidatedProposalDocument(explicitProposalDecisions([proposalA.id], userText));
    const result = await conversation.run(turnInput({ conversationId, userText, traceRequestId: 'accept-without-freshness' }));
    expect(normalizeMock.mock.calls[2][0].publicStateSummary.pendingQuestion).toBeNull();
    for (const id of [proposalA.id, proposalB.id]) {
      expect(result.state.learningStrategyProposalRecords?.find((record) => record.id === id))
        .toMatchObject({ status: 'pending', decidedAtTurnId: null });
    }
    expect(result.state.shouldSavePlan).toBe(false);
  });

  it.each([false, true])('persists the actual proposal decision and reloaded continuation through outbox and Worker (oversized=%s)', async (oversized) => {
    const conversationId = `weekly-conversation-823e4567-e89b-52d3-a456-42661417400${oversized ? '1' : '0'}`;
    const previousTraceEnabled = import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED;
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const storage = createMemoryStorageHarness();
    const restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
    const harness = proposalTraceRepository();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    try {
      const { proposalA, proposalB } = await createFreshProposalAWithPendingB(conversationId);
      const userText = '歴史用語と英単語の両方の提案を採用します';
      const document = explicitProposalDecisions([proposalA.id, proposalB.id], userText);
      const actual = await vi.importActual<typeof import('../semantic/weeklyPlanningSemanticNormalizerV5')>('../semantic/weeklyPlanningSemanticNormalizerV5');
      const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async () => JSON.stringify(document));
      const normalizer = actual.createWeeklyPlanningSemanticNormalizerV5({ createChatCompletion });
      normalizeMock.mockImplementationOnce((input: WeeklyPlanningSemanticNormalizerInputV5) => normalizer.normalize(input));
      const decided = await conversation.run(turnInput({ conversationId, userText, traceRequestId: 'trace-proposal-decision' }));
      const accepted = await normalizeMock.mock.results[2].value;
      expect(accepted.status).toBe('accepted');
      expect(accepted.document.decisions.map((decision: { target: { publicId: string } }) => decision.target.publicId))
        .toEqual([proposalA.id, proposalB.id]);
      expect(createChatCompletion).toHaveBeenCalledTimes(1);
      expect(decided.state.learningStrategyProposalRecords?.find((record) => record.id === proposalA.id))
        .toMatchObject({ status: 'accepted' });
      expect(decided.state.learningStrategyProposalRecords?.find((record) => record.id === proposalB.id))
        .toMatchObject({ status: 'pending', decidedAtTurnId: null });
      expect(decided.state.shouldSavePlan).toBe(false);
      const decisionRequestId = normalizeMock.mock.calls[2][0].traceRequestId!;
      const decisionEvents = takeWeeklyPlanningStableV5DebugTrace(decisionRequestId);
      const requestEvents = decisionEvents.filter((event) => event.stage === 'semantic_provider_request');
      expect(requestEvents).toHaveLength(1);
      const sentRequest = createChatCompletion.mock.calls[0][0];
      const requestEvent = requestEvents[0].data as {
        requestBytes: number; request: { messages: unknown[]; purpose: string; maxCompletionTokens: number };
      };
      expect(requestEvent).toMatchObject({
        requestBytes: new TextEncoder().encode(JSON.stringify(sentRequest)).byteLength,
        request: { purpose: sentRequest.purpose, maxCompletionTokens: sentRequest.maxCompletionTokens },
      });
      // The last message is this bounded fixture's actual user/context payload.
      expect(requestEvent.request.messages[requestEvent.request.messages.length - 1]).toEqual(sentRequest.messages[sentRequest.messages.length - 1]);
      expect(decisionEvents.some((event) => event.stage === 'semantic_validation_result'
        && (event.data as { accepted?: boolean }).accepted)).toBe(true);
      await recordWeeklyPlanningStableV5TurnTrace(proposalTraceInput({
        conversationId, requestId: decisionRequestId, userText, result: decided, events: decisionEvents,
      }));
      expect(harness.writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toHaveLength(1);

      // The third-turn result is committed locally, saved by the real checkpoint
      // codec, re-read from storage and rehydrated before the fourth turn begins.
      const committed = conversation.getState();
      const committedRecords = structuredClone(committed.intakeState!.learningStrategyProposalRecords);
      expect(saveWeeklyPlanningStableV5PersistedSession({
        ownerId: 'owner-human-scale', weekStartDate: committed.weekStartDate,
        conversationId, graph: decided.stableV5Graph!, planningState: committed,
      })).toBe(true);
      expect(storage.values.size).toBeGreaterThan(0);
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      const restored = loadWeeklyPlanningStableV5PersistedSession({
        ownerId: 'owner-human-scale', weekStartDate: committed.weekStartDate,
      });
      expect(restored).not.toBeNull();
      expect(restored!.planningState.intakeState?.learningStrategyProposalRecords).toEqual(committedRecords);
      expect(restored!.graph).toEqual(decided.stableV5Graph);
      hydrateWeeklyPlanningStableV5RuntimeSession(restored!);
      conversation.dispatch({ type: 'load_state', state: restored!.planningState });

      const continuationText = '状況を確認しました';
      const continuation = proposalDecisionDocument({ proposalId: proposalA.id, decision: 'accept' });
      continuation.decisions = [];
      queueValidatedProposalDocument(continuation);
      const continued = await conversation.run(turnInput({
        conversationId, userText: continuationText, traceRequestId: 'trace-proposal-continuation',
      }));
      expect((await normalizeMock.mock.results[3].value).document.decisions).toEqual([]);
      expect(continued.state.learningStrategyProposalRecords).toEqual(committedRecords);
      expect(continued.state.shouldSavePlan).toBe(false);
      const summary = normalizeMock.mock.calls[3][0].publicStateSummary!;
      const summaryRecords = summary.learningStrategyProposals as Array<{ publicId: string; status: string }>;
      expect(summaryRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({ publicId: proposalA.id, status: 'accepted' }),
        expect.objectContaining({ publicId: proposalB.id, status: 'pending' }),
      ]));
      const continuationRequestId = normalizeMock.mock.calls[3][0].traceRequestId!;
      const continuationEvents = takeWeeklyPlanningStableV5DebugTrace(continuationRequestId);
      const pipelineInput = continuationEvents.find((event) => event.stage === 'semantic_pipeline_input')!;
      expect(pipelineInput).toBeDefined();
      const data = pipelineInput.data as { publicStateSummary: Record<string, unknown> };
      expect(data.publicStateSummary.learningStrategyProposals).toEqual(summaryRecords);
      data.publicStateSummary.futureProposalTraceSentinel = 'proposal-continuation-sentinel';
      if (oversized) data.publicStateSummary.futureLargeValue = 'あ'.repeat(20_000);
      await recordWeeklyPlanningStableV5TurnTrace(proposalTraceInput({
        conversationId, requestId: continuationRequestId, userText: continuationText,
        result: continued, events: continuationEvents,
      }));
      expect(harness.writes).toHaveLength(2);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toEqual([]);
      const firstAttempt = harness.attempts[0].entries[0];
      const replayed = harness.writes[0].entries[0];
      const { observedAt: firstObserved, ...originalContent } = firstAttempt;
      const { observedAt: replayedObserved, ...replayedContent } = replayed;
      expect(replayedContent).toEqual(originalContent);
      expect(Date.parse(replayedObserved!)).toBeGreaterThanOrEqual(Date.parse(firstObserved!));
      const stored = harness.writes.map((write) => {
        expect(write.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(write.entries[0]))
          .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const prepared = prepareWeeklyPlanningTraceServerWrite({
          session: write.session as unknown as Record<string, unknown>,
          entries: write.entries as unknown as Record<string, unknown>[],
        }, { token: `wpt_${'f'.repeat(43)}`, epoch: '105' }, {
          sessionId: conversationId.replace('weekly-conversation-', 'weekly-trace-'),
          logicalConversationId: conversationId,
        }, '2026-10-10T00:00:00.000Z');
        expect(prepared.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0]))
          .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        const serialized = JSON.stringify(prepared.entries[0]);
        expect(serialized).not.toContain('planningStateRevision');
        expect(serialized).not.toContain('assistantMessageId');
        return prepared.entries[0];
      });
      expect(stored[0]).toMatchObject({ requestId: decisionRequestId, aiInterpreter: {
        input: { requests: expect.any(Array) },
        structuredResults: expect.arrayContaining([expect.objectContaining({ accepted: true,
          structuredResult: expect.objectContaining({ decisions: expect.arrayContaining([
            expect.objectContaining({ target: expect.objectContaining({ publicId: proposalA.id }) }),
            expect.objectContaining({ target: expect.objectContaining({ publicId: proposalB.id }) }),
          ]) }),
        })]),
      } });
      const decisionDiagnostic = stored[0] as { aiInterpreter: { input: { requests: unknown[] } } };
      expect(decisionDiagnostic.aiInterpreter.input.requests).toHaveLength(1);
      expect(decisionDiagnostic.aiInterpreter.input.requests[0]).toMatchObject({
        purpose: requestEvent.request.purpose, requestBytes: requestEvent.requestBytes,
        maxCompletionTokens: requestEvent.request.maxCompletionTokens,
      });
      const continuationDiagnostic = stored[1] as { aiInterpreter: { input: { planningStateSummary: unknown } }; diagnostics: { truncation?: { applied: boolean; fields: string[] } } };
      if (oversized) {
        expect(continuationDiagnostic.diagnostics.truncation?.applied).toBe(true);
        expect(continuationDiagnostic.diagnostics.truncation?.fields)
          .toContain('aiInterpreter.input.planningStateSummary');
        expect(JSON.stringify(stored[1])).not.toContain('あ'.repeat(20_000));
      } else {
        expectProposalRecordsInStoredSummary(continuationDiagnostic.aiInterpreter.input.planningStateSummary, summaryRecords);
        expect(JSON.stringify(stored[1])).toContain('proposal-continuation-sentinel');
      }
    } finally {
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      resetWeeklyPlanningStableV5DebugTraceForTest();
      restoreStorage();
      vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', previousTraceEnabled);
    }
  });

});
