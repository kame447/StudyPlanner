import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningStableV5DebugStageExport,
} from './weeklyPlanningTraceExport';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceInternalEventEntry,
} from './weeklyPlanningTraceTypes';

function baseEntry(sequence: number) {
  return {
    id: `session-1-${String(sequence).padStart(8, '0')}`,
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'owner-1',
    sequence,
    requestId: 'conversation-1:request:1',
    stateRevision: 3,
    occurredAt: '2026-07-27T00:00:00.000Z',
    observedAt: '2026-07-27T00:00:00.000Z',
    schemaVersion: 1,
    expireAt: '2026-10-25T00:00:00.000Z',
  };
}

function debugEntry(
  sequence: number,
  payload: Record<string, unknown>,
): WeeklyPlanningTraceInternalEventEntry {
  return {
    ...baseEntry(sequence),
    kind: 'internal_event',
    eventType: 'stable_v5_debug_stage',
    payload,
    severity: 'debug',
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function chunkEntries(data: unknown): WeeklyPlanningTraceEntry[] {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const midpoint = Math.ceil(bytes.length / 2);
  const chunks = [bytes.slice(0, midpoint), bytes.slice(midpoint)];
  return chunks.map((chunk, chunkIndex) => debugEntry(chunkIndex, {
    debugSchemaVersion: 1,
    debugSequence: 7,
    stage: 'semantic_provider_response',
    stageOccurredAt: '2026-07-27T00:00:07.000Z',
    sourceSanitizerTruncated: false,
    storage: 'base64_utf8_json_chunk',
    encoding: 'base64-utf8-json',
    chunkIndex,
    chunkCount: chunks.length,
    totalSerializedBytes: bytes.byteLength,
    chunkBytes: chunk.byteLength,
    dataChunk: encodeBase64(chunk),
  }));
}

describe('Stable V5 debug stage export', () => {
  it('exports inline stage data in request order', () => {
    const stages = createWeeklyPlanningStableV5DebugStageExport([
      debugEntry(3, {
        debugSchemaVersion: 1,
        debugSequence: 1,
        stage: 'semantic_provider_request',
        stageOccurredAt: '2026-07-27T00:00:01.000Z',
        sourceSanitizerTruncated: false,
        storage: 'inline_json',
        serializedBytes: 10,
        data: {
          request: {
            messages: [{ role: 'system', content: 'full system prompt' }],
          },
        },
      }),
    ]);

    expect(stages).toEqual([
      {
        requestId: 'conversation-1:request:1',
        debugSequence: 1,
        stage: 'semantic_provider_request',
        stageOccurredAt: '2026-07-27T00:00:01.000Z',
        severity: 'debug',
        stateRevision: 3,
        storage: 'inline_json',
        sourceEntryIds: ['session-1-00000003'],
        sourceSanitizerTruncated: false,
        data: {
          request: {
            messages: [{ role: 'system', content: 'full system prompt' }],
          },
        },
      },
    ]);
  });

  it('reassembles base64 UTF-8 JSON chunks into one readable logical stage', () => {
    const data = {
      attempt: 'repair',
      rawResponse: '日本語を含む完全なAI応答',
      validationErrors: ['invalid_reference'],
    };

    const stages = createWeeklyPlanningStableV5DebugStageExport(chunkEntries(data));

    expect(stages).toEqual([
      expect.objectContaining({
        requestId: 'conversation-1:request:1',
        debugSequence: 7,
        stage: 'semantic_provider_response',
        storage: 'reassembled_base64_utf8_json',
        sourceEntryIds: ['session-1-00000000', 'session-1-00000001'],
        data,
      }),
    ]);
    expect(stages[0].reconstructionError).toBeUndefined();
  });

  it('keeps a visible reconstruction error when a chunk is missing', () => {
    const entries = chunkEntries({ rawResponse: 'complete' });

    const stages = createWeeklyPlanningStableV5DebugStageExport(entries.slice(0, 1));

    expect(stages).toEqual([
      expect.objectContaining({
        storage: 'reassembled_base64_utf8_json',
        reconstructionError: 'missing-chunk:1/2',
      }),
    ]);
    expect(stages[0].data).toBeUndefined();
  });
});
