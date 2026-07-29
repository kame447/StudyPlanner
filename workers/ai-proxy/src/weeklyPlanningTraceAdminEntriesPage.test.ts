import { describe, expect, it, vi } from 'vitest';
import { loadWeeklyPlanningTraceAdminEntryPage } from './weeklyPlanningTraceAdminEntriesPage';

const SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';
const CONVERSATION_ID = 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';

function storedEntry(sequence: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `${SESSION_ID}-${String(sequence).padStart(8, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    ...overrides,
  };
}

describe('weekly planning trace admin entry page loader', () => {
  it('entryCount 256でも1requestあたり20 documentだけ取得する legacy guard', async () => {
    const getDocument = vi.fn(async (_collection: string, id: string) => {
      const sequence = Number(id.slice(-8));
      return storedEntry(sequence);
    });

    const first = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 256 },
      -1,
      100,
    );

    expect(first.entries).toHaveLength(20);
    expect(first.totalEntryCount).toBe(256);
    expect(first.nextAfterSequence).toBe(19);
    expect(first.missingSequenceCount).toBe(0);
    expect(getDocument).toHaveBeenCalledTimes(20);

    getDocument.mockClear();
    const second = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 256 },
      first.nextAfterSequence ?? -1,
      20,
    );
    expect(second.entries[0]?.sequence).toBe(20);
    expect(second.entries[19]?.sequence).toBe(39);
    expect(second.nextAfterSequence).toBe(39);
    expect(getDocument).toHaveBeenCalledTimes(20);
  });

  it('loads a normal two-turn schema v2 session with exactly two Firestore reads', async () => {
    const getDocument = vi.fn(async (_collection: string, id: string) => {
      const sequence = Number(id.slice(-8));
      return storedEntry(sequence, {
        kind: 'turn_diagnostic',
        schemaVersion: 2,
        userInput: { text: sequence === 0 ? '予定を立てたい' : '英語を3時間' },
        assistantOutput: { text: '確認しました。', responseSource: 'ai' },
      });
    });

    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 2, schemaVersion: 2 },
      -1,
      20,
    );

    expect(page.entries).toHaveLength(2);
    expect(page.totalEntryCount).toBe(2);
    expect(page.nextAfterSequence).toBeNull();
    expect(page.requestedStartSequence).toBe(0);
    expect(page.requestedEndSequence).toBe(1);
    expect(page.responseBytes).toBeGreaterThan(0);
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(page.entries)).toContain('英語を3時間');
  });

  it('does not recursively redact raw schema v2 diagnostic text during admin retrieval', async () => {
    const getDocument = vi.fn(async () => storedEntry(0, {
      traceSubjectToken: 'wpt_internal-secret',
      traceSubjectEpoch: '100',
      kind: 'turn_diagnostic',
      schemaVersion: 2,
      userInput: { text: 'person@example.comへ確認' },
      aiInterpreter: { rawResponses: [{ text: 'raw person@example.com' }] },
    }));

    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 1, schemaVersion: 2 },
      -1,
      20,
    );
    const output = JSON.stringify(page.entries);

    expect(output).toContain('person@example.com');
    expect(output).not.toContain('wpt_internal-secret');
    expect(output).not.toContain('traceSubjectEpoch');
    expect(output).toContain('subjectAlias');
  });

  it('keeps recursive identifier redaction for legacy entries', async () => {
    const getDocument = vi.fn(async () => storedEntry(0, {
      traceSubjectToken: 'wpt_internal-secret',
      traceSubjectEpoch: '100',
      logicalConversationId: CONVERSATION_ID,
      userId: 'firebase-user-123',
      kind: 'internal_event',
      schemaVersion: 1,
      eventType: 'stable_v5_debug_stage',
      severity: 'debug',
      payload: {
        nested: {
          email: 'person@example.com',
          note: '連絡先は person@example.com',
        },
      },
    }));

    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 1, schemaVersion: 1 },
      -1,
      20,
    );
    const output = JSON.stringify(page.entries);

    expect(output).not.toContain('firebase-user-123');
    expect(output).not.toContain('person@example.com');
    expect(output).toContain('[EMAIL]');
    expect(output).not.toContain('wpt_internal-secret');
    expect(output).toContain('subjectAlias');
  });

  it('stops before exceeding the response byte limit and advances by the returned sequence', async () => {
    const getDocument = vi.fn(async (_collection: string, id: string) => {
      const sequence = Number(id.slice(-8));
      return storedEntry(sequence, {
        kind: 'turn_diagnostic',
        schemaVersion: 2,
        payload: 'x'.repeat(40_000),
      });
    });

    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 20 },
      -1,
      20,
    );

    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.length).toBeLessThan(20);
    expect(page.responseBytes).toBeLessThanOrEqual(256 * 1024);
    expect(page.nextAfterSequence).toBe(Number(page.entries.at(-1)?.sequence));
    expect(getDocument).toHaveBeenCalledTimes(20);
  });

  it('欠落documentを捨ててもcursorをpage末尾まで進める', async () => {
    const getDocument = vi.fn(async (_collection: string, id: string) => {
      const sequence = Number(id.slice(-8));
      return sequence === 1 ? null : storedEntry(sequence);
    });

    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 4 },
      -1,
      3,
    );

    expect(page.entries.map((entry) => entry.sequence)).toEqual([0, 2]);
    expect(page.missingSequenceCount).toBe(1);
    expect(page.nextAfterSequence).toBe(2);
  });
});
