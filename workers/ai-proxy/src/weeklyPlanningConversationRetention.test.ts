import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirestoreServiceAccountClient, FirestoreWriteConflictError } from './firestoreServiceAccountClient';
import { sweepExpiredConversations } from './weeklyPlanningConversationRetention';
afterEach(() => vi.unstubAllGlobals());
const now = new Date('2026-11-07T00:00:00.000Z');
const row = { id: 'ai-chat-example.2026-04-27', documentName: 'projects/demo/databases/(default)/documents/weekly_planning_conversations/owner/sessions/ai-chat-example.2026-04-27',
  ownerId: 'owner', schemaVersion: 1, revision: 3, deleted: false, payload: 'sensitive body', updatedAt: '2026-04-30T00:00:00.000Z', updateTime: '2026-04-30T00:00:01.000Z' };
describe('bounded conversation retention', () => {
  it('conditionally empties expired bodies and retains a non-resurrectable identity', async () => {
    const queryDocumentsAfter = vi.fn(async () => [row]); const commitWrites = vi.fn(async () => {});
    expect(await sweepExpiredConversations({ queryDocumentsAfter, commitWrites }, now)).toBe(1);
    expect(queryDocumentsAfter).toHaveBeenCalledWith(expect.objectContaining({ collection: 'sessions', allDescendants: true,
      booleanFilter: { field: 'deleted', value: false }, limit: 20, orderByField: 'updatedAt',
      endAtTimestamp: new Date(now.getTime() - 180 * 86_400_000).toISOString() }));
    expect(commitWrites).toHaveBeenCalledWith([{ collection: 'weekly_planning_conversations/owner/sessions', id: row.id,
      value: { deleted: true, payload: '', revision: 4, operationId: 'expired-3' },
      updateMask: ['deleted', 'payload', 'revision', 'operationId'], currentDocument: { updateTime: row.updateTime } }]);
  });
  it('excludes other domains, newer bodies, wrong owners, and incomplete metadata', async () => {
    const commitWrites = vi.fn(async () => {});
    const candidates = [{ ...row, documentName: row.documentName.replace('weekly_planning_conversations', 'other') },
      { ...row, ownerId: 'foreign' }, { ...row, updatedAt: '2026-11-07T00:00:00Z' },
      { ...row, updateTime: undefined }, { ...row, deleted: true }];
    expect(await sweepExpiredConversations({ queryDocumentsAfter: async () => candidates, commitWrites }, now)).toBe(0);
    expect(commitWrites).toHaveBeenCalledWith([]);
  });
  it('does not erase a concurrently changed conversation or retry without its revision condition', async () => {
    const commitWrites = vi.fn(async () => { throw new FirestoreWriteConflictError(412); });
    expect(await sweepExpiredConversations({ queryDocumentsAfter: async () => [row], commitWrites }, now)).toBe(0);
    expect(commitWrites).toHaveBeenCalledTimes(1);
  });
  it('serializes the actual collection-group query with a boolean filter and timestamp cutoff', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new FirestoreServiceAccountClient({ FIREBASE_PROJECT_ID: 'demo', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'unused', FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused' }, { getToken: async () => 'synthetic' });
    await sweepExpiredConversations(client, now);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.structuredQuery.from).toEqual([{ collectionId: 'sessions', allDescendants: true }]);
    expect(body.structuredQuery.where).toEqual({ fieldFilter: { field: { fieldPath: 'deleted' }, op: 'EQUAL', value: { booleanValue: false } } });
    expect(body.structuredQuery.endAt.values[0]).toHaveProperty('timestampValue');
  });
});
