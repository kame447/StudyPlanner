import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningDialogueRendererTrace } from './weeklyPlanningDialogueRendererTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
  listWeeklyPlanningTraceOutboxItems,
} from './weeklyPlanningTraceOutbox';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

type PersistedRendererDiagnostic = WeeklyPlanningTraceTurnDiagnosticEntry & {
  diagnostics: WeeklyPlanningTraceTurnDiagnosticEntry['diagnostics'] & {
    dialogueRenderer?: WeeklyPlanningDialogueRendererTrace;
  };
};

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

function rendererTrace(
  status: 'rendered' | 'fallback',
): WeeklyPlanningDialogueRendererTrace {
  const fallback = status === 'fallback';
  return {
    actionId: 'stable-v5:conversation-1:request:1:quantity_role_unresolved',
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: ['院試の勉強'],
      fallbackText: '今回進めたい量か、残っている全体量か教えてください。',
      previewCount: 0,
    },
    response: {
      status,
      reason: fallback ? 'provider_error' : null,
      rawResponse: fallback ? null : '{"actionId":"ok","text":"どちらの量ですか？"}',
      renderedText: fallback ? null : 'どちらの量ですか？',
    },
    decision: {
      branch: fallback ? 'deterministic_fallback' : 'ai_rendered',
      responseSource: fallback ? 'deterministic_fallback' : 'ai',
      finalMessage: fallback
        ? '今回進めたい量か、残っている全体量か教えてください。'
        : 'どちらの量ですか？',
    },
  };
}

function traceInput(overrides: Partial<Parameters<
  typeof recordWeeklyPlanningStableV5TurnTrace
>[0]> = {}) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId: 'conversation-1:request:1',
    userText: '院試の勉強を進めたい',
    assistantMessage: 'どちらの量ですか？',
    responseSource: 'ai' as const,
    dialogueRendererTrace: rendererTrace('rendered'),
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [],
    ...overrides,
  };
}

function diagnosticEntry(entries: WeeklyPlanningTraceEntry[]): PersistedRendererDiagnostic {
  const entry = entries[0];
  if (!entry || entry.kind !== 'turn_diagnostic') {
    throw new Error('expected one turn diagnostic');
  }
  return entry as PersistedRendererDiagnostic;
}

describe('Stable V5 renderer trace persistence', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('persists renderer request, raw response and final decision in the turn diagnostic', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const trace = rendererTrace('rendered');

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({ dialogueRendererTrace: trace }));

    expect(harness.writes).toHaveLength(1);
    const entry = diagnosticEntry(harness.writes[0].entries);
    expect(entry.assistantOutput.responseSource).toBe('ai');
    expect(entry.diagnostics.dialogueRenderer).toEqual(trace);
    expect(entry.diagnostics.dialogueRenderer?.request?.purpose).toBe('weekly_planning_renderer');
    expect(entry.diagnostics.dialogueRenderer?.response.rawResponse).toContain('どちらの量ですか');
    expect(entry.diagnostics.dialogueRenderer?.decision).toMatchObject({
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: 'どちらの量ですか？',
    });
  });

  it('keeps session and turn fallback diagnostics consistent for deterministic fallback', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      assistantMessage: '今回進めたい量か、残っている全体量か教えてください。',
      responseSource: 'deterministic_fallback',
      dialogueRendererTrace: rendererTrace('fallback'),
    }));

    expect(harness.writes[0].session.hasFallback).toBe(true);
    const entry = diagnosticEntry(harness.writes[0].entries);
    expect(entry.assistantOutput.responseSource).toBe('deterministic_fallback');
    expect(entry.diagnostics.fallback).toBe('provider_error');
    expect(entry.diagnostics.dialogueRenderer?.response).toMatchObject({
      status: 'fallback',
      reason: 'provider_error',
    });
  });

  it('preserves renderer details when a failed write is replayed from the persistent outbox', async () => {
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
      })[0]?.input.dialogueRendererTrace).toEqual(first.dialogueRendererTrace);

      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace(traceInput({
        requestId: 'conversation-1:request:2',
        userText: '次の入力',
      }));

      expect(harness.writes).toHaveLength(2);
      const replayed = diagnosticEntry(harness.writes[0].entries);
      expect(replayed.requestId).toBe(first.requestId);
      expect(replayed.diagnostics.dialogueRenderer).toEqual(first.dialogueRendererTrace);
      expect(listWeeklyPlanningTraceOutboxItems({
        userId: first.userId,
        conversationId: first.conversationId,
      })).toEqual([]);
    } finally {
      restoreWindow();
    }
  });
});
