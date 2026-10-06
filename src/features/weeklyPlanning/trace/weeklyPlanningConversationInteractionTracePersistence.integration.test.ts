import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../application/weeklyPlanningStableV5RuntimeSession';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedConversationTurn,
  type ScriptedProviderCall,
  type ScriptedProviderReply,
} from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from './weeklyPlanningDialogueRendererTrace';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
  takeWeeklyPlanningStableV5DebugTrace,
  type WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

/*
 * Trace persistence gate for the conversation-interaction fields (Issue #488).
 * Turns are real (scripted provider, real controller/runtime); the recorded debug
 * events then cross the real outbox and the Worker preparation.
 *
 * PERSISTED (proved below): the semantic request prompt/schema (conversationActs rule),
 * the raw and validated conversationActs, and the renderer input fields
 * conversationOutcome / consultationDeferred (renderer prompt context). Recovery turns
 * persist the recorded failure code.
 *
 * EXCLUDED from the durable turn diagnostic, on purpose: `interactionOutcome` and the
 * `pendingQuestionPresentation` status. They are enum-only machine state that is kept in
 * the in-memory debug trace; the durable diagnostic would need a new Worker/shared schema
 * field for no information that is not already persisted: the outcome is recoverable from
 * conversationActs + conversationOutcome + failure code, and freshness from whether
 * planningStateSummary.pendingQuestion is present. Both substitutes are asserted here.
 */

const USER_ID = 'owner-conversation-interaction-trace';
const CONVERSATION_ID = 'weekly-conversation-623e4567-e89b-42d3-a456-426614174000';
const WEEK = '2026-10-05';
const MATH_SETUP = '来週、数学の問題集を20問進めたい';
const FUTURE_FIELD_SENTINEL = 'future-act-field-sentinel-488';
const subject = { token: `wpt_${'f'.repeat(43)}`, epoch: '105' };
const canonicalIds = {
  sessionId: 'weekly-trace-623e4567-e89b-42d3-a456-426614174000',
  logicalConversationId: CONVERSATION_ID,
};

type Json = Record<string, unknown>;

function emptyDocument(overrides: Json = {}): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null, tasks: [],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides,
  };
}

function mathSetup(): Json {
  return emptyDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [{
      localId: 't', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
      workloads: [{
        localId: 'wl', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学の問題集を20問',
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
      sourceText: '数学の問題集を20問進めたい',
    }],
  });
}

function repositoryHarness() {
  const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
  let failuresRemaining = 0;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('injected conversation interaction trace failure');
      }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { repository, writes, failNext() { failuresRemaining += 1; } };
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let script: (call: ScriptedProviderCall) => ScriptedProviderReply | undefined;
let restoreStorage: (() => void) | undefined;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetScriptedConversationRuntime();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  script = () => undefined;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    const scripted = script(call);
    if (scripted !== undefined) return scripted;
    if (call.kind === 'renderer') return 'renderer unavailable in fixture';
    if (call.kind === 'semantic_focused_contextual') {
      return JSON.stringify({
        decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null,
      });
    }
    return JSON.stringify(String(call.payload?.userText ?? '') === MATH_SETUP ? mathSetup() : emptyDocument());
  });
});

afterEach(() => {
  provider.restore();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage?.();
  restoreStorage = undefined;
});

async function realTurns() {
  const conversation = createScriptedConversation({
    provider, ownerId: USER_ID, conversationId: CONVERSATION_ID, weekStartDate: WEEK,
  });
  await conversation.submit(MATH_SETUP);
  script = (call) => {
    if (call.kind === 'semantic_generic') {
      return JSON.stringify(emptyDocument({
        conversationActs: [
          { kind: 'ask_about_pending_question', targetPublicId: null, sourceText: 'なんで時間が必要？' },
          { kind: 'consultation_request', targetPublicId: null, sourceText: 'なんで時間が必要？' },
        ],
      }));
    }
    if (call.kind === 'renderer') return scriptedRendererReply(call, '時間が分かると無理なく配分できます。1問あたり何分ですか？');
    return undefined;
  };
  const explanation = await conversation.submit('なんで時間が必要？');
  script = (call) => (call.kind === 'semantic_generic' ? 'not a semantic document' : undefined);
  const recovery = await conversation.submit('えっと、それは');
  return { explanation, recovery };
}

