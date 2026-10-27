import { withWeeklyPlanningEffortAcknowledgement } from '../testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from '../trace/weeklyPlanningDialogueRendererTrace';
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
import { FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS } from '../semantic/weeklyPlanningFocusedAuthorizationV5';
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

function durationAnswerDocument(minutes: number, kind: 'total_duration' | 'duration_per_unit' | 'session_duration' = 'total_duration', unitCode: SemanticWorkloadUnitCodeV5 | null = null): WeeklyPlanningSemanticDocumentV5 {
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
        kind,
        minutes,
        unitCode,
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
vi.mock('../../../services/ai/openAiCompatibleClient', async () => {
  const { successfulWeeklyPlanningRendererCompletion } = await import(
    '../testUtils/__tests__/weeklyPlanningRendererCompletionFixture'
  );
  return { createOpenAiCompatibleClient: () => ({
    createChatCompletion: successfulWeeklyPlanningRendererCompletion,
  }) };
});
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
    : durationAnswerDocument(params.answerMinutes, first.state.lastQuestionContext!.intent as 'duration_per_unit' | 'session_duration',
      first.stableV5Graph!.workloads.find(work => work.id === first.state.lastQuestionContext!.topicId)!.unitCode);
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

  it('retains a repaired side deadline and asks again for the unresolved effort (#825)', async () => {
    const conversationId = 'compound-repair-retained-deadline';
    const initial = planningDocument({ title: '数学', amount: 20, unitCode: 'problem', unitLabel: '問', sourceText: '数学20問' });
    initial.tasks.push({ ...structuredClone(initial.tasks[0]), localId: 'english', title: '英語', workloads: [], sourceText: '英語' });
    normalizeMock.mockResolvedValueOnce(acceptedResult(initial));
    const first = await conversation.run(turnInput({ conversationId,
      userText: '8月17日から23日で数学20問と英語の予定を作りたい', traceRequestId: 'compound-repair:1' }));
    expect(first.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    const mathWorkloadId = first.stableV5Graph!.workloads.find(work => work.taskId === first.stableV5Graph!.tasks.find(task => task.title === '数学')!.id)!.id;
    expect(first.state.lastQuestionContext?.topicId).toBe(mathWorkloadId);
    const englishId = first.stableV5Graph!.tasks.find(task => task.title === '英語')!.id;

    // The repair boundary can retain this valid update while rejecting the
    // malformed effort contribution; the application must keep that question open.
    const retained: WeeklyPlanningSemanticDocumentV5 = { ...initial, planningIntent: 'update_plan', planningWindow: null,
      tasks: [{ ...initial.tasks[1], existingPublicId: englishId, temporalConstraints: [{
        localId: 'english-deadline', targetLocalId: 'english', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null,
        precision: 'exact', sourceText: '英語の締切を金曜にして',
      }] }] };
    normalizeMock.mockResolvedValueOnce(acceptedResult(retained));
    const second = await conversation.run(turnInput({ conversationId, previousState: first.state,
      userText: '15分。あと英語の締切を金曜にして', traceRequestId: 'compound-repair:2', messages: [
        { id: 'u1', role: 'user', content: '数学20問と英語の予定', createdAt: '2026-08-12T00:00:00.000Z' },
        { id: 'a1', role: 'assistant', content: first.message, createdAt: '2026-08-12T00:00:01.000Z' },
      ] }));
    expect(second.stableV5Graph!.temporalConstraints).toContainEqual(expect.objectContaining({
      taskId: englishId, kind: 'deadline', dateExpression: 'weekday:friday',
    }));
    expect(second.stableV5Graph!.effortEstimates.filter(effort => effort.targetFactId === mathWorkloadId)).toEqual([]);
    expect(second.state.lastQuestionContext).toMatchObject({ targetSlot: 'stable_v5:missing_effort_estimate', topicId: mathWorkloadId });
    expect(second.draftCandidates).toEqual([]);
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

  function fixedHandoffDocument(userText: string, representation: 'fixed_task' | 'unavailable') {
    const document = planningDocument({ title: '部活', amount: 1, unitCode: 'session', unitLabel: '回', sourceText: userText });
    if (representation === 'fixed_task') {
      const task = document.tasks[0];
      task.category = 'non_study'; task.study = null; task.workloads = [];
      task.temporalConstraints = [{ localId: 'club-fixed-time', targetLocalId: task.localId,
        kind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-08-17',
        namedTimePeriod: null, startTime: '10:30', endTime: '12:00', precision: 'exact', sourceText: userText }];
    } else {
      document.tasks = [];
      document.availabilityDeclarations = [{ localId: 'club-busy-time', kind: 'unavailable',
        dateExpression: '2026-08-17', namedTimePeriod: null, startTime: '10:30', endTime: '12:00',
        recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: userText }];
    }
    return document;
  }

  // New discourse kinds are provider JSON here, so the baseline can run against
  // the current four-kind validator without inventing a type-level acceptance.
  async function runFixedHandoffReading(params: {
    conversationId: string; userText: string; document: WeeklyPlanningSemanticDocumentV5;
    act: 'request_event_registration' | 'decline_additional_work' | null;
    acts?: Array<{ kind: string; targetPublicId: string | null }>;
  }) {
    const raw = { ...params.document, conversationActs: params.acts
      ?? (params.act ? [{ kind: params.act, targetPublicId: null }] : []) };
    const actual = await vi.importActual<typeof import('../semantic/weeklyPlanningSemanticNormalizerV5')>('../semantic/weeklyPlanningSemanticNormalizerV5');
    const index = normalizeMock.mock.calls.length;
    let semanticInput!: WeeklyPlanningSemanticNormalizerInputV5;
    const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async (request) => {
      const schema = request.responseFormat?.json_schema.name;
      if (schema === 'weekly_planning_focused_authorization_v5') {
        expect(semanticInput.publicStateSummary).toMatchObject({
          pendingQuestion: null, previousCompatibilityStatus: 'needs_scope',
          tasks: expect.arrayContaining([expect.objectContaining({ category: 'non_study' })]),
        });
        expect(request.maxCompletionTokens).toBe(FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS);
        expect(JSON.parse(request.messages[1].content)).toEqual({ currentUserText: params.userText,
          lastAssistantMessage: semanticInput.publicStateSummary?.lastAssistantMessage ?? null });
        return JSON.stringify({ decision: 'fallback' });
      }
      if (schema === 'weekly_planning_focused_task_temporal_side_contribution_v5') {
        return JSON.stringify({ decision: 'fallback', kind: null, constraintLevel: null,
          dateExpression: null, namedTimePeriod: null, startTime: null, endTime: null, precision: null });
      }
      expect(schema).toBe('weekly_planning_semantic_document_v5');
      return JSON.stringify(raw);
    });
    const normalizer = actual.createWeeklyPlanningSemanticNormalizerV5({ createChatCompletion });
    normalizeMock.mockImplementationOnce((input: WeeklyPlanningSemanticNormalizerInputV5) => {
      semanticInput = input;
      return normalizer.normalize(input);
    });
    const result = await conversation.run(turnInput({ conversationId: params.conversationId,
      userText: params.userText, traceRequestId: `fixed-handoff-${index}` }));
    const reading = await normalizeMock.mock.results[index].value;
    expect(reading.status).toBe('accepted');
    expect(reading.document).not.toBeNull();
    // Preserve the current no-op path: two generic completeness retries, with
    // its existing task-target temporal fallback when that route is eligible.
    const generic = 'weekly_planning_semantic_document_v5';
    const temporal = 'weekly_planning_focused_task_temporal_side_contribution_v5';
    const schemas = createChatCompletion.mock.calls.map(([request]) => request.responseFormat?.json_schema.name);
    const authorization = 'weekly_planning_focused_authorization_v5';
    if (schemas.includes(authorization)) {
      expect(schemas).toEqual([authorization, generic]);
      expect(await createChatCompletion.mock.results[0].value).toBe(JSON.stringify({ decision: 'fallback' }));
      expect(reading.diagnostics.providerError).toBeNull();
      expect(reading.document.planningIntent).toBe(params.document.planningIntent);
    } else {
      expect([[generic], [generic, generic, generic], [generic, temporal, generic, generic]])
        .toContainEqual(schemas);
    }
    expect(result.state.shouldSavePlan).toBe(false);
    expect(getWeeklyPlanningStableV5RuntimeSession(params.conversationId)!.graph).toEqual(result.stableV5Graph);
    return { result, reading, raw, createChatCompletion };
  }

  function noNewEventFacts() {
    const document = proposalDecisionDocument({ proposalId: 'unused', decision: 'accept' });
    document.decisions = [];
    return document;
  }

  it.each(['fixed_task', 'unavailable'] as const)('ends a complete %s registration turn and repeats handoff only for a renewed explicit request', async (representation) => {
    const conversationId = `fixed-handoff-${representation}`;
    const userText = '8月17日から23日の予定です。8月17日の10:30から12:00は部活なので、その予定を入れてください。';
    const first = await runFixedHandoffReading({ conversationId, userText,
      document: fixedHandoffDocument(userText, representation), act: 'request_event_registration' });
    expect(first.result.draftCandidates).toEqual(representation === 'fixed_task' ? [expect.objectContaining({
      title: '部活', date: '2026-08-17', startTime: '10:30', endTime: '12:00', source: 'fixed_event_registration',
    })] : []);
    expect(first.result.state.shouldCreateDraft).toBe(representation === 'fixed_task');
    expect(first.result.stableV5Graph![representation === 'fixed_task' ? 'temporalConstraints' : 'availabilityDeclarations'])
      .toHaveLength(1);
    // Baseline's expected missing boundary: facts were accepted, but the old
    // missing-work invitation must not remain after a complete fixed-only turn.
    expect(first.result.state.lastQuestionContext).toBeUndefined();
    expect(first.result.state.questions).toEqual([]);
    expect(first.result).toHaveProperty('communicationFacts.statusReason', representation === 'fixed_task' ? 'fixed_event_registration_preview' : 'fixed_event_manual_entry');
    expect(first.reading.document.conversationActs).toEqual(first.raw.conversationActs);
    const firstGraph = structuredClone(first.result.stableV5Graph!);
    for (const [text, act, status] of [
      ['わかりました', null, 'no_additional_work'],
      ['その予定を登録したいです', 'request_event_registration', 'fixed_event_manual_entry'],
      ['ほかの作業は追加しません', 'decline_additional_work', 'no_additional_work'],
    ] as const) {
      const next = await runFixedHandoffReading({ conversationId, userText: text, document: noNewEventFacts(), act,
        ...(representation === 'fixed_task' && act === 'request_event_registration'
          ? { acts: [{ kind: act, targetPublicId: firstGraph.tasks[0].id }] } : {}),
      });
      expect(next.result.draftCandidates).toEqual(representation === 'fixed_task' && act === 'request_event_registration'
        ? first.result.draftCandidates : []);
      expect(next.result.state.lastQuestionContext).toBeUndefined();
      expect(next.result.state.questions).toEqual([]);
      expect(next.result).toHaveProperty('communicationFacts.statusReason', representation === 'fixed_task' && act === 'request_event_registration' ? 'fixed_event_registration_preview' : status);
      expect(next.reading.document.conversationActs).toEqual(next.raw.conversationActs);
      expect(next.result.stableV5Graph!.tasks).toEqual(firstGraph.tasks);
      expect(next.result.stableV5Graph!.workloads).toEqual(firstGraph.workloads);
      expect(next.result.stableV5Graph!.temporalConstraints).toEqual(firstGraph.temporalConstraints);
      expect(next.result.stableV5Graph!.availabilityDeclarations).toEqual(firstGraph.availabilityDeclarations);
    }
  });

  it('scopes registration acts to named tasks or current-turn contributions while older commitments stay busy', async () => {
    const conversationId = 'fixed-registration-target-scope';
    const userText = '8月17日から23日の予定です。8月17日の固定予定を5件伝えます。';
    const initial = fixedHandoffDocument(userText, 'fixed_task');
    initial.planningIntent = 'discuss';
    initial.tasks = Array.from({ length: 5 }, (_, i) => {
      const task = structuredClone(initial.tasks[0]);
      task.localId = `busy-${i}`; task.title = `固定予定${i}`;
      task.temporalConstraints[0] = { ...task.temporalConstraints[0], localId: `time-${i}`,
        targetLocalId: task.localId, startTime: `${10 + i}:00`, endTime: `${11 + i}:00` };
      return task;
    });
    const first = await runFixedHandoffReading({ conversationId, userText, document: initial, act: null,
      acts: [{ kind: 'request_event_registration', targetPublicId: 'does-not-exist' }] });
    expect(first.reading.document.conversationActs).toEqual([{ kind: 'request_event_registration', targetPublicId: null, targetResolution: 'unresolved' }]);
    expect(first.result.draftCandidates).toEqual([]);
    const ids = first.result.stableV5Graph!.tasks.map(task => task.id);
    const named = await runFixedHandoffReading({ conversationId, userText: '固定予定1だけ登録して',
      document: noNewEventFacts(), act: null,
      acts: [{ kind: 'request_event_registration', targetPublicId: ids[1] }] });
    expect(named.result.draftCandidates).toEqual([expect.objectContaining({ title: '固定予定1',
      date: '2026-08-17', startTime: '11:00', endTime: '12:00' })]);
    const unchanged = await runFixedHandoffReading({ conversationId, userText: '登録して',
      document: noNewEventFacts(), act: 'request_event_registration' });
    expect(unchanged.result.draftCandidates).toEqual([]);
    const added = fixedHandoffDocument('新しい予定を登録して', 'fixed_task');
    added.planningIntent = 'discuss'; added.planningWindow = null;
    added.tasks[0].title = '追加予定';
    added.tasks[0].temporalConstraints[0].startTime = '16:00';
    added.tasks[0].temporalConstraints[0].endTime = '17:00';
    const newOnly = await runFixedHandoffReading({ conversationId, userText: '新しい予定を登録して',
      document: added, act: 'request_event_registration' });
    expect(newOnly.result.draftCandidates).toEqual([expect.objectContaining({ title: '追加予定', startTime: '16:00', endTime: '17:00' })]);
    const updated = fixedHandoffDocument('固定予定2に締切を加えて登録して', 'fixed_task');
    updated.planningIntent = 'discuss'; updated.planningWindow = null;
    updated.tasks[0].title = '固定予定2'; updated.tasks[0].existingPublicId = ids[2];
    updated.tasks[0].temporalConstraints = [{ ...updated.tasks[0].temporalConstraints[0],
      localId: 'updated-deadline', kind: 'deadline', startTime: null, endTime: '20:00' }];
    const union = await runFixedHandoffReading({ conversationId, userText: '固定予定2に締切を加えて登録して',
      document: updated, act: null, acts: [
        { kind: 'request_event_registration', targetPublicId: null },
        { kind: 'request_event_registration', targetPublicId: ids[0] },
        { kind: 'request_event_registration', targetPublicId: ids[0] },
        { kind: 'request_event_registration', targetPublicId: 'does-not-exist' },
      ] });
    expect(union.result.draftCandidates.map(c => [c.title, c.startTime, c.endTime]))
      .toEqual([['固定予定0', '10:00', '11:00'], ['固定予定2', '12:00', '13:00']]);
    expect(union.result.stableV5Graph!.tasks).toHaveLength(6);
    expect(union.result.state.shouldSavePlan).toBe(false);
    // A later authorized study plan must still avoid every earlier busy commitment.
    const study = planningDocument({ title: '数学', amount: 60, unitCode: 'minute', unitLabel: '分', sourceText: '数学1時間を配置して' });
    study.planningWindow = { ...study.planningWindow!, start: '2026-08-17', end: '2026-08-17', value: '2026-08-17' };
    const placed = await runFixedHandoffReading({ conversationId, userText: '8月17日から23日で数学1時間を配置して', document: study, act: null });
    expect(placed.result.draftCandidates).toHaveLength(1);
    expect(placed.result.draftCandidates[0]).toMatchObject({ durationMinutes: 60 });
    const candidate = placed.result.draftCandidates[0];
    expect(candidate.source).not.toBe('fixed_event_registration');
    expect((candidate.endTime <= '10:00' || candidate.startTime >= '15:00')
      && (candidate.endTime <= '16:00' || candidate.startTime >= '17:00')).toBe(true);
  });

  it.each([false, true])('keeps study update authorization separate from registration previews, prior study authorization=%s', async authorized => {
    const conversationId = `fixed-registration-update-authorization-${authorized}`;
    const userText = '8月17日から23日の予定です。部活を登録して。数学の学習条件は30分です。';
    const initial = fixedHandoffDocument(userText, 'fixed_task');
    initial.planningIntent = authorized ? 'create_plan' : 'discuss';
    const study = planningDocument({ title: '数学', amount: 30, unitCode: 'minute', unitLabel: '分', sourceText: userText }).tasks[0];
    study.localId = 'math'; study.workloads[0].localId = 'math-work'; initial.tasks.push(study);
    const first = await runFixedHandoffReading({ conversationId, userText, document: initial, act: 'request_event_registration' });
    expect(first.result.state.status).toBe('draft_ready');
    expect(first.result.state.draftGenerationIntent).toBe(authorized ? 'user_authorized' : 'not_requested');
    expect(first.result.draftCandidates).toHaveLength(authorized ? 2 : 1);
    const graph = first.result.stableV5Graph!;
    const math = graph.tasks.find(task => task.title === '数学')!;
    const work = graph.workloads.find(fact => fact.taskId === math.id)!;
    const update = planningDocument({ title: '数学', amount: 20, unitCode: 'minute', unitLabel: '分', sourceText: '数学は20分です' });
    update.planningIntent = 'update_plan'; update.planningWindow = null;
    update.tasks[0].existingPublicId = math.id;
    update.corrections = [{ localId: 'replace-duration', target: { kind: 'workload', publicId: work.id, localId: null, mention: null },
      operation: 'replace', replacementLocalId: update.tasks[0].workloads[0].localId, sourceText: '数学は20分です' }];
    const next = await runFixedHandoffReading({ conversationId, userText: '数学は20分です', document: update, act: null });
    expect(next.result.state.draftGenerationIntent).toBe(authorized ? 'user_authorized' : 'not_requested');
    expect(next.result.draftCandidates).toEqual(authorized
      ? [expect.objectContaining({ durationMinutes: 20 })] : []);
    expect(next.result.draftCandidates.every(c => c.source !== 'fixed_event_registration')).toBe(true);
    expect(next.result.state.shouldSavePlan).toBe(false);
  });

  it.each([[false, false], [true, false], [true, true]])('discloses unsupported registration intervals, all targets unsupported=%s, study preview=%s', async (allUnsupported, studyPreview) => {
    const conversationId = `fixed-unsupported-${allUnsupported}-${studyPreview}`;
    const userText = '8月17日から23日の予定です。部活と夜勤と連日予定を登録して。'
      + (studyPreview ? '数学の予定も20分作って。' : '');
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.planningIntent = 'discuss';
    const overnight = structuredClone(document.tasks[0]);
    overnight.localId = 'overnight'; overnight.title = '夜勤';
    overnight.temporalConstraints[0] = { ...overnight.temporalConstraints[0], localId: 'overnight-time',
      targetLocalId: 'overnight', startTime: '23:00', endTime: '01:00' };
    const multiple = structuredClone(document.tasks[0]);
    multiple.localId = 'multiple'; multiple.title = '連日予定';
    multiple.temporalConstraints = ['2026-08-17', '2026-08-18'].map((dateExpression, i) => ({
      ...multiple.temporalConstraints[0], localId: `multiple-${i}`, targetLocalId: 'multiple', dateExpression,
    }));
    document.tasks = [...(allUnsupported ? [] : document.tasks), overnight, multiple];
    if (studyPreview) {
      document.planningIntent = 'create_plan';
      const study = planningDocument({ title: '数学', amount: 20, unitCode: 'minute', unitLabel: '分', sourceText: userText }).tasks[0];
      study.localId = 'math'; study.workloads[0].localId = 'math-work'; document.tasks.push(study);
    }
    const clientModule = await import('../../../services/ai/openAiCompatibleClient');
    const rendererClient = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
        const body = JSON.parse(request.messages[request.messages.length - 1].content);
        return JSON.stringify(withWeeklyPlanningEffortAcknowledgement(body, { actionId: body.actionId,
          actionKind: body.applicationDecision.actionKind, questionCode: body.applicationDecision.questionCode,
          groundingAcknowledgement: null, text: '夜勤は日付をまたぐため、連日予定は複数の日付や時間帯があるため、候補に含めていません。'
            + (allUnsupported && !studyPreview ? '「予定」から「予定を追加」で入力してください。'
              : `${studyPreview ? '数学' : '部活'}の候補はまだ保存していません。「この内容で仮予定にする」から確認してください。`) }));
      });
    const clientSpy = vi.spyOn(clientModule, 'createOpenAiCompatibleClient').mockReturnValue({ createChatCompletion: rendererClient });
    try {
      const turn = await runFixedHandoffReading({ conversationId, userText, document, act: 'request_event_registration' });
      expect(turn.result.draftCandidates).toEqual(studyPreview ? [expect.objectContaining({ durationMinutes: 20, source: 'weekly_exam_prep' })]
        : allUnsupported ? [] : [expect.objectContaining({ title: '部活' })]);
      expect(turn.result.communicationFacts?.eventRegistration?.unregistered).toEqual([
        { taskId: turn.result.stableV5Graph!.tasks.find(task => task.title === '夜勤')!.id, title: '夜勤', reason: 'crosses_midnight' },
        { taskId: turn.result.stableV5Graph!.tasks.find(task => task.title === '連日予定')!.id, title: '連日予定', reason: 'multiple_intervals' },
      ]);
      expect(turn.result.message).toContain('夜勤は日付をまたぐため');
      expect(turn.result.message).toContain('連日予定は複数の日付や時間帯があるため');
      expect(turn.result.state.shouldSavePlan).toBe(false);
      expect(turn.result.responseSource).toBe('ai');
      expect(turn.result.state.shouldCreateDraft).toBe(!allUnsupported || studyPreview);
      if (allUnsupported && !studyPreview) {
        expect(turn.result.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
        expect(turn.result.communicationFacts?.manualEntry).toMatchObject({ navigationLabel: '予定', actionLabel: '予定を追加' });
        expect(turn.result.message).toContain('「予定」から「予定を追加」');
        expect(turn.result.message).not.toContain('この内容で仮予定にする');
      } else if (studyPreview) {
        expect(turn.result.communicationFacts?.statusReason).toBe('fixed_event_registration_preview');
        expect(turn.result.communicationFacts).not.toHaveProperty('manualEntry');
        expect(turn.result.communicationFacts?.eventRegistration?.candidates).toEqual([]);
        expect(turn.result.message).toContain('数学の候補');
        expect(turn.result.message).toContain('この内容で仮予定にする');
        const sent = rendererClient.mock.calls[0][0];
        const body = JSON.parse(sent.messages[sent.messages.length - 1].content);
        expect(body.applicationDecision.previewCount).toBe(1);
        expect(body.applicationDecision.communication.eventRegistration.candidates).toEqual([]);
        expect(sent.messages[sent.messages.length - 1].content).toContain('プレビューがあれば承認案内');
        expect(sent.messages[sent.messages.length - 1].content).not.toContain('候補なしは承認案内せずmanualEntryへ');
      }
    } finally { clientSpy.mockRestore(); }
  });

  it('treats busy-only evidence without registration as an optional invitation that an explicit decline can close', async () => {
    const conversationId = 'fixed-handoff-busy-without-registration';
    const userText = '8月17日から23日の予定です。8月17日は10:30から12:00まで部活があります。';
    const first = await runFixedHandoffReading({ conversationId, userText,
      document: fixedHandoffDocument(userText, 'unavailable'), act: null });
    expect(first.result.draftCandidates).toEqual([]);
    expect(first.result.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
    expect(first.result).not.toHaveProperty('communicationFacts.statusReason', 'fixed_event_manual_entry');
    const declined = await runFixedHandoffReading({ conversationId, userText: 'ほかの作業は追加しません',
      document: noNewEventFacts(), act: 'decline_additional_work' });
    expect(declined.result.draftCandidates).toEqual([]);
    expect(declined.result.state.lastQuestionContext).toBeUndefined();
    expect(declined.result).toHaveProperty('communicationFacts.statusReason', 'no_additional_work');
    expect(declined.result.stableV5Graph!.availabilityDeclarations).toEqual(first.result.stableV5Graph!.availabilityDeclarations);
  });

  it('does not let a decline close a required date question for an incomplete fixed event', async () => {
    const conversationId = 'fixed-handoff-required-date';
    const userText = '8月17日から23日の予定です。部活は10:30から12:00です。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.tasks[0].temporalConstraints[0].dateExpression = null;
    const first = await runFixedHandoffReading({ conversationId, userText, document, act: 'request_event_registration' });
    expect(first.result.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_commitment_date_scope');
    const question = first.result.state.lastQuestionContext!;
    const declined = await runFixedHandoffReading({ conversationId, userText: 'ほかの作業は追加しません',
      document: noNewEventFacts(), act: 'decline_additional_work' });
    expect(declined.result.state.lastQuestionContext).toMatchObject({ targetSlot: question.targetSlot, topicId: question.topicId });
    expect(declined.result).not.toHaveProperty('communicationFacts.statusReason', 'no_additional_work');
    expect(declined.result).not.toHaveProperty('communicationFacts.statusReason', 'fixed_event_manual_entry');
    expect(declined.result.draftCandidates).toEqual([]);
    expect(declined.result.stableV5Graph!.temporalConstraints).toEqual(first.result.stableV5Graph!.temporalConstraints);
  });

  it.each(['startTime', 'endTime'] as const)('asks for an unresolved fixed-event %s before generating a registration preview', async field => {
    const userText = '8月17日から23日の予定です。8月17日の部活を登録したいです。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.tasks[0].temporalConstraints = [];
    document.uncertainties = [{ localId: 'missing-event-time', targetLocalId: document.tasks[0].localId,
      field, reason: '部活の時刻が未確定', sourceText: userText }];
    const turn = await runFixedHandoffReading({ conversationId: `fixed-missing-${field}`, userText, document, act: 'request_event_registration' });
    expect(turn.result.draftCandidates).toEqual([]);
    expect(turn.result.state.lastQuestionContext).toBeDefined();
    expect(turn.result.state.questions).toHaveLength(1);
    expect(turn.result.state.shouldCreateDraft).toBe(false);
    expect(turn.result.state.shouldSavePlan).toBe(false);
    expect(turn.result.communicationFacts).toBeUndefined();
  });

  it('keeps independent schedulable study work when a fixed-event registration is requested in the same turn', async () => {
    const conversationId = 'fixed-handoff-with-study';
    const userText = '8月17日から23日の予定です。8月17日の10:30から12:00は部活なので予定を入れて、数学も20分勉強したいです。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    const study = planningDocument({ title: '数学', amount: 20, unitCode: 'minute', unitLabel: '分', sourceText: '数学も20分勉強したいです' }).tasks[0];
    study.localId = 'study-task'; study.workloads[0].localId = 'study-time';
    document.tasks.push(study);
    const mixed = await runFixedHandoffReading({ conversationId, userText, document, act: 'request_event_registration' });
    expect(mixed.result.stableV5Graph!.tasks).toHaveLength(2);
    expect(mixed.result.draftCandidates).toHaveLength(2);
    const fixed = mixed.result.draftCandidates.find(c => c.source === 'fixed_event_registration')!;
    const studyCandidate = mixed.result.draftCandidates.find(c => c.source === 'weekly_exam_prep')!;
    expect(fixed).toMatchObject({ title: '部活', date: '2026-08-17', startTime: '10:30', endTime: '12:00' });
    expect(studyCandidate.durationMinutes).toBe(20);
    expect(studyCandidate.date !== fixed.date || studyCandidate.endTime <= fixed.startTime || studyCandidate.startTime >= fixed.endTime).toBe(true);
    expect(mixed.result).not.toHaveProperty('communicationFacts.statusReason', 'fixed_event_manual_entry');
    expect(mixed.result).not.toHaveProperty('communicationFacts.statusReason', 'no_additional_work');
  });

  it.each([true, false])('keeps fixed study occupancy without duplicating its workload, registration act=%s', async requested => {
    const conversationId = `fixed-study-registration-${requested}`;
    const userText = '8月17日から23日の予定です。8月17日の13時から15時のゼミを予定に入れて、数学の問題集も1時間予定を作ってください。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    const seminar = document.tasks[0];
    seminar.category = 'study'; seminar.title = 'ゼミ';
    seminar.study = { purpose: 'self_study', contextLabel: 'ゼミ', components: [] };
    seminar.temporalConstraints[0] = { ...seminar.temporalConstraints[0], startTime: '13:00', endTime: '15:00' };
    seminar.workloads = planningDocument({ title: 'ゼミ', amount: 2, unitCode: 'hour', unitLabel: '時間', sourceText: userText }).tasks[0].workloads;
    seminar.workloads[0].localId = 'seminar-work';
    const math = planningDocument({ title: '数学の問題集', amount: 1, unitCode: 'hour', unitLabel: '時間', sourceText: userText }).tasks[0];
    math.localId = 'math'; math.workloads[0].localId = 'math-work'; document.tasks.push(math);
    const turn = await runFixedHandoffReading({ conversationId, userText, document, act: requested ? 'request_event_registration' : null });
    expect(turn.result.failure).toBeUndefined();
    expect(turn.result.state.shouldSavePlan).toBe(false);
    expect(turn.result.draftCandidates).toHaveLength(requested ? 2 : 1);
    const fixed = turn.result.draftCandidates.filter(c => c.source === 'fixed_event_registration');
    const movable = turn.result.draftCandidates.filter(c => c.source === 'weekly_exam_prep');
    expect(movable).toEqual([expect.objectContaining({ durationMinutes: 60 })]);
    expect(movable[0].title).toContain('数学の問題集');
    expect(movable[0].date !== '2026-08-17' || movable[0].endTime <= '13:00' || movable[0].startTime >= '15:00').toBe(true);
    if (requested) {
      expect(fixed).toEqual([expect.objectContaining({ title: 'ゼミ', date: '2026-08-17', startTime: '13:00', endTime: '15:00', durationMinutes: 120,
        stableV5Metadata: expect.objectContaining({ planType: 'study' }) })]);
      expect(turn.result.draftCandidates.filter(c => c.title.includes('ゼミ'))).toHaveLength(1);
      for (const field of ['field', 'year', 'estimatedMinutes', 'allocationBreakdown']) expect(fixed[0]).not.toHaveProperty(field);
    } else {
      expect(fixed).toEqual([]);
      expect(turn.result.draftCandidates.some(c => c.title.includes('ゼミ'))).toBe(false);
    }
    expect(turn.result.stableV5Graph!.workloads).toHaveLength(2);
  });

  it('previews only fixed registrations when movable study placement is not authorized', async () => {
    const conversationId = 'fixed-registration-without-study-authorization';
    const userText = '8月17日から23日の予定です。8月17日の10:30から12:00の部活を登録してください。学習条件は数学20分です。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.planningIntent = 'discuss';
    const study = planningDocument({ title: '数学', amount: 20, unitCode: 'minute', unitLabel: '分', sourceText: userText }).tasks[0];
    study.localId = 'study'; study.workloads[0].localId = 'study-duration';
    document.tasks.push(study);
    const turn = await runFixedHandoffReading({ conversationId, userText, document, act: 'request_event_registration' });
    expect(turn.result.draftCandidates).toEqual([expect.objectContaining({ source: 'fixed_event_registration', title: '部活', date: '2026-08-17', startTime: '10:30', endTime: '12:00' })]);
    expect(turn.result.state.draftGenerationIntent).toBe('not_requested');
    expect(turn.result.state.shouldSavePlan).toBe(false);
    expect(turn.result.communicationFacts?.eventRegistration?.workAwaitingAuthorization).toEqual([expect.stringContaining('数学')]);
    expect(turn.result.stableV5Graph!.workloads).toHaveLength(1);
    const next = await runFixedHandoffReading({ conversationId, userText: '分かりました', document: noNewEventFacts(), act: null });
    expect(next.result.draftCandidates).toEqual([]);
    expect(next.result.preserveExistingPreview).toBe(true);
    expect(next.result.state.draftGenerationIntent).toBe('not_requested');
    expect(next.result.state.shouldSavePlan).toBe(false);
  });

  it('keeps every registration beside a capacity-limited provisional study preview and persists the actual composition', async () => {
    const conversationId = 'weekly-conversation-923e4567-e89b-52d3-a456-426614174002';
    const userText = '8月17日の部活9時から10時とゼミ12時から13時を予定に入れて、9時から11時10分の空き時間に数学10問と英語10問を、数学優先で暫定配分してください。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.planningWindow = { ...document.planningWindow!, start: '2026-08-17', end: '2026-08-17', value: '2026-08-17' };
    document.tasks[0].temporalConstraints[0] = { ...document.tasks[0].temporalConstraints[0], startTime: '09:00', endTime: '10:00' };
    const seminar = structuredClone(document.tasks[0]);
    seminar.localId = 'seminar'; seminar.title = 'ゼミ';
    seminar.temporalConstraints[0] = { ...seminar.temporalConstraints[0], localId: 'seminar-time', targetLocalId: 'seminar', startTime: '12:00', endTime: '13:00' };
    document.tasks.push(seminar);
    const overnight = structuredClone(document.tasks[0]);
    overnight.localId = 'night'; overnight.title = '夜勤';
    overnight.temporalConstraints[0] = { ...overnight.temporalConstraints[0], localId: 'night-time',
      targetLocalId: 'night', startTime: '23:00', endTime: '01:00' };
    document.tasks.push(overnight);
    for (const [id, title] of [['math', '数学'], ['english', '英語']]) {
      const study = planningDocument({ title, amount: 10, unitCode: 'problem', unitLabel: '問', sourceText: userText }).tasks[0];
      study.localId = id; study.workloads[0].localId = `${id}-work`;
      document.tasks.push(study);
    }
    document.availabilityDeclarations = [{ localId: 'available', kind: 'available', dateExpression: '2026-08-17',
      namedTimePeriod: null, startTime: '09:00', endTime: '11:10', recurrenceKind: null, days: [],
      constraintLevel: 'hard', capacityMinutes: null, sourceText: userText }];
    document.relations = [{ localId: 'priority', kind: 'priority_over', fromLocalId: 'math', toLocalId: 'english', sourceText: userText }];
    document.conversationActs = [{ kind: 'request_event_registration', targetPublicId: null }];
    normalizeMock.mockResolvedValueOnce({ ...acceptedResult(document), contextualDirective: { kind: 'provisional_timebox', scope: 'current_missing_effort' } });
    const result = await conversation.run(turnInput({ conversationId, userText, traceRequestId: `${conversationId}:provisional` }));
    const requestId = normalizeMock.mock.calls[0][0].traceRequestId!;
    expect(result.failure).toBeUndefined();
    expect(result.responseSource).toBe('system');
    expect(result.state.shouldSavePlan).toBe(false);
    expect(result.state.lastQuestionContext).toBeUndefined();
    expect(result.draftCandidates).toHaveLength(3);
    const fixed = result.draftCandidates.filter(c => c.source === 'fixed_event_registration');
    expect(fixed.map(c => [c.title, c.date, c.startTime, c.endTime])).toEqual([
      ['部活', '2026-08-17', '09:00', '10:00'], ['ゼミ', '2026-08-17', '12:00', '13:00'],
    ]);
    const study = result.draftCandidates.filter(c => c.source === 'weekly_exam_prep');
    expect(study).toEqual([expect.objectContaining({ durationMinutes: 60 })]);
    expect(study[0].title).toContain('数学');
    expect(study.every(c => fixed.every(f => c.date !== f.date || c.endTime <= f.startTime || c.startTime >= f.endTime))).toBe(true);
    expect(result.message).toContain('3件');
    expect(result.message).toContain('英語は容量不足');
    expect(result.message).toContain('夜勤は日付をまたぐため');
    expect(result.communicationFacts?.eventRegistration?.unregistered).toEqual([expect.objectContaining({ title: '夜勤', reason: 'crosses_midnight' })]);
    expect(result.communicationFacts?.eventRegistration?.candidates).toEqual(fixed);

    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const event = events.find(e => e.stage === 'runtime_branch_selected' && (e.data as { branch: string }).branch === 'preview_ready_provisional_capacity')!;
    expect(event).toBeDefined();
    const output = (event.data as { output: { draftCandidates: Array<Record<string, unknown>> } }).output;
    output.draftCandidates[0].futureRegistrationSentinel = 'provisional-registration-future-field';
    output.draftCandidates[1].futureOversizedValue = '大'.repeat(20_000);
    const restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    const harness = proposalTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const oldEnabled = import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED;
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    try {
      const trace = proposalTraceInput({ conversationId, requestId, userText, result, events });
      await recordWeeklyPlanningStableV5TurnTrace(trace);
      expect(harness.writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toHaveLength(1);
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace({ ...trace, requestId: `${requestId}:retry`, debugTraceEvents: [] });
      expect(harness.writes).toHaveLength(2);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toEqual([]);
      const replay = harness.writes[0];
      expect(measureWeeklyPlanningTraceJsonBytes(replay.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({ session: replay.session as unknown as Record<string, unknown>, entries: replay.entries as unknown as Record<string, unknown>[] },
        { token: `wpt_${'f'.repeat(43)}`, epoch: '107' }, { sessionId: conversationId.replace('weekly-conversation-', 'weekly-trace-'), logicalConversationId: conversationId }, '2026-10-10T00:00:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      for (const entry of [replay.entries[0], prepared.entries[0]]) {
        const serialized = JSON.stringify(entry);
        expect(serialized).toContain('"candidateCount":3');
        expect(serialized).toContain('fixed_event_registration');
        expect(serialized).toContain('provisional-registration-future-field');
        expect(serialized).toContain('"traceTruncated":true');
        expect(serialized).not.toContain('大'.repeat(20_000));
        expect(serialized).toContain('09:00'); expect(serialized).toContain('12:00');
      }
    } finally {
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', oldEnabled);
      restore();
    }
  });

  it('uses fixed commitments only as busy time without the registration act', async () => {
    const userText = '8月17日から23日の予定です。8月17日の10:30から12:00は部活です。数学を60分勉強したいです。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    const study = planningDocument({ title: '数学', amount: 60, unitCode: 'minute', unitLabel: '分', sourceText: userText }).tasks[0];
    study.localId = 'study'; study.workloads[0].localId = 'study-duration';
    document.tasks.push(study);
    const turn = await runFixedHandoffReading({ conversationId: 'fixed-with-study-no-act', userText, document, act: null });
    expect(turn.result.draftCandidates).toHaveLength(1);
    expect(turn.result.draftCandidates[0]).toMatchObject({ source: 'weekly_exam_prep', durationMinutes: 60 });
    expect(turn.result.communicationFacts).toBeUndefined();
  });

  function fixedHandoffQuestionIdentity(state: PlanningIntakeState) {
    const question = state.lastQuestionContext;
    return ['kind', 'targetSlot', 'intent', 'topicId', 'actionId',
      'estimateForWorkloadFactId', 'questionBasis']
      .map(key => question?.[key as keyof NonNullable<PlanningIntakeState['lastQuestionContext']>]);
  }

  function expectCurrentFixedHandoffQuestionFresh(conversationId: string) {
    const state = conversation.getState();
    expect(state.intakeState?.lastQuestionContext).toBeDefined();
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: state.intakeState,
      messages: state.messages, inputStateRevision: state.revision,
      graphRevision: getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph.revision,
    }).status).toBe('fresh');
  }

  it.each(['ask_about_pending_question', 'resume_topic'] as const)(
    'preserves the actual optional question for %s until explicit registration closes that invitation', async kind => {
      const conversationId = `fixed-handoff-optional-${kind}`;
      const userText = '8月17日から23日の予定です。8月17日は10:30から12:00まで部活があります。';
      const first = await runFixedHandoffReading({ conversationId, userText,
        document: fixedHandoffDocument(userText, 'unavailable'), act: null });
      expect(first.result.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
      expectCurrentFixedHandoffQuestionFresh(conversationId);
      const identity = fixedHandoffQuestionIdentity(first.result.state);
      const ordinaryActs = [{ kind, targetPublicId: null }];
      const next = await runFixedHandoffReading({ conversationId,
        userText: kind === 'ask_about_pending_question' ? '何を追加するか聞くのはなぜですか？' : 'さっきの追加する作業の質問に戻ってください。',
        document: noNewEventFacts(), act: null, acts: ordinaryActs });
      expect(next.reading.document.conversationActs).toEqual(ordinaryActs);
      expect(fixedHandoffQuestionIdentity(next.result.state)).toEqual(identity);
      expect(next.result.interactionOutcome?.kind).toBe(kind === 'ask_about_pending_question'
        ? 'explain_pending_question' : 'resume_pending_question');
      expect(next.result).not.toHaveProperty('communicationFacts');
      expect(next.result.stableV5Graph!.availabilityDeclarations).toEqual(first.result.stableV5Graph!.availabilityDeclarations);
      expectCurrentFixedHandoffQuestionFresh(conversationId);
      const mixedActs = [...ordinaryActs, { kind: 'request_event_registration', targetPublicId: null },
        { kind: 'decline_additional_work', targetPublicId: null }];
      const closed = await runFixedHandoffReading({ conversationId,
        userText: kind === 'ask_about_pending_question'
          ? '何を追加するか聞く理由を教えてください。ほかの作業は追加しませんが、部活の予定は登録したいです。'
          : '先ほどの話に戻ります。ほかの作業は追加しませんが、部活の予定は登録したいです。',
        document: noNewEventFacts(), act: null, acts: mixedActs });
      expect(closed.reading.document.conversationActs).toEqual(mixedActs);
      expect(closed.result.state.lastQuestionContext).toBeUndefined();
      expect(closed.result.state.questions).toEqual([]);
      // Existing G/source classification requires an actual question to claim
      // explanation/resumption; a closed invitation must not fabricate one.
      expect(closed.result.interactionOutcome?.kind).toBe('apply');
      expect(closed.result).toHaveProperty('communicationFacts.statusReason', 'fixed_event_manual_entry');
      expect(closed.result).toHaveProperty('communicationFacts.manualEntry', {
        navigationLabel: '予定', actionLabel: '予定を追加', eventCreatedByTurn: false,
      });
      expect(closed.result.draftCandidates).toEqual([]);
      expect(closed.result.state.shouldCreateDraft).toBe(false);
      expect(closed.result.stableV5Graph!.availabilityDeclarations).toEqual(first.result.stableV5Graph!.availabilityDeclarations);
    });

  it('keeps typed registration-preview facts beside an actual topic-shift renderer input', async () => {
    const rendererClient = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
      expect(request.purpose).toBe('weekly_planning_renderer');
      expect(request.responseFormat?.json_schema.name).toBe('weekly_planning_stable_v5_dialogue_response');
      const body = JSON.parse(request.messages[request.messages.length - 1].content);
      return JSON.stringify(withWeeklyPlanningEffortAcknowledgement(body, { actionId: body.actionId, actionKind: body.applicationDecision.actionKind,
        questionCode: body.applicationDecision.questionCode, groundingAcknowledgement: null,
        text: '部活の登録候補を確認してください。まだ保存していません。「この内容で仮予定にする」から進められます。' }));
    });
    const clientModule = await import('../../../services/ai/openAiCompatibleClient');
    const clientSpy = vi.spyOn(clientModule, 'createOpenAiCompatibleClient')
      .mockReturnValue({ createChatCompletion: rendererClient });
    try {
      const conversationId = 'fixed-handoff-registration-aside';
      const userText = '話題を変えます。8月17日から23日の予定で、8月17日の10:30から12:00の部活を登録したいです。';
      const acts = [{ kind: 'request_event_registration', targetPublicId: null },
        { kind: 'topic_shift', targetPublicId: null }];
      const turn = await runFixedHandoffReading({ conversationId, userText,
        document: fixedHandoffDocument(userText, 'fixed_task'), act: null, acts });
      expect(turn.reading.document.conversationActs).toEqual(acts);
      expect(turn.result.interactionOutcome?.kind).toBe('apply');
      expect(turn.result.state.lastQuestionContext).toBeUndefined();
      expect(turn.result.draftCandidates).toHaveLength(1);
      expect(turn.result.state.shouldCreateDraft).toBe(true);
      expect(turn.result).toHaveProperty('communicationFacts.statusReason', 'fixed_event_registration_preview');
      expect(rendererClient).toHaveBeenCalledTimes(1);
      expect(turn.result.responseSource).toBe('ai');
      const request = rendererClient.mock.calls[0][0];
      const body = JSON.parse(request.messages[request.messages.length - 1].content);
      expect(body.applicationDecision).toMatchObject({
        actionKind: 'preview_ready', questionCode: null, communication: {
          goal: 'present_preview', askQuestion: false, statusReason: 'fixed_event_registration_preview',
          eventRegistration: { eventCreatedByTurn: false, overlaps: [] },
        },
      });
    } finally {
      clientSpy.mockRestore();
    }
  });

  it('does not let unknown named resume plus fixed-event acts consume a required commitment date', async () => {
    const conversationId = 'fixed-handoff-unknown-resume';
    const userText = '8月17日から23日の予定です。部活は10:30から12:00です。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.tasks[0].temporalConstraints[0].dateExpression = null;
    const first = await runFixedHandoffReading({ conversationId, userText, document, act: null });
    expect(first.result.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_commitment_date_scope');
    expectCurrentFixedHandoffQuestionFresh(conversationId);
    const identity = fixedHandoffQuestionIdentity(first.result.state);
    const acts = [{ kind: 'resume_topic', targetPublicId: 'unknown-fixed-topic' },
      { kind: 'request_event_registration', targetPublicId: null },
      { kind: 'decline_additional_work', targetPublicId: null }];
    const next = await runFixedHandoffReading({ conversationId,
      userText: '別の部活の話に戻って、その予定を登録したいです。ほかの作業は追加しません。',
      document: noNewEventFacts(), act: null, acts });
    expect(next.reading.document.conversationActs).toEqual([
      { kind: 'resume_topic', targetPublicId: null, targetResolution: 'unresolved' }, ...acts.slice(1),
    ]);
    expect(fixedHandoffQuestionIdentity(next.result.state)).toEqual(identity);
    expect(next.result.interactionOutcome?.kind).toBe('aside');
    expect(next.result).not.toHaveProperty('communicationFacts');
    expect(next.result.draftCandidates).toEqual([]);
    expect(next.result.stableV5Graph!.temporalConstraints).toEqual(first.result.stableV5Graph!.temporalConstraints);
    expect(next.result.questionPresentationContent).toBeUndefined();
    const state = conversation.getState();
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: state.intakeState,
      messages: state.messages, inputStateRevision: state.revision,
      graphRevision: next.result.stableV5Graph!.revision,
    }).status).not.toBe('fresh');
  });

  it('retains a required window uncertainty for fixed-only work until a separately reviewed projection exists', async () => {
    const conversationId = 'fixed-handoff-required-window';
    const userText = '8月17日から23日の予定です。対象期間は確認が必要です。8月17日の10:30から12:00は部活です。';
    const document = fixedHandoffDocument(userText, 'fixed_task');
    document.uncertainties = [{ localId: 'window-need', targetLocalId: document.planningWindow!.localId,
      field: 'planning_window', reason: '対象期間の確認が必要', sourceText: '対象期間は確認が必要です' }];
    const first = await runFixedHandoffReading({ conversationId, userText, document, act: null });
    const graph = first.result.stableV5Graph!;
    expect(graph.uncertainties).toHaveLength(1);
    expect(graph.uncertainties[0].targetFactId).toBe(graph.planningWindows[0].id);
    expect(first.result.state.lastQuestionContext).toMatchObject({
      targetSlot: 'stable_v5:semantic_uncertainty', topicId: graph.uncertainties[0].id,
    });
    const identity = fixedHandoffQuestionIdentity(first.result.state);
    const acts = [{ kind: 'request_event_registration', targetPublicId: null },
      { kind: 'decline_additional_work', targetPublicId: null }];
    const next = await runFixedHandoffReading({ conversationId,
      userText: '部活を登録したいです。ほかの作業は追加しません。', document: noNewEventFacts(), act: null, acts });
    expect(next.reading.document.conversationActs).toEqual(acts);
    expect(fixedHandoffQuestionIdentity(next.result.state)).toEqual(identity);
    expect(next.result).not.toHaveProperty('communicationFacts');
    expect(next.result.draftCandidates).toEqual([]);
    expect(next.result.stableV5Graph!.planningWindows).toEqual(graph.planningWindows);
    expect(next.result.stableV5Graph!.uncertainties).toEqual(graph.uncertainties);
    expect(next.result.stableV5Graph!.temporalConstraints).toEqual(graph.temporalConstraints);
  });

  it.each([[false, false], [true, false], [false, true]])('persists actual fixed-event requests through outbox and Worker with renderer failure=%s, study preview=%s', async (rendererFailure, studyPreview) => {
    const conversationId = `weekly-conversation-923e4567-e89b-52d3-a456-42661417400${rendererFailure ? '1' : studyPreview ? '2' : '0'}`;
    const oldTraceEnabled = import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED;
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const storage = createMemoryStorageHarness();
    const restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
    const harness = proposalTraceRepository();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const rendererClient = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
      expect(request.purpose).toBe('weekly_planning_renderer');
      expect(request.responseFormat?.json_schema.name).toBe('weekly_planning_stable_v5_dialogue_response');
      if (rendererFailure) throw new Error('Fixed handoff renderer provider failure fixture');
      const body = JSON.parse(request.messages[request.messages.length - 1].content);
      return JSON.stringify(withWeeklyPlanningEffortAcknowledgement(body, { actionId: body.actionId, actionKind: body.applicationDecision.actionKind,
        questionCode: body.applicationDecision.questionCode, groundingAcknowledgement: null,
        text: body.applicationDecision.communication.statusReason === 'fixed_event_registration_preview'
          ? '夜勤は日付をまたぐため候補に含めていません。部活とゼミは2026-08-17の11:30–12:00が重複しています。'
            + (studyPreview ? '数学の日時はプレビューで確認してください。' : '数学はまだ配置していません。学習の仮予定は「この条件で予定を作って」と依頼してください。')
            + 'まだ保存していません。「この内容で仮予定にする」から確認してください。'
          : '分かりました。' }));
    });
    const clientModule = await import('../../../services/ai/openAiCompatibleClient');
    const clientSpy = vi.spyOn(clientModule, 'createOpenAiCompatibleClient')
      .mockReturnValue({ createChatCompletion: rendererClient });
    try {
      const userText = '8月17日から23日。部活・ゼミ・夜勤を登録。数学20分。';
      const document = fixedHandoffDocument(userText, 'fixed_task');
      const second = structuredClone(document.tasks[0]);
      second.localId = 'seminar'; second.title = 'ゼミ'; second.category = 'study';
      second.study = { purpose: 'self_study', contextLabel: null, components: [] };
      second.temporalConstraints[0] = { ...second.temporalConstraints[0], localId: 'seminar-time',
        targetLocalId: 'seminar', startTime: '11:30', endTime: '12:30' };
      document.tasks.push(second);
      const overnight = structuredClone(document.tasks[0]);
      overnight.localId = 'night'; overnight.title = '夜勤';
      overnight.temporalConstraints[0] = { ...overnight.temporalConstraints[0], localId: 'night-time',
        targetLocalId: 'night', startTime: '23:00', endTime: '01:00' };
      document.tasks.push(overnight);
      document.planningIntent = studyPreview ? 'create_plan' : 'discuss';
      const study = planningDocument({ title: '数学', amount: 20, unitCode: 'minute', unitLabel: '分', sourceText: userText }).tasks[0];
      study.localId = 'study'; study.workloads[0].localId = 'study-duration'; document.tasks.push(study);
      // Each fact cites its own user evidence, keeping the real request within the normal trace budget.
      for (const task of document.tasks) {
        task.sourceText = task.title;
        task.temporalConstraints.forEach(constraint => { constraint.sourceText = task.title; });
        task.workloads.forEach(workload => { workload.sourceText = '数学20分'; });
      }
      const first = await runFixedHandoffReading({ conversationId, userText,
        document, act: 'request_event_registration' });
      expect(first.reading.document.conversationActs).toEqual(first.raw.conversationActs);
      expect(first.result.state.lastQuestionContext).toBeUndefined();
      expect(first.result).toHaveProperty('communicationFacts.statusReason', 'fixed_event_registration_preview');
      expect(first.result.draftCandidates).toHaveLength(studyPreview ? 3 : 2);
      if (studyPreview) expect(first.result.draftCandidates[2]).toMatchObject({ source: 'weekly_exam_prep', durationMinutes: 20 });
      expect(first.result.communicationFacts?.eventRegistration?.unregistered).toEqual([expect.objectContaining({ title: '夜勤', reason: 'crosses_midnight' })]);
      expect(first.result.draftCandidates[1]).toMatchObject({ source: 'fixed_event_registration', title: 'ゼミ',
        stableV5Metadata: { planType: 'study' } });
      expect(first.result.draftCandidates[0]).toMatchObject({ source: 'fixed_event_registration', title: '部活', date: '2026-08-17', startTime: '10:30', endTime: '12:00' });
      expect(first.result.state.shouldCreateDraft).toBe(true);
      expect(first.result.state.shouldSavePlan).toBe(false);
      expect(first.result.state.draftGenerationIntent).toBe(studyPreview ? 'user_authorized' : 'not_requested');
      expect(first.createChatCompletion).toHaveBeenCalledTimes(1);
      expect(rendererClient).toHaveBeenCalledTimes(1);
      expect(first.result.responseSource).toBe(rendererFailure ? 'deterministic_fallback' : 'ai');
      if (!rendererFailure) expect(first.result.message).toContain('11:30–12:00が重複');
      const requestId = normalizeMock.mock.calls[0][0].traceRequestId!;
      const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
      const semanticRequest = first.createChatCompletion.mock.calls[0][0];
      const semanticEvent = events.find(event => event.stage === 'semantic_provider_request')!.data as {
        requestBytes: number; request: { messages: unknown[]; purpose: string };
      };
      expect(semanticEvent.request.messages[semanticEvent.request.messages.length - 1])
        .toEqual(semanticRequest.messages[semanticRequest.messages.length - 1]);
      expect(semanticEvent.requestBytes).toBe(new TextEncoder().encode(JSON.stringify(semanticRequest)).byteLength);
      const sent = rendererClient.mock.calls[0][0];
      const body = JSON.parse(sent.messages[sent.messages.length - 1].content);
      expect(body.applicationDecision.communication).toMatchObject({
        goal: 'present_preview', askQuestion: false, statusReason: 'fixed_event_registration_preview',
        eventRegistration: { eventCreatedByTurn: false, ...(studyPreview ? {} : { workAwaitingAuthorization: [expect.stringContaining('数学')] }), overlaps: [{ date: '2026-08-17', startTime: '11:30', endTime: '12:00', titles: ['部活', 'ゼミ'] }] },
      });
      expect(sent.messages[sent.messages.length - 1].content).toContain('タイトルと未対応理由を必ず明示');
      expect(body.request).toContain('まだ保存していないと明言');
      expect(body.request).toContain('previewPromotionControlLabelを「」で括った行動の一文');
      expect(body.request).toContain('ボタン名だけで終えない');
      if (studyPreview) {
        expect(body.request).toContain('固定候補以外の日時は入力に無い');
        expect(body.request).toContain('日付・時刻を書かず、固定予定の日付（明日等）を掛けない');
        expect(body.request).toContain('日時はプレビューで確認');
      }
      const rendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(first.result.dialogueRendererTrace!);
      if (rendererFailure) {
        expect(rendererTrace.response).toMatchObject({ status: 'fallback', reason: 'provider_error',
          rawResponse: null, renderedText: null });
      } else {
        expect(rendererTrace.response).toMatchObject({ status: 'rendered', reason: null,
          rawResponse: await rendererClient.mock.results[0].value, renderedText: first.result.message });
      }
      expect(rendererTrace.decision.finalMessage).toBe(first.result.message);
      expect(rendererTrace.request?.promptContext).toEqual({ messages: sent.messages,
        requestBytes: new TextEncoder().encode(JSON.stringify(sent.messages)).byteLength });
      const context = rendererTrace.request!.promptContext as Record<string, unknown>;
      context.futureHandoffSentinel = 'fixed-handoff-future-field';
      await recordWeeklyPlanningStableV5TurnTrace({
        ...proposalTraceInput({ conversationId, requestId, userText, result: first.result, events }),
        dialogueRendererTrace: rendererTrace,
      });
      expect(harness.attempts).toHaveLength(1);
      expect(harness.writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toHaveLength(1);
      expect(storage.values.size).toBeGreaterThan(0);
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toHaveLength(1);

      const nextText = 'その対象を登録して';
      const next = await runFixedHandoffReading({ conversationId, userText: nextText,
        document: noNewEventFacts(), act: null,
        acts: [{ kind: 'request_event_registration', targetPublicId: 'does-not-exist' }] });
      expect(next.reading.document.conversationActs).toEqual([{ kind: 'request_event_registration', targetPublicId: null, targetResolution: 'unresolved' }]);
      expect(next.result.preserveExistingPreview).toBe(true);
      expect(next.result.state.draftGenerationIntent).toBe(studyPreview ? 'user_authorized' : 'not_requested');
      expect(next.result.state.lastQuestionContext).toBeUndefined();
      expect(next.result.draftCandidates).toEqual([]);
      expect(next.result.stableV5Graph!.temporalConstraints).toEqual(first.result.stableV5Graph!.temporalConstraints);
      expect(next.createChatCompletion).toHaveBeenCalledTimes(1);
      expect(next.createChatCompletion.mock.calls.map(([request]) => request.responseFormat?.json_schema.name))
        .toEqual(['weekly_planning_semantic_document_v5']);
      expect(rendererClient).toHaveBeenCalledTimes(2);
      const nextId = normalizeMock.mock.calls[1][0].traceRequestId!;
      const nextEvents = takeWeeklyPlanningStableV5DebugTrace(nextId);
      const nextSent = rendererClient.mock.calls[1][0];
      const nextBody = JSON.parse(nextSent.messages[nextSent.messages.length - 1].content);
      expect(nextBody.applicationDecision.communication).toMatchObject({
        goal: 'acknowledge', askQuestion: false,
      });
      const nextTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(next.result.dialogueRendererTrace!);
      if (rendererFailure) {
        expect(nextTrace.response).toMatchObject({ status: 'fallback', reason: 'provider_error',
          rawResponse: null, renderedText: null });
      } else {
        expect(nextTrace.response).toMatchObject({ status: 'rendered', reason: null,
          rawResponse: await rendererClient.mock.results[1].value, renderedText: next.result.message });
      }
      expect(nextTrace.decision.finalMessage).toBe(next.result.message);
      expect(nextTrace.request?.promptContext).toEqual({ messages: nextSent.messages,
        requestBytes: new TextEncoder().encode(JSON.stringify(nextSent.messages)).byteLength });
      const largeContext = nextTrace.request!.promptContext as Record<string, unknown>;
      largeContext.futureLargeHandoffField = '大'.repeat(30_000);
      const originalLargeContextBytes = new TextEncoder().encode(JSON.stringify(largeContext)).byteLength;
      await recordWeeklyPlanningStableV5TurnTrace({
        ...proposalTraceInput({ conversationId, requestId: nextId, userText: nextText,
          result: next.result, events: nextEvents }), dialogueRendererTrace: nextTrace,
      });
      expect(harness.writes).toHaveLength(2);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: 'owner-human-scale', conversationId })).toEqual([]);
      const { observedAt: failedObserved, ...failed } = harness.attempts[0].entries[0];
      const { observedAt: replayObserved, ...replayed } = harness.writes[0].entries[0];
      expect(replayed).toEqual(failed);
      expect(Date.parse(replayObserved!)).toBeGreaterThanOrEqual(Date.parse(failedObserved!));
      const stored = harness.writes.map(write => {
        expect(write.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(write.entries[0]))
          .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const prepared = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
          entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'e'.repeat(43)}`, epoch: '106' }, {
          sessionId: conversationId.replace('weekly-conversation-', 'weekly-trace-'), logicalConversationId: conversationId,
        }, '2026-10-10T00:00:00.000Z');
        expect(prepared.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0]))
          .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        const serialized = JSON.stringify(prepared.entries[0]);
        if (write === harness.writes[0]) {
          expect(serialized).toContain('fixed_event_registration');
          expect(serialized).toContain('fixed_event_registration_preview');
          expect(serialized).toContain('eventCreatedByTurn');
          expect(serialized).toContain('crosses_midnight');
          expect(serialized).toContain('10:30');
          expect(serialized).toContain('12:00');
        }
        expect(serialized).not.toContain('assistantMessageId');
        expect(serialized).not.toContain('planningStateRevision');
        return prepared.entries[0] as unknown as {
          requestId: string; kind: string;
          aiInterpreter: { input: { requests: unknown[] }; structuredResults: unknown[] };
          diagnostics: { dialogueRenderer: { request: { promptContext: Record<string, unknown> }; response: { status: string }; decision: { responseSource: string } } };
        };
      });
      expect(stored.map(entry => entry.requestId)).toEqual([requestId, nextId]);
      for (const [index, actualTrace] of [rendererTrace, nextTrace].entries()) {
        expect(stored[index].diagnostics.dialogueRenderer.response).toEqual(actualTrace.response);
        expect(stored[index].diagnostics.dialogueRenderer.decision).toEqual(actualTrace.decision);
      }
      expect(stored.every(entry => entry.kind === 'turn_diagnostic')).toBe(true);
      expect(stored[0].aiInterpreter.input.requests).toHaveLength(1);
      expect(stored[0].aiInterpreter.input.requests[0]).toMatchObject({
        purpose: semanticEvent.request.purpose, requestBytes: semanticEvent.requestBytes,
      });
      expect(stored[0].aiInterpreter.structuredResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ accepted: true, structuredResult: expect.objectContaining({
          conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }],
        }) }),
      ]));
      expect(stored[1].aiInterpreter.structuredResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ accepted: true, structuredResult: expect.objectContaining({
          conversationActs: [{ kind: 'request_event_registration', targetPublicId: null, targetResolution: 'unresolved' }],
        }) }),
      ]));
      expect(stored[0].diagnostics.dialogueRenderer.request.promptContext).toEqual(context);
      expect(stored[0].diagnostics.dialogueRenderer.response.status).toBe(rendererFailure ? 'fallback' : 'rendered');
      expect(stored[0].diagnostics.dialogueRenderer.decision.responseSource).toBe(rendererFailure ? 'deterministic_fallback' : 'ai');
      const persistedBody = JSON.parse((stored[0].diagnostics.dialogueRenderer.request.promptContext.messages as Array<{ content: string }>)[1].content);
      expect(persistedBody.applicationDecision.communication).toEqual(body.applicationDecision.communication);
      expect(persistedBody.applicationDecision.communication.eventRegistration.unregistered).toEqual(first.result.communicationFacts!.eventRegistration!.unregistered);
      expect(persistedBody.applicationDecision.communication.eventRegistration.candidates).toEqual(first.result.draftCandidates.filter(candidate => candidate.source === 'fixed_event_registration'));
      expect(persistedBody.request).toBe(body.request);
      expect(persistedBody.applicationDecision.communication.eventRegistration.candidates[1].stableV5Metadata.planType).toBe('study');
      if (studyPreview) expect(persistedBody.applicationDecision.communication.eventRegistration).not.toHaveProperty('workAwaitingAuthorization');
      else expect(persistedBody.applicationDecision.communication.eventRegistration.workAwaitingAuthorization).toEqual([expect.stringContaining('数学')]);
      expect(persistedBody.applicationDecision.communication.eventRegistration.overlaps).toEqual([
        { date: '2026-08-17', startTime: '11:30', endTime: '12:00', titles: ['部活', 'ゼミ'] },
      ]);
      const bounded = stored[1].diagnostics.dialogueRenderer.request.promptContext;
      expect(bounded).toMatchObject({ traceTruncated: true, originalBytes: originalLargeContextBytes,
        jsonHead: expect.any(String), jsonTail: expect.any(String) });
      expect(JSON.stringify(largeContext).startsWith(bounded.jsonHead as string)).toBe(true);
      expect(JSON.stringify(largeContext).endsWith(bounded.jsonTail as string)).toBe(true);
      expect(JSON.stringify(stored[1])).not.toContain('大'.repeat(30_000));
    } finally {
      clientSpy.mockRestore();
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      resetWeeklyPlanningStableV5DebugTraceForTest();
      vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', oldTraceEnabled);
      restoreStorage();
    }
  });

});
