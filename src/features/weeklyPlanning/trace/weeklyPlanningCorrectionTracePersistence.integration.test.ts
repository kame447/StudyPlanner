import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest, type OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { effortEstimateTargetsWorkload } from '../semantic/weeklyPlanningGenericWorkEstimation';
import { loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceTurnDiagnosticEntry } from './weeklyPlanningTraceTypes';

// Real client with wholly intercepted synthetic transport; no live provider.
vi.mock('../../../lib/aiConfig', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/aiConfig')>(),
  usesCloudflareOpenAiProxy: () => false,
}));

import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
  type WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2';

const repositoryState = vi.hoisted(() => ({
  failWrites: true,
  attempts: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }>,
  successfulWrites: [] as Array<{
    session: Record<string, unknown>;
    entries: Record<string, unknown>[];
  }>,
}));

vi.mock('./weeklyPlanningTraceRepository', () => ({
  isWeeklyPlanningTraceEnabled: () => true,
  getWeeklyPlanningTraceRepository: () => ({
    async appendEntries(params: {
      session: Record<string, unknown>;
      entries: Record<string, unknown>[];
    }) {
      repositoryState.attempts.push(structuredClone(params));
      if (repositoryState.failWrites) throw new Error('intentional trace write failure');
      repositoryState.successfulWrites.push(structuredClone(params));
    },
  }),
}));

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

function correctionTrace(requestId: string): WeeklyPlanningStableV5DebugTraceEvent[] {
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'canonical_correction_application_evaluated',
    data: {
      inputCanonicalization: {
        graph: { secretGraphPayload: 'must-not-be-persisted', facts: 'x'.repeat(40_000) },
      },
      application: { status: 'applied' },
      resultingCanonicalization: {
        graph: { secretGraphPayload: 'must-not-be-persisted' },
      },
    },
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'semantic_canonicalization_evaluated',
    data: {
      branch: 'semantic_canonicalizer',
      result: { status: 'applied' },
      adoptedOperations: {
        fromRevision: 3,
        toRevision: 5,
        superseded: [{ kind: 'workload', id: 'workload-old' }],
        added: [{ kind: 'workload', id: 'workload-new' }],
        removed: [{ kind: 'correction_intent', id: 'correction-1' }],
        futureCorrectionSentinel: { retained: true },
      },
      localReferenceResolution: {
        replacement: 'workload-new',
      },
      rejectionErrors: [],
    },
  });
  return takeWeeklyPlanningStableV5DebugTrace(requestId);
}

function traceInput(params: {
  requestId: string;
  debugTraceEvents: WeeklyPlanningStableV5DebugTraceEvent[];
}) {
  return {
    userId: 'trace-user',
    conversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
    requestId: params.requestId,
    userText: '数学は3時間ではなく1時間にしてください',
    assistantMessage: '数学の時間を1時間に変更しました。',
    responseSource: 'ai' as const,
    outcome: 'scheduler_ready',
    debugTraceEvents: params.debugTraceEvents,
    previewCount: 0,
  };
}

const subject = {
  token: `wpt_${'a'.repeat(43)}`,
  epoch: '100',
};
const canonicalIds = {
  sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
  logicalConversationId: 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000',
};

