import { describe, expect, it, vi } from 'vitest';
import { ProductObservabilityStore } from './productObservabilityStore';

function fixture() {
  const documents = new Map<string, Record<string, unknown>>();
  const getDocument = vi.fn(async (collection: string, id: string) => documents.get(`${collection}/${id}`) ?? null);
  const setImmutableDocument = vi.fn(async (collection: string, id: string, value: Record<string, unknown>) => {
    documents.set(`${collection}/${id}`, structuredClone(value));
  });
  const store = new ProductObservabilityStore({
    FIREBASE_PROJECT_ID: 'test', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'unused@example.test',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused', OBSERVABILITY_IDENTITY_SECRET: 's'.repeat(64),
  }, { getDocument, setImmutableDocument, batchGetDocuments: async () => [] });
  return { documents, getDocument, setImmutableDocument, store };
}

describe('observability actor account deletion boundary', () => {
  it.each(['deleting', 'completed'])('refuses a new actor when a %s tombstone exists', async (status) => {
    const { documents, getDocument, setImmutableDocument, store } = fixture();
    documents.set('account_deletions/owner', { status });
    await expect(store.resolveActorSubjectId('owner')).rejects.toThrow('observability actor is being deleted');
    expect(getDocument).toHaveBeenLastCalledWith('account_deletions', 'owner');
    expect(setImmutableDocument).not.toHaveBeenCalled();
    expect([...documents.keys()]).toEqual(['account_deletions/owner']);
  });

  it('keeps existing actor resolution to one directory read even when a tombstone exists', async () => {
    const { documents, getDocument, setImmutableDocument, store } = fixture();
    const actor = await store.resolveActorSubjectId('owner');
    documents.set('account_deletions/owner', { status: 'deleting' });
    getDocument.mockClear();
    setImmutableDocument.mockClear();
    expect(await store.resolveActorSubjectId('owner')).toBe(actor);
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(getDocument.mock.calls[0][0]).toBe('observability_actor_directory');
    expect(setImmutableDocument).not.toHaveBeenCalled();
  });
});
