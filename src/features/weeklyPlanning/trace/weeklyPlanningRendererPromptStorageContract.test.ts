import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  boundWeeklyPlanningDialogueRendererTraceForTransport,
  resetWeeklyPlanningDialogueRendererPromptContextsForTest,
  type WeeklyPlanningDialogueRendererTrace,
} from './weeklyPlanningDialogueRendererTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const FUTURE_FIELD_SENTINEL = 'renderer-prompt-field-added-after-trace-contract';

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
        throw new Error('injected trace transport failure');
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

function rendererTrace(promptContext: unknown): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: 'stable-v5:storage-contract:quantity_role_unresolved',
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: ['院試', '第2分野'],
      fallbackText: '第2分野の3時間は、今回進める量ですか、それとも残っている全体量ですか？',
      previewCount: 0,
      promptContext,
    },
    response: {
      status: 'rendered',
      reason: null,
      rawResponse: '{"actionId":"stable-v5:storage-contract:quantity_role_unresolved","text":"確認しています。"}',
      renderedText: '確認しています。',
    },
    decision: {
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: '確認しています。',
    },
  };
}

function traceInput(requestId: string, promptContext: unknown) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId,
    userText: 'どういうこと？',
    assistantMessage: '確認しています。',
    responseSource: 'ai' as const,
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(
      rendererTrace(promptContext),
    ),
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [],
  };
}

function promptContextFromEntry(entry: WeeklyPlanningTraceEntry): unknown {
  if (entry.kind !== 'turn_diagnostic') throw new Error('expected turn diagnostic');
  const diagnostics = entry.diagnostics as Record<string, unknown>;
  const renderer = diagnostics.dialogueRenderer as Record<string, unknown>;
  const request = renderer.request as Record<string, unknown>;
  return request.promptContext;
}

let restoreStorage: (() => void) | undefined;

describe('renderer prompt trace storage contract', () => {
  beforeEach(() => {
    restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreStorage?.();
    restoreStorage = undefined;
  });

  it('preserves newly added prompt fields while keeping the client document bounded', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('conversation-1:request:1', {
      messages: [
        { role: 'system', content: '返答を考えてください。' },
        { role: 'user', content: '{"currentUserMessage":"どういうこと？"}' },
      ],
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    }));

    expect(harness.writes).toHaveLength(1);
    const entry = harness.writes[0].entries[0];
    expect(promptContextFromEntry(entry)).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
  });

  it('keeps prompt context in the persistent outbox and restores it on retry', async () => {
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const firstInput = traceInput('conversation-1:request:1', {
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });

    await recordWeeklyPlanningStableV5TurnTrace(firstInput);
    const pending = listWeeklyPlanningTraceOutboxItems({
      userId: firstInput.userId,
      conversationId: firstInput.conversationId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].input.dialogueRendererTrace?.request?.promptContext).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      'conversation-1:request:2',
      { secondRequest: true },
    ));

    expect(harness.writes).toHaveLength(2);
    const replayed = harness.writes[0].entries[0];
    expect(replayed.requestId).toBe(firstInput.requestId);
    expect(promptContextFromEntry(replayed)).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: firstInput.userId,
      conversationId: firstInput.conversationId,
    })).toEqual([]);
  });

  it('compacts oversized future fields instead of making the whole turn unsavable', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      'conversation-1:request:oversized',
      {
        futurePromptFieldAddedWithoutTraceSchemaChange: 'large-field-segment-'.repeat(8_000),
        tailSentinel: 'end-of-future-field',
      },
    ));

    expect(harness.writes).toHaveLength(1);
    const entry = harness.writes[0].entries[0];
    expect(promptContextFromEntry(entry)).toMatchObject({
      traceTruncated: true,
      originalBytes: expect.any(Number),
      jsonHead: expect.any(String),
      jsonTail: expect.any(String),
    });
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
  });
});