beforeEach(() => {
  resetOpenAiCompatibleClientRequestBudgetForTest();
  repositoryState.failWrites = true;
  repositoryState.attempts.length = 0;
  repositoryState.successfulWrites.length = 0;
  vi.stubGlobal('window', { localStorage: createStorage() });
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

afterEach(() => {
  resetOpenAiCompatibleClientRequestBudgetForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  vi.unstubAllGlobals();
});

describe('weekly planning correction trace persistence gate', () => {
  it('queues a failed correction diagnostic, retries it, and passes Worker preparation', async () => {
    const firstRequestId = 'weekly-correction-trace-request-1';
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: firstRequestId,
      debugTraceEvents: correctionTrace(firstRequestId),
    }));
    expect(repositoryState.attempts).toHaveLength(1);
    expect(repositoryState.successfulWrites).toHaveLength(0);

    repositoryState.failWrites = false;
    const secondRequestId = 'weekly-correction-trace-request-2';
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      requestId: secondRequestId,
      debugTraceEvents: correctionTrace(secondRequestId),
    }));

    expect(repositoryState.successfulWrites).toHaveLength(2);
    const retried = repositoryState.successfulWrites[0];
    const retriedEntry = retried.entries[0];
    const serialized = JSON.stringify(retriedEntry);
    expect(serialized).not.toContain('must-not-be-persisted');
    expect(serialized).toContain('futureCorrectionSentinel');
    expect(serialized).toContain('workload-old');
    expect(measureWeeklyPlanningTraceJsonBytes(retriedEntry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: retried.session,
      entries: retried.entries,
    }, subject, canonicalIds, '2026-08-01T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain('futureCorrectionSentinel');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('keeps a large correction turn savable with explicit truncation metadata', () => {
    const hugeDiff = Array.from({ length: 400 }, (_, index) => ({
      kind: 'workload',
      id: `workload-${index}`,
      details: 'x'.repeat(1_000),
    }));
    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: `${canonicalIds.sessionId}-00000000`,
      sessionId: canonicalIds.sessionId,
      logicalConversationId: canonicalIds.logicalConversationId,
      sequence: 0,
      turnIndex: 0,
      requestId: 'large-correction-request',
      occurredAt: '2026-08-01T00:00:00.000Z',
      observedAt: '2026-08-01T00:00:00.000Z',
      expireAt: '2026-11-01T00:00:00.000Z',
      userText: '大量の訂正を確認するテスト',
      assistantMessage: '訂正内容を確認しました。',
      outcome: 'scheduler_ready',
      previewCount: 0,
      debugTraceEvents: [{
        schemaVersion: 2,
        sequence: 0,
        stage: 'semantic_canonicalization_evaluated',
        occurredAt: '2026-08-01T00:00:00.000Z',
        severity: 'info',
        data: {
          branch: 'semantic_canonicalizer',
          result: { status: 'applied' },
          adoptedOperations: {
            superseded: hugeDiff,
            added: hugeDiff,
            removed: hugeDiff,
          },
          localReferenceResolution: {},
          rejectionErrors: [],
        },
      }],
    });

    expect(diagnostic.diagnostics.truncation?.applied).toBe(true);
    expect(measureWeeklyPlanningTraceJsonBytes(diagnostic)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: {
        id: canonicalIds.sessionId,
        logicalConversationId: canonicalIds.logicalConversationId,
        userId: 'trace-user',
        status: 'active',
        startedAt: '2026-08-01T00:00:00.000Z',
        lastActivityAt: '2026-08-01T00:00:00.000Z',
        turnCount: 1,
        entryCount: 1,
        hasPreview: false,
        hasApprovalFailure: false,
        hasFallback: false,
        hasError: false,
        appVersion: '0.1.0',
        schemaVersion: 2,
        expireAt: '2026-11-01T00:00:00.000Z',
      },
      entries: [diagnostic as unknown as Record<string, unknown>],
    }, subject, canonicalIds, '2026-08-01T00:00:00.000Z');

    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});


