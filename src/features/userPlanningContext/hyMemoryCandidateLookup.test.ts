import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupHyMemoryCandidateRecords } from './hyMemoryCandidateLookup';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

const user = vi.hoisted(() => ({
  active: { uid: 'owner-1', getIdToken: vi.fn(async () => 'signed-in-token') },
}));

vi.mock('../../lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => 'https://proxy.example/chat/completions',
}));
vi.mock('../../lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: user.active }),
}));

function record(id: string, status: UserPlanningContextRecordV1['status'] = 'active'): UserPlanningContextRecordV1 {
  return {
    id, ownerId: 'owner-1', kind: 'learning_preference', label: '数学',
    value: '夕方', dateExpression: null, observedDate: '2026-10-17',
    resolvedDate: null, sourceText: '数学は夕方', sourceConversationId: 'c',
    sourceTurnId: 't', recordedAt: '2026-10-17T00:00:00.000Z',
    status, origin: 'user_confirmed',
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_HY_MEMORY_CANDIDATES', 'shadow');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Hy Memory candidate client lookup', () => {
  it('returns only canonical active records, never external content', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ sourceRevision: 5, query: '数学' });
      return new Response(JSON.stringify({
        status: 'ready', ownerId: 'owner-1', sourceRevision: 5,
        recordIds: ['revoked', 'valid'],
        // Non-authoritative vendor text must be ignored.
        content: '間違った記憶',
      }));
    });
    const result = await lookupHyMemoryCandidateRecords({
      ownerId: 'owner-1', sourceRevision: 5, query: '数学',
      records: [record('revoked', 'revoked'), record('valid')],
      fetcher: fetcher as typeof fetch,
    });
    expect(result).toEqual({ status: 'ready', records: [record('valid')] });
  });

  it('never calls the Worker when opt-in is absent', async () => {
    vi.stubEnv('VITE_HY_MEMORY_CANDIDATES', 'off');
    const fetcher = vi.fn();
    const result = await lookupHyMemoryCandidateRecords({
      ownerId: 'owner-1', sourceRevision: 5, query: '数学',
      records: [], fetcher: fetcher as typeof fetch,
    });
    expect(result.status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects index drift before canonical resolution', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: 'ready', ownerId: 'owner-1', sourceRevision: 4, recordIds: ['valid'],
    })));
    const result = await lookupHyMemoryCandidateRecords({
      ownerId: 'owner-1', sourceRevision: 5, query: '数学',
      records: [record('valid')], fetcher: fetcher as typeof fetch,
    });
    expect(result).toEqual({ status: 'unavailable', records: [] });
  });
  it('rejects a completed request if the signed-in account changes in flight', async () => {
    const original = user.active;
    const fetcher = vi.fn(async () => {
      user.active = { uid: 'other-owner', getIdToken: original.getIdToken };
      return new Response(JSON.stringify({
        status: 'ready', ownerId: 'owner-1', sourceRevision: 5,
        recordIds: ['valid'],
      }));
    });
    try {
      const result = await lookupHyMemoryCandidateRecords({
        ownerId: 'owner-1', sourceRevision: 5, query: '数学',
        records: [record('valid')], fetcher: fetcher as typeof fetch,
      });
      expect(result).toEqual({ status: 'unavailable', records: [] });
    } finally {
      user.active = original;
    }
  });

});