function traceInput(turn: ScriptedConversationTurn, events: WeeklyPlanningStableV5DebugTraceEvent[]) {
  const result = turn.result!;
  return {
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    requestId: turn.requestId!,
    userText: 'turn',
    assistantMessage: result.message,
    responseSource: result.responseSource,
    // Production bounds the renderer trace (attaching its prompt context) before recording.
    dialogueRendererTrace: result.dialogueRendererTrace
      ? boundWeeklyPlanningDialogueRendererTraceForTransport(result.dialogueRendererTrace)
      : undefined,
    outcome: 'question',
    debugTraceEvents: events,
    previewCount: 0,
  };
}

/** Goes through the real recorder, so the event is bounded exactly as in production. */
function withExtraEvent(
  events: WeeklyPlanningStableV5DebugTraceEvent[],
  data: unknown,
): WeeklyPlanningStableV5DebugTraceEvent[] {
  const requestId = `${CONVERSATION_ID}:request:synthetic-${events.length}`;
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_validation_result', data });
  return [...events, ...takeWeeklyPlanningStableV5DebugTrace(requestId).map((event) => ({
    ...event, sequence: events.length + 100,
  }))];
}

async function persistThroughOutbox(inputs: ReturnType<typeof traceInput>[]) {
  const harness = repositoryHarness();
  harness.failNext();
  setWeeklyPlanningTraceRepositoryForTests(harness.repository);
  await recordWeeklyPlanningStableV5TurnTrace(inputs[0]);
  // Point 3: the first append failed, so the turn must be waiting in the persistent outbox.
  expect(harness.writes).toHaveLength(0);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  for (const input of inputs.slice(1)) await recordWeeklyPlanningStableV5TurnTrace(input);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toEqual([]);
  expect(harness.writes.flatMap((write) => write.entries)).toHaveLength(inputs.length);
  return harness;
}

/** The persisted entry for a request, with its Worker-prepared counterpart. */
function persistedFor(harness: ReturnType<typeof repositoryHarness>, requestId: string) {
  const writeIndex = harness.writes.findIndex((write) =>
    write.entries.some((entry) => (entry as unknown as { requestId?: string }).requestId === requestId));
  expect(writeIndex).toBeGreaterThanOrEqual(0);
  const entry = harness.writes[writeIndex].entries.find(
    (candidate) => (candidate as unknown as { requestId?: string }).requestId === requestId,
  )!;
  const workerPrepared = prepareWeeklyPlanningTraceServerWrite({
    session: harness.writes[writeIndex].session as unknown as Record<string, unknown>,
    entries: harness.writes[writeIndex].entries as unknown as Record<string, unknown>[],
  }, subject, canonicalIds, '2026-10-07T00:00:00.000Z');
  const preparedEntry = workerPrepared.entries.find((candidate) =>
    (candidate as unknown as { requestId?: string }).requestId === requestId);
  expect(preparedEntry).toBeDefined();
  return { entry, preparedEntry: preparedEntry! };
}

function expectBounded(entry: unknown, workerEntry: unknown) {
  // Points 2 and 5.
  expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
    WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
  );
  expect(measureWeeklyPlanningTraceJsonBytes(workerEntry)).toBeLessThanOrEqual(
    WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
  );
}