it('persists real explicit-window correction diagnostics through failure, retry and Worker limits', async () => {
  for (const oversized of [false, true]) {
    repositoryState.failWrites = true;
    repositoryState.attempts.length = 0;
    repositoryState.successfulWrites.length = 0;
    window.localStorage.clear();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    let document: WeeklyPlanningSemanticDocumentV5 = {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan',
      planningWindow: { localId: 'old', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日の予定を立てたい' },
      tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
    };
    const pipeline = createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document,
      diagnostics: { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, jsonSchemaName: 'weekly_planning_semantic_document_v5',
        normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
        requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null } }) });
    const schedulerContext = { ownerId: 'trace-user', currentDate: '2026-10-06', planningStartDate: '2026-10-06', planningEndDate: '2026-10-06', timeZone: 'Asia/Tokyo' };
    const first = await pipeline.run({ graph: createEmptyWeeklyPlanningFactGraphV5(), conversationId: canonicalIds.logicalConversationId,
      turnId: 'window-initial', expectedRevision: 0, userText: '明日の予定を立てたい', recentConversation: [], publicStateSummary: {}, schedulerContext });
    const oldId = first.canonicalization!.localToFactId.old;
    document = { ...document, planningIntent: 'update_plan', planningWindow: { ...document.planningWindow!, localId: 'new', value: 'today', sourceText: '明日じゃなくて今日だ' },
      corrections: [{ localId: 'fix', target: { kind: 'planning_window', publicId: oldId, localId: null, mention: '明日' },
        operation: 'replace', replacementLocalId: 'new', sourceText: '明日じゃなくて今日だ' }] };
    const requestId = `window-trace-${oversized ? 'large' : 'small'}`;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    const corrected = await pipeline.run({ graph: first.graph, conversationId: canonicalIds.logicalConversationId,
      turnId: requestId, expectedRevision: first.graph.revision, userText: '明日じゃなくて今日だ', recentConversation: [], publicStateSummary: {}, schedulerContext });
    expect(corrected.canonicalization?.status).toBe('applied');
    const canonical = corrected.canonicalization!;
    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const event = events.find(entry => entry.stage === 'semantic_canonicalization_evaluated')!;
    expect(event).toBeDefined();
    const data = event.data as Record<string, unknown>;
    // Exceed the document budget while staying within the outbox's separate
    // 192 KiB ingress limit; overflowing that queue is intentionally rejected.
    data.adoptedOperations = { ...(data.adoptedOperations as Record<string, unknown>),
      futureWindowCorrectionSentinel: { retained: true }, ...(oversized ? { futureLargePayload: 'x'.repeat(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes * 2) } : {}) };
    await recordWeeklyPlanningStableV5TurnTrace({ ...traceInput({ requestId, debugTraceEvents: events }),
      userText: '明日じゃなくて今日だ', assistantMessage: '予定に入れる作業を教えてください。', outcome: 'nothing_to_schedule' });
    expect(repositoryState.successfulWrites).toHaveLength(0);
    expect(window.localStorage.length).toBeGreaterThan(0);
    repositoryState.failWrites = false;
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({ requestId: `${requestId}-retry`, debugTraceEvents: [] }));
    expect(repositoryState.successfulWrites).toHaveLength(2);
    const retried = repositoryState.successfulWrites[0];
    // Retry rebuilds the observation timestamp; all original diagnostic content stays.
    const originalEntry = repositoryState.attempts[0].entries[0];
    const { observedAt: firstObservedAt, ...originalContent } = originalEntry;
    const { observedAt: retriedObservedAt, ...retriedContent } = retried.entries[0];
    expect(retriedContent).toEqual(originalContent);
    expect(Date.parse(String(retriedObservedAt))).toBeGreaterThanOrEqual(Date.parse(String(firstObservedAt)));
    const entry = retried.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite(retried, subject, canonicalIds, '2026-10-06T00:00:00Z');
    expect(prepared.entries).toHaveLength(1);
    const stored = prepared.entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    const serialized = JSON.stringify(stored);
    if (oversized) {
      expect(serialized).toContain('truncation');
      expect(entry).toMatchObject({ diagnostics: { truncation: { applied: true } } });
    } else {
      expect(serialized).toContain('futureWindowCorrectionSentinel');
      expect(stored).toMatchObject({ decision: { stateDiff: {
        fromRevision: canonical.diff!.fromRevision, toRevision: canonical.diff!.toRevision,
        superseded: expect.arrayContaining([{ kind: 'planning_window', id: oldId }]),
        added: expect.arrayContaining([{ kind: 'planning_window', id: canonical.localToFactId.new }]),
        removed: expect.arrayContaining([{ kind: 'correction_intent', id: canonical.localToFactId.fix }]),
      } } });
      for (const id of [oldId, canonical.localToFactId.new, canonical.localToFactId.fix]) expect(serialized).toContain(id);
      for (const key of ['fromRevision', 'toRevision', 'superseded', 'added', 'removed']) expect(serialized).toContain(`"${key}"`);
      expect(serialized).toContain(`"fromRevision":${canonical.diff!.fromRevision}`);
      expect(serialized).toContain(`"toRevision":${canonical.diff!.toRevision}`);
    }
  }
});

