import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductObservabilityWeeklyPlanningDiagnosticAdapter } from './productObservabilityWeeklyPlanningDiagnosticAdapter';
import { WeeklyPlanningTraceFirestoreClient } from './weeklyPlanningTraceFirestore';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../shared/weeklyPlanningTraceContract';

const sessionId = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId, documentName: `sessions/${sessionId}`,
    status: 'active', startedAt: '2026-10-01T00:00:00.000Z',
    lastActivityAt: '2026-10-01T01:00:00.000Z', entryCount: 4, turnCount: 1,
    ...overrides,
  };
}

function entry(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `${sessionId}-${String(sequence).padStart(8, '0')}`, sessionId, sequence,
    kind: 'turn_diagnostic', schemaVersion: 2, occurredAt: '2026-10-01T01:00:00.000Z',
    turnIndex: sequence, requestId: `synthetic-request-${sequence}`,
    ...overrides,
  };
}

async function harness() {
  const prototype = WeeklyPlanningTraceFirestoreClient.prototype;
  const get = vi.spyOn(prototype, 'getDocument').mockResolvedValue(session());
  const query = vi.spyOn(prototype, 'queryDocumentsAfter').mockResolvedValue([]);
  const batch = vi.spyOn(prototype, 'batchGetDocuments').mockResolvedValue([]);
  const audit = vi.spyOn(prototype, 'setImmutableDocument').mockResolvedValue(undefined);
  const epoch = resolveWeeklyPlanningTraceEpoch(new Date());
  const adapter = new ProductObservabilityWeeklyPlanningDiagnosticAdapter({
    FIREBASE_PROJECT_ID: 'synthetic-project', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'unused@example.invalid',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({ [epoch]: 'a'.repeat(64) }),
  });
  await adapter.assertTraceReader('synthetic-admin', { enabled: true, weeklyPlanningTraceReader: true });
  return { adapter, get, query, batch, audit };
}

afterEach(() => vi.restoreAllMocks());

describe('modern trace diagnostic evidence at bounded read boundaries', () => {
  it('retains pagination and distinguishes filtered and unreadable sessions without entry scans', async () => {
    const h = await harness();
    h.query.mockResolvedValue([
      session({ status: 'completed' }),
      session({ startedAt: null, documentName: 'sessions/unreadable' }),
      session({ documentName: 'sessions/lookahead' }),
    ]);
    const page = await h.adapter.listSessions({ status: 'active', limit: 2 });
    expect(page.sessions).toEqual([]);
    expect(page.pageEvidence).toEqual({
      rawDocumentCount: 2, mappedSessionCount: 1, unreadableSessionCount: 1, statusFilteredCount: 1,
    });
    expect(page.nextCursor).toEqual({ orderedValue: '2026-10-01T01:00:00.000Z', documentName: 'sessions/unreadable' });
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.query.mock.calls[0][0].limit).toBe(3);
    expect(h.get).not.toHaveBeenCalled();
    expect(h.batch).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it('reports an exact-ID document that cannot be projected instead of normal zero', async () => {
    const h = await harness();
    h.get.mockResolvedValue(session({ startedAt: null }));
    const page = await h.adapter.listSessions({ sessionId });
    expect(page.sessions).toEqual([]);
    expect(page.pageEvidence).toEqual({
      rawDocumentCount: 1, mappedSessionCount: 0, unreadableSessionCount: 1, statusFilteredCount: 0,
    });
    expect(h.query).not.toHaveBeenCalled();
  });

  it('reports missing sequences and projection failures from the actual requested batch', async () => {
    const h = await harness();
    h.get.mockResolvedValue(session({ entryCount: 6 }));
    h.batch.mockResolvedValue([entry(0), entry(1, { occurredAt: undefined }), null, entry(3, { id: 'wrong-id' })]);
    const page = await h.adapter.listEntries({ sessionId, limit: 4 });
    expect(page.entries).toHaveLength(1);
    expect(page.pageEvidence).toEqual({
      indexCountStatus: 'valid', requestedStartSequence: 0, requestedEndSequence: 3, unavailableSequenceCount: 2,
      unprojectableEntryCount: 1, byteLimited: false, indexedRangeExhausted: false,
    });
    expect(page.nextAfterSequence).not.toBeNull();
    expect(h.batch).toHaveBeenCalledTimes(1);
    expect(h.batch.mock.calls[0][1]).toHaveLength(4);
  });

  it('keeps response-byte truncation distinct from missing entries', async () => {
    const h = await harness();
    h.get.mockResolvedValue(session({ entryCount: 20 }));
    const documents = Array.from({ length: 20 }, (_, index) => entry(index, {
      userInput: { text: 'synthetic diagnostic text '.repeat(700) },
    }));
    documents.forEach((document) => expect(measureWeeklyPlanningTraceJsonBytes(document))
      .toBeLessThan(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes));
    h.batch.mockResolvedValue(documents);
    const page = await h.adapter.listEntries({ sessionId, limit: 20 });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.length).toBeLessThan(20);
    expect(page.pageEvidence).toMatchObject({
      unavailableSequenceCount: 0, unprojectableEntryCount: 0,
      byteLimited: true, indexedRangeExhausted: false,
    });
    expect(page.nextAfterSequence).toBe(page.entries.length - 1);
    expect(h.batch.mock.calls[0][1]).toHaveLength(20);
  });

  it('describes a zero-length indexed range without claiming a storage census', async () => {
    const h = await harness();
    h.get.mockResolvedValue(session({ entryCount: 0, turnCount: 0 }));
    const page = await h.adapter.listEntries({ sessionId });
    expect(page.entries).toEqual([]);
    expect(page.pageEvidence).toEqual({
      indexCountStatus: 'valid', requestedStartSequence: 0, requestedEndSequence: -1, unavailableSequenceCount: 0,
      unprojectableEntryCount: 0, byteLimited: false, indexedRangeExhausted: true,
    });
    expect(h.batch.mock.calls[0][1]).toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });
  it.each([undefined, -1, 1.5, '2', 100001])('does not claim index completion for invalid/capped count %s', async (entryCount) => {
    const h = await harness();
    h.get.mockResolvedValue(session({ entryCount }));
    const capped = entryCount === 100001;
    const page = await h.adapter.listEntries({ sessionId, afterSequence: capped ? 99999 : -1 });
    expect(page.pageEvidence).toMatchObject({
      indexCountStatus: capped ? 'capped' : 'invalid', indexedRangeExhausted: false,
    });
    expect(page.nextAfterSequence).toBeNull();
    expect(h.batch.mock.calls[0][1]).toEqual([]);
  });

});
