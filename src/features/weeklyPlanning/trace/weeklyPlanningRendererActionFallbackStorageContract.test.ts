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

function repositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  let shouldFail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('injected initial trace failure');
      }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { repository, writes };
}

function rendererTrace(): WeeklyPlanningDialogueRendererTrace {
  const rawResponse = JSON.stringify({
    actionId: 'stable-v5:tomorrow:missing_schedulable_work',
    text: '明日1日分の予定ですね。では、明日の予定を作ります。',
  });
  return {
    actionId: 'stable-v5:tomorrow:missing_schedulable_work',
    actionKind: 'question',
    questionCode: 'missing_schedulable_work',
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: [],
      fallbackText: '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
      previewCount: 0,
      promptContext: {
        messages: [
          { role: 'system', content: '自然な日本語を考えてください。' },
          { role: 'user', content: '{"currentUserMessage":"明日"}' },
        ],
      },
    },
    response: {
      status: 'fallback',
      reason: 'ungrounded_text',
      rawResponse,
      renderedText: null,
    },
    decision: {
      branch: 'deterministic_fallback',
      responseSource: 'deterministic_fallback',
      finalMessage: '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
    },
  };
}

function traceInput(requestId: string) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-tomorrow',
    requestId,
    userText: '明日',
    assistantMessage: '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
    responseSource: 'deterministic_fallback' as const,
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(rendererTrace()),
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [],
  };
}

function rendererDiagnostic(entry: WeeklyPlanningTraceEntry): Record<string, unknown> {
  if (entry.kind !== 'turn_diagnostic') throw new Error('expected turn diagnostic');
  const diagnostics = entry.diagnostics as Record<string, unknown>;
  return diagnostics.dialogueRenderer as Record<string, unknown>;
}

let restoreStorage: (() => void) | undefined;

describe('renderer action fallback storage contract', () => {
  beforeEach(() => {
    restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreStorage?.();
    restoreStorage = undefined;
  });

  it('preserves the false-creation fallback reason and prompt through outbox retry', async () => {
    const harness = repositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput('conversation-tomorrow:request:1');

    await recordWeeklyPlanningStableV5TurnTrace(first);
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: first.userId,
      conversationId: first.conversationId,
    })).toHaveLength(1);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(
      traceInput('conversation-tomorrow:request:2'),
    );

    expect(harness.writes).toHaveLength(2);
    const replayed = harness.writes[0].entries[0];
    const renderer = rendererDiagnostic(replayed);
    expect(renderer).toMatchObject({
      actionKind: 'question',
      questionCode: 'missing_schedulable_work',
      request: {
        previewCount: 0,
        promptContext: {
          messages: expect.any(Array),
        },
      },
      response: {
        status: 'fallback',
        reason: 'ungrounded_text',
        rawResponse: expect.stringContaining('明日の予定を作ります'),
      },
      decision: {
        branch: 'deterministic_fallback',
        responseSource: 'deterministic_fallback',
        finalMessage: expect.stringContaining('何をどれくらい'),
      },
    });
    expect(measureWeeklyPlanningTraceJsonBytes(replayed)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: first.userId,
      conversationId: first.conversationId,
    })).toEqual([]);
  });
});