const EXACT_REFERENCE_TEXT = '数学は合計30分です。英語は前のままです。';
const LOCAL_PENDING_REFERENCE_TEXT = '英語は1回30分です。数学はまだ分かりません。';
const EXACT_REFERENCE_SENTINEL = 'future-h2-exact-reference-safe-field';
const TRANSPORT_ONLY_CREDENTIAL = 'synthetic-h2-transport-only';
const EXACT_REFERENCE_WEEK = '2026-10-11';

function exactReferenceTraceFixture(localPending = false) {
  const userText = localPending ? LOCAL_PENDING_REFERENCE_TEXT : EXACT_REFERENCE_TEXT;
  const task = (localId: string, title: string): WeeklyPlanningSemanticDocumentV5['tasks'][number] => ({
    localId, existingPublicId: null, category: 'study', decompositionStatus: 'atomic', title,
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
    durableContextSignals: [], sourceText: userText,
  });
  const workload = (localId: string, amount: number) => ({ localId, quantityRole: 'target' as const,
    amount, unitCode: 'page' as const, unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, sourceText: `${amount}ページ` });
  const base = (): WeeklyPlanningSemanticDocumentV5 => ({
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
  });
  const own = task('setup-math', '数学');
  own.workloads = [workload('setup-a', 12), workload('setup-b', 18)];
  const other = task('setup-english', '英語');
  other.workloads = [workload('setup-c', 9)];
  const setup = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    document: { ...base(), tasks: [own, other] },
    context: { conversationId: canonicalIds.logicalConversationId, turnId: 'exact-setup', expectedRevision: 0 },
  });
  if (setup.status !== 'applied') throw new Error(setup.errors.join(','));
  const ownId = setup.localToFactId[localPending ? 'setup-english' : 'setup-math'];
  const a = setup.localToFactId['setup-a'];
  const b = setup.localToFactId[localPending ? 'setup-c' : 'setup-b'];
  expect([ownId, a, b].every(Boolean)).toBe(true);
  const shell = task('reply-task', localPending ? '英語' : '数学');
  shell.existingPublicId = ownId;
  if (localPending) shell.workloads = [workload('reply-workload', 9)];
  shell.effortEstimates = [{ localId: 'reply-effort', targetLocalId: localPending ? 'reply-workload' : b,
    kind: localPending ? 'session_duration' : 'total_duration',
    minutes: 30, unitCode: localPending ? 'session' : null, precision: 'exact', sourceText: userText }];
  const adopted = { ...base(), tasks: [shell] };
  const discarded = structuredClone(adopted);
  discarded.tasks[0].existingPublicId = setup.localToFactId['setup-math'];
  discarded.tasks[0].workloads = [];
  discarded.tasks[0].effortEstimates[0].targetLocalId = a;
  discarded.tasks[0].temporalConstraints = [{ localId: 'invalid-temporal', targetLocalId: 'undeclared-target',
    kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-10-17', namedTimePeriod: null,
    startTime: null, endTime: null, precision: 'exact', sourceText: userText }];
  return { graph: setup.graph, ownId, a, b, adopted, discarded, userText };
}

function checkpointExactReference(graph: ReturnType<typeof exactReferenceTraceFixture>['graph']) {
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
  expect(saveWeeklyPlanningStableV5PersistedSession({
    ownerId: 'trace-user', weekStartDate: EXACT_REFERENCE_WEEK,
    conversationId: canonicalIds.logicalConversationId, graph,
    planningState: createInitialPlanningState(EXACT_REFERENCE_WEEK),
  })).toBe(true);
  const restored = loadWeeklyPlanningStableV5PersistedSession({ ownerId: 'trace-user', weekStartDate: EXACT_REFERENCE_WEEK });
  expect(restored?.graph).toEqual(graph);
  return restored!.graph;
}

