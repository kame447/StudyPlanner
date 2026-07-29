import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    schemaVersion: 1 as const,
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
    graphRevision: 1,
    graphSummary: { taskCount: 1 },
    compatibilityState: { status: 'revision_pending' },
    previewCount: 0,
    debugTraceEvents: [
      debugEvent(0, 'runtime_turn_input', {
        userText: '予定を立てたい',
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
    vi.useRealTimers();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('persists exactly one logical diagnostic record per user turn', async () => {
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
    expect(entry.aiInterpreter.input.requests[0].messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'actual user prompt' },
    ]);
    expect(entry.aiInterpreter.rawResponses[0].text).toContain('planningIntent');
    expect(entry.aiInterpreter.structuredResults[0]).toMatchObject({
      accepted: true,
      errors: [],
    });
    expect(entry.decision.finalOperations).toEqual([{ operation: 'set_intent' }]);
    expect(entry.decision.stateDiff).toEqual([{ operation: 'set_intent' }]);
    expect(entry.constraintContext).toMatchObject({
      existingPlanCount: 500,
      scheduleTemplateCount: 20,
    });
  });

  it('does not persist runtime arrays, identity fields, Base64 or chunk metadata', async () => {
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
    expect(harness.writes[0].entries).toHaveLength(1);
    expect(serialized).not.toContain('plan-499');
    expect(serialized).not.toContain('scheduleTemplates');
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('dataChunk');
    expect(serialized).not.toContain('chunkIndex');
    expect(serialized).not.toContain('chunkCount');
    expect(serialized).not.toContain('chunkBytes');
    expect(serialized).not.toContain('base64_utf8_json_chunk');
  });

  it('keeps the logical entry count fixed for zero and five hundred existing plans', async () => {
    const zero = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(zero.repository);
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      conversationId: 'conversation-zero',
      requestId: 'conversation-zero:request:1',
      debugTraceEvents: [debugEvent(0, 'runtime_turn_input', {
        inputCounts: { existingPlanCount: 0, scheduleTemplateCount: 0 },
      })],
    }));

    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    const many = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(many.repository);
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      conversationId: 'conversation-many',
      requestId: 'conversation-many:request:1',
      debugTraceEvents: [debugEvent(0, 'runtime_turn_input', {
        inputCounts: { existingPlanCount: 500, scheduleTemplateCount: 50 },
      })],
    }));

    expect(zero.writes[0].session.entryCount).toBe(1);
    expect(many.writes[0].session.entryCount).toBe(1);
    expect(zero.writes[0].entries).toHaveLength(1);
    expect(many.writes[0].entries).toHaveLength(1);
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
        graphRevision: 2,
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

  it('retries a failed write without consuming sequence or request id', async () => {
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const input = traceInput();
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(harness.writes).toHaveLength(0);
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0].entries[0].sequence).toBe(0);
    expect(harness.writes[0].session.entryCount).toBe(1);
  });

  it('persists zero-count identity before the first append and reuses it after failure', async () => {
    const storageHarness = createMemoryStorageHarness();
    const restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const input = traceInput();

    try {
      await recordWeeklyPlanningStableV5TurnTrace(input);
      const provisional = loadWeeklyPlanningStableV5TraceCursor({
        userId: input.userId,
        conversationId: input.conversationId,
      });
      expect(provisional?.session).toMatchObject({
        schemaVersion: 2,
        turnCount: 0,
        entryCount: 0,
      });
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace(input);
      expect(harness.writes[0].session.id).toBe(provisional?.session.id);
      expect(harness.writes[0].entries[0].sequence).toBe(0);
    } finally {
      restoreWindow();
    }
  });

  it('stores fallback and error diagnostics without stack data', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      outcome: 'provider_failure',
      errorCode: 'ProviderError',
      debugTraceEvents: [debugEvent(0, 'semantic_provider_error', {
        attempt: 'initial',
        error: { name: 'ProviderError', message: 'connection failed', stack: 'secret stack' },
      })],
    }));

    const entry = diagnosticEntry(harness.writes[0]);
    expect(harness.writes[0].session.hasError).toBe(true);
    expect(entry.diagnostics.error).toEqual({
      type: 'ProviderError',
      message: 'connection failed',
    });
    expect(JSON.stringify(entry)).not.toContain('secret stack');
  });
});
