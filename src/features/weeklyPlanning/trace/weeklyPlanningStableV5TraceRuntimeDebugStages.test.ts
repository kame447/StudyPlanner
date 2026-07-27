import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
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

function debugEvent(params: {
  sequence: number;
  stage: string;
  data: unknown;
  severity?: 'debug' | 'info' | 'warn' | 'error';
}) {
  return {
    schemaVersion: 1 as const,
    sequence: params.sequence,
    stage: params.stage,
    occurredAt: `2026-07-27T00:00:0${params.sequence}.000Z`,
    severity: params.severity ?? 'debug' as const,
    data: params.data,
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function recordPayload(entry: WeeklyPlanningTraceEntry): Record<string, unknown> {
  if (entry.kind !== 'internal_event' || !entry.payload || typeof entry.payload !== 'object') {
    throw new Error('expected an internal event payload');
  }
  return entry.payload as Record<string, unknown>;
}

beforeEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

afterEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
});

describe('Stable V5 trace runtime debug stages', () => {
  it('stores each stage as an independent entry and uses the actual input graph revision', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:4',
      userText: '今回使う期間とは？',
      assistantMessage: '予定を組む対象の日のことです。',
      outcome: 'revision_pending',
      graphRevision: 4,
      graphSummary: { taskCount: 4 },
      compatibilityState: {
        status: 'revision_pending',
        __stableV5DebugTrace: {
          schemaVersion: 1,
          eventCount: 2,
          storage: 'stable_v5_debug_stage_entries',
        },
      },
      debugTraceEvents: [
        debugEvent({
          sequence: 0,
          stage: 'runtime_session_context_prepared',
          data: {
            graphRevision: 3,
            runtimeSession: { graph: { revision: 3 } },
          },
        }),
        debugEvent({
          sequence: 1,
          stage: 'semantic_provider_request',
          data: {
            attempt: 'initial',
            request: {
              messages: [
                { role: 'system', content: 'complete system prompt' },
                { role: 'user', content: 'complete user prompt' },
              ],
            },
          },
        }),
      ],
      previewCount: 0,
    });

    expect(harness.writes).toHaveLength(1);
    const entries = harness.writes[0].entries;
    expect(entries.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: entries.length }, (_, index) => index),
    );
    const userTurn = entries.find(
      (entry) => entry.kind === 'turn' && entry.role === 'user',
    );
    const started = entries.find(
      (entry) => entry.kind === 'internal_event'
        && entry.eventType === 'interpreter_started',
    );
    expect(userTurn?.stateRevision).toBe(3);
    expect(started).toMatchObject({
      stateRevision: 3,
      payload: { previousGraphRevision: 3 },
    });

    const stages = entries.filter(
      (entry) => entry.kind === 'internal_event'
        && entry.eventType === 'stable_v5_debug_stage',
    );
    expect(stages).toHaveLength(2);
    expect(stages).toMatchObject([
      {
        stateRevision: 3,
        payload: {
          debugSequence: 0,
          stage: 'runtime_session_context_prepared',
          storage: 'inline_json',
          data: { graphRevision: 3 },
        },
      },
      {
        stateRevision: 3,
        payload: {
          debugSequence: 1,
          stage: 'semantic_provider_request',
          storage: 'inline_json',
          data: {
            request: {
              messages: [
                { role: 'system', content: 'complete system prompt' },
                { role: 'user', content: 'complete user prompt' },
              ],
            },
          },
        },
      },
    ]);

    const snapshot = entries.find((entry) => entry.kind === 'state_snapshot');
    expect(snapshot).toMatchObject({
      state: {
        inputGraphRevision: 3,
        graphRevision: 4,
        debugTraceSummary: {
          storage: 'stable_v5_debug_stage_entries',
          eventCount: 2,
          persistedEntryCount: 2,
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('complete system prompt');
  });

  it('chunks and reconstructs an oversized stage without dropping its JSON data', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const rawResponse = 'あ'.repeat(400_000);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-large',
      requestId: 'conversation-large:request:1',
      userText: '大きい応答を記録する',
      assistantMessage: '記録しました。',
      outcome: 'revision_pending',
      graphRevision: 1,
      graphSummary: {},
      debugTraceEvents: [
        debugEvent({
          sequence: 0,
          stage: 'semantic_provider_response',
          data: { attempt: 'initial', rawResponse },
        }),
      ],
      previewCount: 0,
    });

    const stages = harness.writes[0].entries.filter(
      (entry) => entry.kind === 'internal_event'
        && entry.eventType === 'stable_v5_debug_stage',
    );
    expect(stages.length).toBeGreaterThan(1);
    expect(stages.every((entry) => recordPayload(entry).storage === 'base64_utf8_json_chunk')).toBe(true);
    expect(stages.every(
      (entry) => new TextEncoder().encode(JSON.stringify(entry)).byteLength < 800_000,
    )).toBe(true);

    const ordered = stages
      .slice()
      .sort((left, right) => Number(recordPayload(left).chunkIndex) - Number(recordPayload(right).chunkIndex));
    const decodedChunks = ordered.map((entry) => decodeBase64(String(recordPayload(entry).dataChunk)));
    const totalBytes = decodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const reconstructed = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of decodedChunks) {
      reconstructed.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(reconstructed));
    expect(parsed).toEqual({ attempt: 'initial', rawResponse });

    const snapshot = harness.writes[0].entries.find((entry) => entry.kind === 'state_snapshot');
    expect(snapshot).toMatchObject({
      state: {
        debugTraceSummary: {
          eventCount: 1,
          persistedEntryCount: stages.length,
        },
      },
    });
  });

  it('records stale execution disposal without a phantom assistant turn or preview', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:5',
      userText: 'この条件で予定を作って',
      outcome: 'discarded_stale',
      graphRevision: 3,
      graphSummary: { taskCount: 4 },
      compatibilityState: {
        __discardedExecution: {
          reason: 'stale',
          resultMessage: '候補を作りました。',
          candidateCount: 1,
        },
      },
      debugTraceEvents: [
        debugEvent({
          sequence: 0,
          stage: 'runtime_session_context_prepared',
          data: { graphRevision: 2 },
        }),
        debugEvent({
          sequence: 1,
          stage: 'runtime_branch_selected',
          data: { branch: 'preview_ready' },
        }),
      ],
      previewCount: 0,
      errorCode: 'stale_async_result_discarded',
    });

    const entries = harness.writes[0].entries;
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'internal_event',
        eventType: 'stale_async_result_discarded',
        severity: 'warn',
      }),
    ]));
    expect(entries.some(
      (entry) => entry.kind === 'internal_event'
        && entry.eventType === 'preview_generated',
    )).toBe(false);
    expect(entries.filter((entry) => entry.kind === 'turn')).toMatchObject([
      { role: 'user', content: 'この条件で予定を作って' },
    ]);
    expect(harness.writes[0].session.hasPreview).toBe(false);
    expect(harness.writes[0].session.hasError).toBe(true);
  });
});