async function generatedExactReferenceTurn(oversized = false, localPending = false) {
  const fixture = exactReferenceTraceFixture(localPending);
  const graph = checkpointExactReference(fixture.graph);
  const before = structuredClone(graph);
  const initialRaw = JSON.stringify(fixture.discarded);
  const compact = JSON.stringify(fixture.adopted);
  const acceptedRaw = oversized ? `{${' '.repeat(6_000)}${compact.slice(1)}` : compact;
  const fallbackRaw = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null,
    minutes: null, precision: null, quantityRole: null });
  const rawResponses = localPending ? [fallbackRaw, acceptedRaw] : [initialRaw, acceptedRaw];
  const attempts = localPending ? ['focused_contextual_answer', 'initial'] : ['initial', 'repair'];
  const acceptedAttempt = localPending ? 'initial' : 'repair';
  const scripted = [...rawResponses];
  const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  const bodies: Record<string, unknown>[] = [];
  const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TRANSPORT_ONLY_CREDENTIAL}`);
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const content = scripted.shift();
    if (content === undefined) throw new Error('exact-reference provider fixture exhausted');
    return Response.json({ choices: [{ message: { content } }] });
  });
  vi.stubGlobal('fetch', transport);
  const client = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: 'https://h2-exact-reference.invalid/v1',
    model: 'gpt-5.4-mini', apiKey: TRANSPORT_ONLY_CREDENTIAL });
  const delegate = client.createChatCompletion.bind(client);
  client.createChatCompletion = async request => { requests.push(structuredClone(request)); return delegate(request); };
  const requestId = `h2-exact-reference-${localPending ? 'local-pending-' : ''}${oversized ? 'large' : 'small'}`;
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  const result = await createWeeklyPlanningSemanticPipelineV5(createWeeklyPlanningSemanticNormalizerV5(client)).run({
    graph, conversationId: canonicalIds.logicalConversationId, turnId: requestId, expectedRevision: graph.revision,
    userText: fixture.userText,
    ...(localPending ? { publicStateSummary: { pendingQuestion: { actionId: 'ask-trace-a',
      questionCode: 'missing_effort_estimate' as const, targetFactId: fixture.a,
      graphRevision: graph.revision, effortMeasurement: 'total_duration' as const } } } : {}),
    schedulerContext: { ownerId: 'trace-user', currentDate: '2026-10-10', planningStartDate: EXACT_REFERENCE_WEEK,
      planningEndDate: '2026-10-17', timeZone: 'Asia/Tokyo' },
  });
  expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics)).toBe('accepted');
  expect(result.canonicalization?.status).toBe('applied');
  expect(result.normalization.document).toEqual(fixture.adopted);
  expect(result.normalization.diagnostics.validationErrors).toEqual(localPending ? [] : ['document.tasks[0].temporalConstraints[0].targetLocalId']);
  expect(graph).toEqual(before);
  expect(transport).toHaveBeenCalledTimes(attempts.length);
  expect(scripted).toEqual([]);
  if (localPending) {
    expect(requests[0].responseFormat?.json_schema.name).toBe('weekly_planning_focused_contextual_answer_v5');
    expect(requests[1].responseFormat?.json_schema.name).toBe('weekly_planning_semantic_document_v5');
  } else {
    expect(requests[1].messages).toContainEqual({ role: 'assistant', content: initialRaw });
  }
  bodies.forEach((body, index) => {
    expect(body.messages).toEqual(requests[index].messages);
    expect(body.response_format).toEqual(requests[index].responseFormat);
    expect(body.max_completion_tokens).toBe(requests[index].maxCompletionTokens);
  });
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  expect(JSON.stringify(events)).not.toContain(TRANSPORT_ONLY_CREDENTIAL);
  const requestEvents = events.filter(event => event.stage === 'semantic_provider_request');
  expect(requestEvents).toHaveLength(attempts.length);
  requestEvents.forEach((event, index) => {
    expect(event.data).toMatchObject({ attempt: attempts[index],
      requestBytes: measureWeeklyPlanningTraceJsonBytes(requests[index]) });
  });
  if (!localPending) {
    const initial = events.find(event => event.stage === 'semantic_validation_result'
      && (event.data as { attempt?: string }).attempt === 'initial');
    expect(initial?.data).toMatchObject({ accepted: false, errors: ['document.tasks[0].temporalConstraints[0].targetLocalId'] });
  }
  const accepted = events.find(event => event.stage === 'semantic_validation_result'
    && (event.data as { attempt?: string }).attempt === acceptedAttempt);
  expect(accepted).toBeDefined();
  const acceptedData = accepted!.data as { accepted: boolean; parsedDocument: Record<string, unknown> };
  expect(acceptedData.accepted).toBe(true);
  expect(acceptedData.parsedDocument).toEqual(result.normalization.document);
  // Safe future diagnostic fields only; all real semantic data remains event-derived.
  acceptedData.parsedDocument = { ...acceptedData.parsedDocument, futureExactReferenceField: EXACT_REFERENCE_SENTINEL,
    ...(oversized ? { futureLargeExactReferenceField: 'x'.repeat(48 * 1024) } : {}) };
  const restored = checkpointExactReference(result.graph);
  expect(restored.tasks).toEqual(graph.tasks);
  expect(restored.workloads).toEqual(graph.workloads);
  expect(restored.components).toEqual(graph.components);
  expect(restored.temporalConstraints).toEqual([]);
  expect(restored.effortEstimates).toEqual([expect.objectContaining({
    taskId: fixture.ownId, targetFactId: fixture.b, kind: localPending ? 'session_duration' : 'total_duration',
    minutes: 30, unitCode: localPending ? 'session' : null,
    source: expect.objectContaining({ turnId: requestId, semanticLocalId: 'reply-effort', sourceText: fixture.userText }),
  })]);
  expect(restored.workloads.map(workload => {
    if (workload.quantityRole !== 'target') throw new Error('exact-reference trace fixture requires target quantities');
    return effortEstimateTargetsWorkload(restored.effortEstimates[0], { ...workload, quantityRole: workload.quantityRole });
  }))
    .toEqual(restored.workloads.map(workload => workload.id === fixture.b));
  return { fixture, result, events, initialRaw, acceptedRaw, requestId, requests, attempts, rawResponses, acceptedAttempt };
}

async function persistGeneratedExactReference(turn: Awaited<ReturnType<typeof generatedExactReferenceTurn>>) {
  const input = { ...traceInput({ requestId: turn.requestId, debugTraceEvents: turn.events }),
    userText: turn.fixture.userText, assistantMessage: '条件を確認しました。', outcome: turn.result.status };
  await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(repositoryState.attempts).toHaveLength(1);
  expect(repositoryState.successfulWrites).toHaveLength(0);
  const queued = listWeeklyPlanningTraceOutboxItems({ userId: input.userId, conversationId: input.conversationId });
  expect(queued).toHaveLength(1);
  expect(queued[0].input).toEqual(input);
  expect(measureWeeklyPlanningTraceJsonBytes(queued[0])).toBeLessThanOrEqual(192 * 1024);
  expect(JSON.stringify(queued)).not.toContain(TRANSPORT_ONLY_CREDENTIAL);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  repositoryState.failWrites = false;
  await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${turn.requestId}:retry`, debugTraceEvents: [] });
  expect(repositoryState.successfulWrites).toHaveLength(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: input.userId, conversationId: input.conversationId })).toEqual([]);
  const replayed = repositoryState.successfulWrites[0];
  const entry = replayed.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
  const original = repositoryState.attempts[0].entries[0];
  const { observedAt: firstObservedAt, ...firstContent } = original;
  const { observedAt, ...replayedContent } = entry;
  expect(replayedContent).toEqual(firstContent);
  expect(Date.parse(observedAt)).toBeGreaterThanOrEqual(Date.parse(String(firstObservedAt)));
  expect(entry.requestId).toBe(turn.requestId);
  expect(repositoryState.successfulWrites[1].entries[0].sequence).toBe(entry.sequence + 1);
  expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  const prepared = prepareWeeklyPlanningTraceServerWrite(replayed, subject, canonicalIds, '2026-10-10T00:00:00.000Z');
  expect(prepared.entries).toHaveLength(1);
  const stored = prepared.entries[0];
  expect(stored.requestId).toBe(turn.requestId);
  expect(stored.aiInterpreter).toEqual(entry.aiInterpreter);
  expect(stored).not.toHaveProperty('userId');
  expect(prepared.session).not.toHaveProperty('userId');
  expect(JSON.stringify(prepared)).not.toContain(TRANSPORT_ONLY_CREDENTIAL);
  expect(measureWeeklyPlanningTraceJsonBytes(stored)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  return { replayed, entry, stored };
}


