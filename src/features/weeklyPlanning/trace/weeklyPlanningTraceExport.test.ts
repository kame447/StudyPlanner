import { describe, expect, it } from 'vitest';
import {
  encodeWeeklyPlanningTraceDebugChunkBase64,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  createWeeklyPlanningEvaluationFixtureCandidate,
  createWeeklyPlanningRoleplayCandidate,
  createWeeklyPlanningStableV5DebugStageExport,
  createWeeklyPlanningTraceExportBundle,
} from './weeklyPlanningTraceExport';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const session: WeeklyPlanningTraceSession = {
  id: 'session-1',
  logicalConversationId: 'conversation-1',
  userId: 'user-1',
  status: 'completed',
  startedAt: '2026-07-15T00:00:00.000Z',
  lastActivityAt: '2026-07-15T00:01:00.000Z',
  endedAt: '2026-07-15T00:01:00.000Z',
  turnCount: 2,
  entryCount: 5,
  hasPreview: true,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 1,
  expireAt: '2026-10-13T00:00:00.000Z',
};

function baseEntry(sequence: number) {
  return {
    id: `session-1-${sequence}`,
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'user-1',
    sequence,
    occurredAt: `2026-07-15T00:00:0${sequence}.000Z`,
    observedAt: `2026-07-15T00:00:0${sequence}.000Z`,
    schemaVersion: 1,
    expireAt: '2026-10-13T00:00:00.000Z',
  };
}

const entries: WeeklyPlanningTraceEntry[] = [
  {
    ...baseEntry(0),
    kind: 'turn',
    role: 'user',
    content: '連絡先は test@example.com、予定は https://example.com です',
    turnIndex: 0,
  },
  {
    ...baseEntry(1),
    kind: 'internal_event',
    eventType: 'interpreter_completed',
    payload: { acceptedCount: 1 },
    severity: 'info',
    stateRevision: 1,
  },
  {
    ...baseEntry(2),
    kind: 'internal_event',
    eventType: 'preview_generated',
    payload: { candidateCount: 2 },
    severity: 'info',
    stateRevision: 1,
  },
  {
    ...baseEntry(3),
    kind: 'internal_event',
    eventType: 'approval_completed',
    payload: { items: [{ status: 'skipped_duplicate' }] },
    severity: 'info',
    stateRevision: 1,
  },
  {
    ...baseEntry(4),
    kind: 'turn',
    role: 'assistant',
    content: '仮予定を作りました。',
    responseSource: 'rules',
    turnIndex: 1,
    stateRevision: 1,
  },
];

describe('weeklyPlanningTraceExport', () => {
  it('DA3c向けのstrict result候補を構築する', () => {
    const fixture = createWeeklyPlanningEvaluationFixtureCandidate(session, entries);

    expect(fixture.callCount).toBe(1);
    expect(fixture.strictResults.previewCompleted).toBe(true);
    expect(fixture.strictResults.duplicateSaveSuppressed).toBe(true);
    expect(fixture.turns).toHaveLength(2);
    expect(fixture.rubricInput.finalStateRevision).toBe(1);
  });

  it('roleplay候補のメールとURLをmaskし、人手確認必須にする', () => {
    const candidate = createWeeklyPlanningRoleplayCandidate(session, entries);

    expect(candidate.requiresHumanReview).toBe(true);
    expect(candidate.turns[0]?.content).toContain('[EMAIL]');
    expect(candidate.turns[0]?.content).toContain('[URL]');
  });

  it('transport-safe base64 debug chunksを順序通り再構成する', () => {
    const source = { runtime: 'stable_v5', values: Array.from({ length: 20 }, (_, index) => index) };
    const bytes = new TextEncoder().encode(JSON.stringify(source));
    const midpoint = Math.ceil(bytes.length / 2);
    const chunks = [bytes.slice(0, midpoint), bytes.slice(midpoint)];
    const debugEntries: WeeklyPlanningTraceEntry[] = chunks.map((chunk, index) => ({
      ...baseEntry(5 + index),
      id: `session-1-debug-${index}`,
      kind: 'internal_event' as const,
      eventType: 'stable_v5_debug_stage' as const,
      payload: {
        storage: 'base64_utf8_json_chunk',
        debugSchemaVersion: 1,
        debugSequence: 2,
        stage: 'runtime_turn_output',
        stageOccurredAt: '2026-07-15T00:00:10.000Z',
        sourceSanitizerTruncated: false,
        chunkIndex: index,
        chunkCount: chunks.length,
        totalSerializedBytes: bytes.length,
        chunkBytes: chunk.length,
        dataChunk: encodeWeeklyPlanningTraceDebugChunkBase64(
          btoa(String.fromCharCode(...chunk)),
        ),
      },
      severity: 'debug' as const,
      requestId: 'request-debug',
      stateRevision: 2,
    }));

    const stages = createWeeklyPlanningStableV5DebugStageExport(debugEntries);
    expect(stages).toEqual([
      expect.objectContaining({
        requestId: 'request-debug',
        debugSequence: 2,
        stage: 'runtime_turn_output',
        data: source,
      }),
    ]);
    expect(stages[0]?.reconstructionError).toBeUndefined();
  });

  it('payload欠落eventをexport bundleから除外する', () => {
    const malformed = {
      ...baseEntry(5),
      kind: 'internal_event',
      eventType: 'preview_generated',
      severity: 'info',
    } as unknown as WeeklyPlanningTraceEntry;

    const bundle = createWeeklyPlanningTraceExportBundle(session, [...entries, malformed]);

    expect(bundle.entries).toHaveLength(entries.length);
    expect(bundle.entries.some((entry) => entry.id === malformed.id)).toBe(false);
  });
});