import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5 } from '../semantic/weeklyPlanningSemanticMeaningPolicyV5';
import recordedEffortResponses from '../semantic/testFixtures/recordedEffortSemanticResponses.json';
import { resetWeeklyPlanningStableV5DebugTraceForTest, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
  loadWeeklyPlanningStableV5TraceCursor,
} from './weeklyPlanningStableV5TraceSessionStorage';
import {
  listWeeklyPlanningTraceOutboxItems,
} from './weeklyPlanningTraceOutbox';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  let failuresRemaining = 0;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('injected trace write failure');
      }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return {
    repository,
    writes,
    failNext(count = 1) {
      failuresRemaining = count;
    },
  };
}

function debugEvent(sequence: number, stage: string, data: unknown) {
  return {
    schemaVersion: 2 as const,
    sequence,
    stage,
    occurredAt: `2026-07-29T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    severity: 'debug' as const,
    data,
  };
}

function traceInput(overrides: Partial<Parameters<
  typeof recordWeeklyPlanningStableV5TurnTrace
>[0]> = {}) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId: 'conversation-1:request:1',
    userText: '予定を立てたい',
    assistantMessage: '条件を教えてください。',
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [
      debugEvent(0, 'runtime_turn_input', {
        userText: '予定を立てたい',
        selectedDate: '2026-07-29',
        inputCounts: {
          existingPlanCount: 500,
          scheduleTemplateCount: 20,
        },
      }),
      debugEvent(1, 'runtime_configuration_evaluated', {
        provider: 'openai',
        model: 'gpt-test',
      }),
      debugEvent(2, 'semantic_provider_request', {
        attempt: 'initial',
        requestBytes: 100,
        request: {
          messages: [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'actual user prompt' },
          ],
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: 3200,
          responseFormat: { type: 'json_schema' },
        },
      }),
      debugEvent(3, 'semantic_provider_response', {
        attempt: 'initial',
        rawResponse: '{"planningIntent":"collect_requirements"}',
      }),
      debugEvent(4, 'semantic_validation_result', {
        attempt: 'initial',
        accepted: true,
        errors: [],
        parsedDocument: {
          planningIntent: 'collect_requirements',
          tasks: [],
          relations: [],
          availabilityDeclarations: [],
          constraintSourceRequests: [],
          uncertainties: [],
          corrections: [],
          decisions: [],
        },
      }),
      debugEvent(5, 'semantic_canonicalization_evaluated', {
        branch: 'semantic_canonicalizer',
        result: { status: 'accepted' },
        adoptedOperations: [{ operation: 'set_intent' }],
        rejectionErrors: [],
      }),
      debugEvent(6, 'runtime_branch_selected', {
        branch: 'authorization_required',
      }),
    ],
    ...overrides,
  };
}

function diagnosticEntry(write: { entries: WeeklyPlanningTraceEntry[] }) {
  const entry = write.entries[0];
  if (!entry || entry.kind !== 'turn_diagnostic') {
    throw new Error('expected one turn diagnostic');
  }
  return entry;
}

describe('Stable V5 trace runtime', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('retains the actual effort meaning request through bounded diagnostic outbox retry and Worker preparation', async () => {
    const restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    try {
      const requestId = 'conversation-1:request:effort-contract';
      const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
      const captured = recordedEffortResponses.cases.find((row) => row.sourceRunId === 38064978826)!;
      const normalized = await createWeeklyPlanningSemanticNormalizerV5({
        async createChatCompletion(request) {
          requests.push(request);
          return captured.rawSemanticResponse;
        },
      }).normalize({ userText: recordedEffortResponses.userText, traceRequestId: requestId,
        publicStateSummary: { futureEffortFixtureSentinel: 'future-effort-context' } });
      expect(normalized.status).toBe('accepted');
      expect(requests).toHaveLength(1);
      const actualSystem = requests[0].messages[0].content;
      const actualUser = requests[0].messages[1].content;
      const effortInstruction = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
        (rule) => rule.id === 'effort_measurement',
      )!.instruction;
      expect(actualSystem).toContain(effortInstruction);
      const input = traceInput({ requestId, userText: recordedEffortResponses.userText,
        assistantMessage: undefined, debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId) });
      const harness = createRepositoryHarness();
      harness.failNext();
      setWeeklyPlanningTraceRepositoryForTests(harness.repository);
      await recordWeeklyPlanningStableV5TurnTrace(input);
      expect(harness.writes).toHaveLength(0);
      const queued = listWeeklyPlanningTraceOutboxItems({ userId: input.userId,
        conversationId: input.conversationId });
      expect(queued).toHaveLength(1);
      const queuedRequest = queued[0].input.debugTraceEvents?.find(
        (event) => event.stage === 'semantic_provider_request',
      )?.data as { attempt: string; requestBytes: number;
        request: Pick<typeof requests[0], 'messages' | 'purpose' | 'maxCompletionTokens'> };
      expect(queuedRequest.request.messages).toEqual(requests[0].messages);
      expect(queuedRequest).toMatchObject({ attempt: 'initial', request: {
        purpose: requests[0].purpose, maxCompletionTokens: requests[0].maxCompletionTokens,
      } });
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace(traceInput({ requestId: 'conversation-1:request:after-effort', debugTraceEvents: [] }));
      expect(harness.writes).toHaveLength(2);
      const retried = harness.writes[0];
      const entry = diagnosticEntry(retried);
      expect(entry.requestId).toBe(requestId);
      const persistedRequest = entry.aiInterpreter.input.requests[0];
      expect(persistedRequest).toMatchObject({ attempt: queuedRequest.attempt,
        purpose: requests[0].purpose, maxCompletionTokens: requests[0].maxCompletionTokens,
        requestBytes: queuedRequest.requestBytes });
      const persistedMessages = persistedRequest.messages;
      expect(persistedMessages[1].content).toBe(actualUser);
      expect(persistedMessages[1].content).toContain('future-effort-context');
      const persistedSystem = persistedMessages[0].content;
      const marker = '…[trace truncated]';
      expect(persistedSystem.endsWith(marker)).toBe(true);
      expect(actualSystem.startsWith(persistedSystem.slice(0, -marker.length))).toBe(true);
      expect(persistedSystem).toContain(effortInstruction);
      expect(entry.diagnostics.truncation?.fields).toContain('aiInterpreter.input.requests[0].messages[0].content');
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: retried.session as unknown as Record<string, unknown>,
        entries: retried.entries as unknown as Record<string, unknown>[],
      }, { token: `wpt_${'e'.repeat(43)}`, epoch: '103' }, {
        sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000',
        logicalConversationId: 'weekly-conversation-523e4567-e89b-52d3-a456-426614174000',
      }, '2026-10-10T00:00:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(prepared.session.logicalConversationId).toBe('weekly-conversation-523e4567-e89b-52d3-a456-426614174000');
      expect(prepared.entries[0].logicalConversationId).toBe(prepared.session.logicalConversationId);
      expect(prepared.entries[0].aiInterpreter).toEqual(entry.aiInterpreter);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      expect(listWeeklyPlanningTraceOutboxItems({ userId: input.userId, conversationId: input.conversationId })).toEqual([]);
    } finally { restore(); }
  });

  it('persists exactly one bounded diagnostic record per user turn', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput());

    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0].entries).toHaveLength(1);
    expect(harness.writes[0].session).toMatchObject({
      schemaVersion: 2,
      turnCount: 1,
      entryCount: 1,
    });
    const entry = diagnosticEntry(harness.writes[0]);
    expect(entry.userInput.text).toBe('予定を立てたい');
    expect(entry.assistantOutput.text).toBe('条件を教えてください。');
    expect(entry.assistantOutput.responseSource).toBe('rules');
    expect(entry.aiInterpreter.input.requests[0].messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'actual user prompt' },
    ]);
    expect(entry.aiInterpreter.rawResponses[0].text).toContain('planningIntent');
    expect(entry.decision.finalOperations).toEqual([{ operation: 'set_intent' }]);
    expect(entry.constraintContext).toMatchObject({
      existingPlanCount: 500,
      scheduleTemplateCount: 20,
    });
  });

  it('does not persist full runtime arrays, identity fields, Base64 or chunk metadata', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const fullPlans = Array.from({ length: 500 }, (_, index) => ({
      id: `plan-${index}`,
      userId: 'owner-1',
      date: '2026-08-03',
    }));

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      debugTraceEvents: [
        debugEvent(0, 'runtime_turn_input', {
          runtime: { plans: fullPlans },
          plans: fullPlans,
          scheduleTemplates: Array.from({ length: 200 }, (_, index) => ({ id: index })),
          inputCounts: { existingPlanCount: 500, scheduleTemplateCount: 200 },
        }),
        ...traceInput().debugTraceEvents!.slice(1),
      ],
    }));

    const serialized = JSON.stringify(harness.writes[0].entries);
    expect(serialized).not.toContain('plan-499');
    expect(serialized).not.toContain('scheduleTemplates');
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('dataChunk');
    expect(serialized).not.toContain('base64_utf8_json_chunk');
  });

  it('deduplicates retries with the same request id', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const input = traceInput();

    await recordWeeklyPlanningStableV5TurnTrace(input);
    await recordWeeklyPlanningStableV5TurnTrace(input);

    expect(harness.writes).toHaveLength(1);
  });

  it('resumes the same trace session and sequence after runtime memory is lost', async () => {
    const storageHarness = createMemoryStorageHarness();
    const restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    try {
      await recordWeeklyPlanningStableV5TurnTrace(traceInput());
      const first = harness.writes[0];
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace(traceInput({
        requestId: 'conversation-1:request:2',
        userText: 'OSを復習します',
      }));

      expect(harness.writes).toHaveLength(2);
      expect(harness.writes[1].session.id).toBe(first.session.id);
      expect(harness.writes[1].entries[0].sequence).toBe(1);
      expect(harness.writes[1].session).toMatchObject({ turnCount: 2, entryCount: 2 });
      expect(diagnosticEntry(harness.writes[1]).turnIndex).toBe(1);
    } finally {
      restoreWindow();
    }
  });

  it('stores a failed write in the persistent outbox and replays it after reload', async () => {
    const storageHarness = createMemoryStorageHarness();
    const restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput();

    try {
      await recordWeeklyPlanningStableV5TurnTrace(first);
      expect(harness.writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({
        userId: first.userId,
        conversationId: first.conversationId,
      })).toHaveLength(1);

      const provisional = loadWeeklyPlanningStableV5TraceCursor({
        userId: first.userId,
        conversationId: first.conversationId,
      });
      expect(provisional?.session).toMatchObject({ turnCount: 0, entryCount: 0 });

      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace(traceInput({
        requestId: 'conversation-1:request:2',
        userText: '次の入力',
      }));

      expect(harness.writes).toHaveLength(2);
      expect(harness.writes[0].entries[0]).toMatchObject({ sequence: 0, requestId: first.requestId });
      expect(harness.writes[1].entries[0]).toMatchObject({
        sequence: 1,
        requestId: 'conversation-1:request:2',
      });
      expect(listWeeklyPlanningTraceOutboxItems({
        userId: first.userId,
        conversationId: first.conversationId,
      })).toEqual([]);
    } finally {
      restoreWindow();
    }
  });

  it('marks provider failures as session errors and system responses', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      outcome: 'stable_v5_provider_failure',
      errorCode: 'ProviderError',
      debugTraceEvents: [debugEvent(0, 'semantic_provider_error', {
        attempt: 'initial',
        error: { name: 'ProviderError', message: 'connection failed', stack: 'secret stack' },
      })],
    }));

    const entry = diagnosticEntry(harness.writes[0]);
    expect(harness.writes[0].session.hasError).toBe(true);
    expect(entry.assistantOutput.responseSource).toBe('system');
    expect(entry.diagnostics.error).toEqual({
      type: 'ProviderError',
      message: 'connection failed',
    });
    expect(JSON.stringify(entry)).not.toContain('secret stack');
  });
});