describe('conversation interaction trace persistence gate', () => {
  it('carries the real request, acts, outcome, freshness and renderer input through outbox retry and Worker preparation', async () => {
    const { explanation, recovery } = await realTurns();
    // Point 1: the recorded events contain what was actually sent / produced.
    const events = explanation.debugTrace;
    const providerRequest = events.filter((event) => event.stage === 'semantic_provider_request')
      .map((event) => JSON.stringify(event.data)).join('');
    expect(providerRequest).toContain('conversationActs');
    expect(JSON.stringify(events.find((event) => event.stage === 'semantic_validation_result')?.data))
      .toContain('ask_about_pending_question');
    expect(JSON.stringify(events.find((event) => event.stage === 'runtime_session_context_prepared')?.data))
      .toContain('"pendingQuestionPresentation":"fresh"');
    expect(JSON.stringify(events.find((event) => event.stage === 'turn_executor_result_projected')?.data))
      .toContain('explain_pending_question');
    expect(JSON.stringify(recovery.debugTrace.find((event) => event.stage === 'runtime_branch_selected')?.data))
      .toContain('"kind":"recover"');

    const harness = await persistThroughOutbox([
      traceInput(explanation, explanation.debugTrace),
      traceInput(recovery, recovery.debugTrace),
    ]);

    const explained = persistedFor(harness, explanation.requestId!);
    const serialized = JSON.stringify(explained.entry);
    for (const marker of [
      'conversationActs', 'ask_about_pending_question', 'consultation_request',
      // Renderer input fields persist through the renderer prompt context.
      'conversationOutcome', 'explain_pending_question', 'consultationDeferred',
      // Freshness substitute: the typed pending question was offered to the model.
      '"pendingQuestion":{"actionId":null,"questionCode":"missing_effort_estimate"',
    ]) expect(serialized).toContain(marker);
    const recovered = persistedFor(harness, recovery.requestId!);
    expect(JSON.stringify(recovered.entry)).toContain('stable_v5_normalization_rejected');

    // Deliberate exclusion: the enum-only machine fields exist in the in-memory debug
    // trace but are not durable-diagnostic fields.
    expect(JSON.stringify(explanation.debugTrace)).toContain('"interactionOutcome":{"kind":"explain_pending_question"');
    expect(JSON.stringify(explanation.debugTrace)).toContain('"pendingQuestionPresentation":"fresh"');
    for (const entry of [explained.entry, recovered.entry]) {
      expect(JSON.stringify(entry)).not.toContain('interactionOutcome');
      expect(JSON.stringify(entry)).not.toContain('pendingQuestionPresentation');
    }

    // Points 4 and 5 for both turns (the Worker keeps the same information).
    for (const marker of ['conversationActs', 'conversationOutcome', 'consultationDeferred']) {
      expect(JSON.stringify(explained.preparedEntry)).toContain(marker);
    }
    expect(JSON.stringify(recovered.preparedEntry)).toContain('stable_v5_normalization_rejected');
    expectBounded(explained.entry, explained.preparedEntry);
    expectBounded(recovered.entry, recovered.preparedEntry);
  });

  it('shows that an aside leaves no fresh pending question in the next persisted request', async () => {
    const conversation = createScriptedConversation({
      provider, ownerId: USER_ID, conversationId: CONVERSATION_ID, weekStartDate: WEEK,
    });
    await conversation.submit(MATH_SETUP);
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({
          conversationActs: [{ kind: 'topic_shift', targetPublicId: null, sourceText: 'ちょっと別の話' }],
        }))
      : undefined);
    const aside = await conversation.submit('ちょっと別の話');
    script = () => undefined;
    const next = await conversation.submit('うん');

    const harness = await persistThroughOutbox([traceInput(aside, aside.debugTrace), traceInput(next, next.debugTrace)]);
    const afterAside = JSON.stringify(persistedFor(harness, next.requestId!).entry);
    expect(afterAside).toContain('"pendingQuestion":null');
    expect(afterAside).not.toContain('"pendingQuestion":{"actionId"');
  });

  it('keeps an unregistered future act field through retry and Worker preparation (no schema-sync loss)', async () => {
    const { explanation } = await realTurns();
    const events = withExtraEvent(explanation.debugTrace, {
      attempt: 'initial',
      accepted: true,
      errors: [],
      parsedDocument: {
        conversationActs: [{
          kind: 'topic_shift', targetPublicId: null, sourceText: 'x', futureActField: FUTURE_FIELD_SENTINEL,
        }],
        futureConversationEnvelopeField: FUTURE_FIELD_SENTINEL,
      },
    });
    const harness = await persistThroughOutbox([traceInput(explanation, events), { ...traceInput(explanation, []), requestId: `${CONVERSATION_ID}:request:flush` }]);

    const kept = persistedFor(harness, explanation.requestId!);
    // Both the new act-level field and the new envelope-level field survive each hop.
    for (const text of [JSON.stringify(kept.entry), JSON.stringify(kept.preparedEntry)]) {
      expect(text.split(FUTURE_FIELD_SENTINEL).length - 1).toBeGreaterThanOrEqual(2);
    }
    expectBounded(kept.entry, kept.preparedEntry);
  });

  it('truncates an oversized act list with explicit information instead of discarding the turn', async () => {
    const { explanation } = await realTurns();
    const hugeActs = Array.from({ length: 120 }, (_, index) => ({
      kind: 'topic_shift', targetPublicId: null, sourceText: `act-${index}-${'あ'.repeat(6_000)}`,
    }));
    const events = withExtraEvent(explanation.debugTrace, {
      attempt: 'initial', accepted: true, errors: [], parsedDocument: { conversationActs: hugeActs },
    });
    const harness = await persistThroughOutbox([traceInput(explanation, events), { ...traceInput(explanation, []), requestId: `${CONVERSATION_ID}:request:flush` }]);

    const kept = persistedFor(harness, explanation.requestId!);
    const serialized = JSON.stringify(kept.entry);
    // The turn is still saved with its real outcome, and the cut is explicit.
    expect(serialized).toContain('explain_pending_question');
    expect(serialized).toMatch(/traceTruncatedItems|trace truncated|traceProjectionTruncated|…/);
    expect(serialized).not.toContain('あ'.repeat(6_000));
    expectBounded(kept.entry, kept.preparedEntry);
  });
});
