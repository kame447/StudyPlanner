import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdminObservabilityLogs, getAdminObservabilityLogEntries } from './adminObservabilityService';

vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://proxy.example/chat/completions' }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }) }));
afterEach(() => vi.unstubAllGlobals());

describe('admin diagnostic read evidence transport', () => {
  it.each([true, false])('preserves session evidence and supports older Workers: evidence=%s', async (modern) => {
    const pageEvidence = { rawDocumentCount: 2, mappedSessionCount: 0, unreadableSessionCount: 1, statusFilteredCount: 1 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, sessions: [], nextCursor: 'next', ...(modern ? { pageEvidence } : {}),
    })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getAdminObservabilityLogs({ status: 'failed', limit: 25 });
    expect(result).toEqual({ sessions: [], nextCursor: 'next', pageEvidence: modern ? pageEvidence : undefined });
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example/observability/admin/logs?limit=25&status=failed');
  });

  it('preserves bounded entry evidence rather than treating an empty projection as an empty session', async () => {
    const result = {
      entries: [], totalEntryCount: 20, nextAfterSequence: 9, responseBytes: 0,
      pageEvidence: { requestedStartSequence: 0, requestedEndSequence: 9,
        unavailableSequenceCount: 9, unprojectableEntryCount: 1,
        byteLimited: false, indexedRangeExhausted: false },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result }))));
    expect(await getAdminObservabilityLogEntries({ sessionId: 'session', limit: 10 })).toEqual(result);
  });
});