it('persists rejected A and adopted B evidence from real normalization through reload, outbox retry and Worker', async () => {
  const turn = await generatedExactReferenceTurn();
  const { replayed, entry } = await persistGeneratedExactReference(turn);
  expect(entry.aiInterpreter.input.requests.map(request => request.attempt)).toEqual(['initial', 'repair']);
  entry.aiInterpreter.input.requests.forEach((request, index) => {
    expect(request.requestBytes).toBe(measureWeeklyPlanningTraceJsonBytes(turn.requests[index]));
    expect(request.purpose).toBe(turn.requests[index].purpose);
    expect(request.maxCompletionTokens).toBe(turn.requests[index].maxCompletionTokens);
  });
  expect(entry.aiInterpreter.rawResponses.map(response => response.attempt)).toEqual(['initial', 'repair']);
  for (const [index, rawText] of [turn.initialRaw, turn.acceptedRaw].entries()) {
    expect(entry.aiInterpreter.rawResponses[index]).toMatchObject({ text: rawText, truncated: false });
  }
  expect(JSON.parse(entry.aiInterpreter.rawResponses[0].text).tasks[0].effortEstimates[0].targetLocalId).toBe(turn.fixture.a);
  expect(JSON.parse(entry.aiInterpreter.rawResponses[1].text).tasks[0].effortEstimates[0].targetLocalId).toBe(turn.fixture.b);
  expect(entry.aiInterpreter.structuredResults[0]).toMatchObject({ attempt: 'initial', accepted: false,
    errors: ['document.tasks[0].temporalConstraints[0].targetLocalId'], structuredResult: null });
  const accepted = entry.aiInterpreter.structuredResults.find(result => result.attempt === 'repair' && result.accepted)!;
  expect(accepted.errors).toEqual([]);
  expect(accepted.structuredResult).toEqual({ ...turn.result.normalization.document, futureExactReferenceField: EXACT_REFERENCE_SENTINEL });
  expect(entry.aiInterpreter.input.planningStateSummary).toMatchObject({
    tasks: turn.fixture.graph.tasks.map(task => ({ publicId: task.id, category: task.category, title: task.title })),
  });
  const tampered = structuredClone(replayed);
  (tampered.entries[0].diagnostics as Record<string, unknown>).futureOwnerCheck = { userId: 'synthetic-wrong-owner' };
  expect(() => prepareWeeklyPlanningTraceServerWrite(tampered, subject, canonicalIds, '2026-10-10T00:00:00.000Z'))
    .toThrow('trace turn diagnostic entry schema is invalid');
});

it('keeps an oversized real accepted-reference turn with explicit partial-evidence markers', async () => {
  const turn = await generatedExactReferenceTurn(true);
  const { entry, stored } = await persistGeneratedExactReference(turn);
  const raw = entry.aiInterpreter.rawResponses.find(response => response.attempt === 'repair')!;
  expect(raw.truncated).toBe(true);
  expect(raw.originalBytes).toBe(new TextEncoder().encode(turn.acceptedRaw).byteLength);
  expect(raw.checksum).toMatch(/^fnv1a32:/);
  expect(raw.text).toContain('trace head-tail');
  const accepted = entry.aiInterpreter.structuredResults.find(result => result.attempt === 'repair' && result.accepted)!;
  expect(accepted.structuredResult).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number), checksum: expect.stringMatching(/^fnv1a32:/) });
  expect(entry.diagnostics.truncation).toMatchObject({ applied: true });
  expect(JSON.stringify(entry.diagnostics.truncation)).toContain('aiInterpreter.rawResponses[1].text');
  expect(JSON.stringify(entry.diagnostics.truncation)).toContain('aiInterpreter.structuredResults[1].structuredResult');
  expect(JSON.stringify(stored)).not.toContain('x'.repeat(48 * 1024));
  // Exact final graph targeting was checked separately; truncated trace is partial.
});


it.each([false, true])('persists explicit local B/session with pending A/total through retry and Worker (oversized=%s)', async oversized => {
  const turn = await generatedExactReferenceTurn(oversized, true);
  const { entry, stored } = await persistGeneratedExactReference(turn);
  expect(entry.aiInterpreter.input.requests.map(request => request.attempt)).toEqual(turn.attempts);
  entry.aiInterpreter.input.requests.forEach((request, index) => {
    expect(request.requestBytes).toBe(measureWeeklyPlanningTraceJsonBytes(turn.requests[index]));
    expect(request.purpose).toBe(turn.requests[index].purpose);
    expect(request.maxCompletionTokens).toBe(turn.requests[index].maxCompletionTokens);
  });
  expect(entry.aiInterpreter.rawResponses.map(response => response.attempt)).toEqual(turn.attempts);
  expect(entry.aiInterpreter.structuredResults).toHaveLength(1);
  expect(entry.aiInterpreter.input.planningStateSummary).toMatchObject({ pendingQuestion: {
    targetFactId: turn.fixture.a, effortMeasurement: 'total_duration',
  } });
  const raw = entry.aiInterpreter.rawResponses.find(response => response.attempt === turn.acceptedAttempt)!;
  const accepted = entry.aiInterpreter.structuredResults.find(result => result.attempt === turn.acceptedAttempt && result.accepted)!;
  expect(accepted.errors).toEqual([]);
  if (!oversized) {
    turn.rawResponses.forEach((text, index) => expect(entry.aiInterpreter.rawResponses[index]).toMatchObject({ text, truncated: false }));
    expect(JSON.parse(raw.text).tasks[0]).toMatchObject({ existingPublicId: turn.fixture.ownId,
      workloads: [expect.objectContaining({ localId: 'reply-workload' })],
      effortEstimates: [expect.objectContaining({ targetLocalId: 'reply-workload', kind: 'session_duration' })] });
    expect(accepted.structuredResult).toEqual({ ...turn.result.normalization.document, futureExactReferenceField: EXACT_REFERENCE_SENTINEL });
  } else {
    expect(raw).toMatchObject({ truncated: true, originalBytes: new TextEncoder().encode(turn.acceptedRaw).byteLength,
      checksum: expect.stringMatching(/^fnv1a32:/) });
    expect(raw.text).toContain('trace head-tail');
    expect(accepted.structuredResult).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number),
      checksum: expect.stringMatching(/^fnv1a32:/) });
    expect(entry.diagnostics.truncation).toMatchObject({ applied: true });
    expect(JSON.stringify(entry.diagnostics.truncation)).toContain('aiInterpreter.rawResponses[1].text');
    expect(JSON.stringify(entry.diagnostics.truncation)).toContain('aiInterpreter.structuredResults[0].structuredResult');
    expect(JSON.stringify(stored)).not.toContain('x'.repeat(48 * 1024));
  }
});
