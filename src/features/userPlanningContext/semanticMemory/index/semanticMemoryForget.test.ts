import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { MemoryStorage } from '../../../../repositories/localPersistenceConcurrency.testUtils';
import { createSemanticMemoryApplication } from './semanticMemoryApplication';
import { SemanticMemoryIndexedDbStore } from './semanticMemoryIndexedDb';
import { readSemanticMemoryCatalog, SEMANTIC_MEMORY_CATALOG_KEY } from './semanticMemoryCatalog';
import { SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY } from './semanticMemoryCleanupState';
import { eraseAllSemanticMemoryIndexes, prepareSemanticMemoryOwner, readSemanticMemoryOptIn,
  clearSemanticMemoryOptIn, SEMANTIC_MEMORY_ERASE_PENDING_KEY, SEMANTIC_MEMORY_ERASE_EPOCH_KEY,
  setSemanticMemoryOptIn } from '../semanticMemoryOptIn';

const model = { modelId: 'synthetic', revision: 'test', dimensions: 2,
  queryPrefix: '', passagePrefix: '', maxWeightBytes: 0 };
let factory: IDBFactory;
let stores: SemanticMemoryIndexedDbStore[];
beforeEach(() => {
  factory = new IDBFactory(); stores = [];
  vi.stubGlobal('indexedDB', factory); vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('no network in forget tests'); }));
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
});
afterEach(() => {
  stores.forEach(store => store.dispose());
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
async function seed(ownerId = 'owner-a') {
  const store = new SemanticMemoryIndexedDbStore(ownerId, model); stores.push(store);
  const { token } = await store.reconcile(5, 'synthetic-signature', new Map([['r', 'fingerprint']]));
  await store.write(token, [{ ownerId, recordId: 'r', sourceRevision: 5, contentFingerprint: 'fingerprint',
    schemaVersion: 1, modelId: model.modelId, modelRevision: model.revision,
    vector: new Float32Array([1, 0]), indexedAt: '' }]);
  return store;
}
async function openExisting(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const pending = factory.open(name);
    pending.onsuccess = () => resolve(pending.result); pending.onerror = () => reject(pending.error);
  });
}

it('persists erase intent before async deletion and retries interrupted sign-out on the next connect', async () => {
  await seed(); await setSemanticMemoryOptIn('owner-a', true);
  const pending = {} as IDBOpenDBRequest;
  const remove = vi.spyOn(factory, 'deleteDatabase').mockReturnValueOnce(pending);
  const erasing = eraseAllSemanticMemoryIndexes();
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).not.toBeNull();
  await vi.waitFor(() => expect(pending.onerror).toBeTypeOf('function'));
  pending.onerror!.call(pending, new Event('error'));
  expect(await erasing).toEqual({ status: 'unavailable', reason: 'storage_unavailable' });
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).not.toBeNull();
  remove.mockRestore();
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  const open = vi.spyOn(factory, 'open'); const createEmbedder = vi.fn();
  const app = createSemanticMemoryApplication({ createEmbedder }); const scope = app.connect('owner-a');
  await vi.waitFor(async () => expect(await factory.databases()).toEqual([]));
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).toBeNull();
  expect(open).not.toHaveBeenCalled(); expect(createEmbedder).not.toHaveBeenCalled(); scope.dispose();
});

it('cleans an expired previous owner on connect before any current-owner model work', async () => {
  await seed(); await setSemanticMemoryOptIn('owner-a', true);
  const createEmbedder = vi.fn(); const open = vi.spyOn(factory, 'open');
  const app = createSemanticMemoryApplication({ createEmbedder }); const scope = app.connect('owner-b');
  scope.publish({ ownerId: 'owner-b', revision: 1, records: [] });
  await app.recall('owner-b', 'synthetic');
  expect(await factory.databases()).toEqual([]); expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
  expect(open).not.toHaveBeenCalled(); expect(createEmbedder).not.toHaveBeenCalled(); scope.dispose();
});

it('cleans a foreign consent key even when no index database remains', async () => {
  await setSemanticMemoryOptIn('owner-a', true); await setSemanticMemoryOptIn('owner-b', true);
  expect(await prepareSemanticMemoryOwner('owner-b')).toEqual({ status: 'ok' });
  expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
  expect(await readSemanticMemoryOptIn('owner-b')).toBe(false);
});

it('uses the hashed name catalog mirror without opening IDB when databases() is absent and the flag is OFF', async () => {
  await seed(); await setSemanticMemoryOptIn('owner-a', true);
  const enumerate = factory.databases.bind(factory);
  Object.defineProperty(factory, 'databases', { value: undefined, configurable: true });
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  const open = vi.spyOn(factory, 'open');
  expect(await prepareSemanticMemoryOwner('owner-a')).toEqual({ status: 'ok' });
  expect(await enumerate()).toEqual([]); expect(open).not.toHaveBeenCalled();
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).toBeNull();
  // A successful erase remains a known-empty catalog on subsequent flag-off startups.
  expect(await prepareSemanticMemoryOwner('owner-a')).toEqual({ status: 'ok' });
  expect(open).not.toHaveBeenCalled();
});

it('falls back to the legacy IDB catalog when enumeration and its mirror are unavailable with the flag ON', async () => {
  await seed();
  localStorage.removeItem('laplance-semantic-memory-index-catalog');
  const enumerate = factory.databases.bind(factory);
  Object.defineProperty(factory, 'databases', { value: undefined, configurable: true });
  expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
  expect(await enumerate()).toEqual([]);
});

it('keeps retry intent and reports unavailable when flag-off legacy storage cannot be enumerated without opening', async () => {
  await seed(); localStorage.removeItem('laplance-semantic-memory-index-catalog');
  Object.defineProperty(factory, 'databases', { value: undefined, configurable: true });
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  const open = vi.spyOn(factory, 'open');
  expect(await prepareSemanticMemoryOwner('owner-a')).toEqual({ status: 'unavailable', reason: 'storage_unavailable' });
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).not.toBeNull();
  expect(open).not.toHaveBeenCalled();
});

it('continues deleting later databases after one is blocked and acknowledges no incomplete erase', async () => {
  await seed('owner-a'); await seed('owner-b');
  const names = (await factory.databases()).map(db => db.name!).filter(name => name.includes(':v1:'));
  const held = await openExisting(names[0]); held.onversionchange = () => {};
  try {
    expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'unavailable', reason: 'storage_unavailable' });
    expect((await factory.databases()).map(db => db.name)).not.toContain(names[1]);
    expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).not.toBeNull();
  } finally { held.close(); }
  expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
  expect(await factory.databases()).toEqual([]);
});

it('purges a signed-in owner cache at connect when a later build turns the flag OFF', async () => {
  await seed(); await setSemanticMemoryOptIn('owner-a', true);
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  const open = vi.spyOn(factory, 'open'); const createEmbedder = vi.fn();
  const app = createSemanticMemoryApplication({ createEmbedder }); const scope = app.connect('owner-a');
  await vi.waitFor(async () => expect(await factory.databases()).toEqual([]));
  expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
  expect(open).not.toHaveBeenCalled(); expect(createEmbedder).not.toHaveBeenCalled(); scope.dispose();
});

it('never clears an earlier global erase intent after erasing only the current owner', async () => {
  await seed('owner-a'); await seed('owner-b');
  await setSemanticMemoryOptIn('owner-a', true); await setSemanticMemoryOptIn('owner-b', true);
  localStorage.setItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY, 'interrupted-global-erase');
  expect(await clearSemanticMemoryOptIn('owner-b')).toBe(true);
  expect(await factory.databases()).toEqual([]);
  expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).toBeNull();
});

it('does not restore consent from a hash operation that finishes after sign-out cleanup', async () => {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const hashing = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    await held; return digest(...args);
  });
  const enabling = setSemanticMemoryOptIn('owner-a', true);
  expect(hashing).toHaveBeenCalledOnce();
  expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
  release(); expect(await enabling).toBe(false);
  expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
});

it('refuses delayed consent when another tab completed an erase during hashing', async () => {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    await held; return digest(...args);
  });
  const enabling = setSemanticMemoryOptIn('owner-a', true);
  // Another tab has already cleared its pending marker; only its durable nonce remains.
  localStorage.setItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY, 'synthetic-other-tab-erase');
  release(); expect(await enabling).toBe(false);
  expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
});

it.each(['signed-out', 'owner-a'])('runs flag-off cleanup once for stable %s visits with no repeated IDB scan or writes', async scope => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  const cleanup = () => scope === 'signed-out' ? eraseAllSemanticMemoryIndexes() : prepareSemanticMemoryOwner(scope);
  expect(await cleanup()).toEqual({ status: 'ok' });
  const enumerate = vi.spyOn(factory, 'databases'); const open = vi.spyOn(factory, 'open');
  const write = vi.spyOn(localStorage, 'setItem'); const remove = vi.spyOn(localStorage, 'removeItem');
  const uuid = vi.spyOn(crypto, 'randomUUID');
  expect(await cleanup()).toEqual({ status: 'ok' });
  expect(await cleanup()).toEqual({ status: 'ok' });
  expect(enumerate).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
});

it('resets the flag-off hint when the flag is ON, a different owner appears, or consent leftovers appear', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  await prepareSemanticMemoryOwner('owner-a');
  const enumerate = vi.spyOn(factory, 'databases');
  await prepareSemanticMemoryOwner('owner-b'); expect(enumerate).toHaveBeenCalledOnce();
  const previousEpoch = localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY);
  localStorage.setItem('laplance-semantic-memory-opt-in:synthetic-foreign-owner-hash', 'true');
  await prepareSemanticMemoryOwner('owner-b'); expect(enumerate).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY)).not.toBe(previousEpoch);
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  await prepareSemanticMemoryOwner('owner-b');
  expect(localStorage.getItem(SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY)).toBeNull();
  enumerate.mockClear(); vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  await prepareSemanticMemoryOwner('owner-b'); expect(enumerate).toHaveBeenCalledOnce();
});

it('invalidates the flag-off hint when a managed index or a pending erase appears', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  await prepareSemanticMemoryOwner('owner-a');
  await seed(); expect(localStorage.getItem(SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY)).toBeNull();
  const enumerate = vi.spyOn(factory, 'databases');
  await prepareSemanticMemoryOwner('owner-a'); expect(enumerate).toHaveBeenCalledOnce();
  localStorage.setItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY, 'synthetic-incomplete-erase');
  await prepareSemanticMemoryOwner('owner-a'); expect(enumerate).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).toBeNull();
});

it.each(['{broken', '{}', '[{"name":"unrelated-db","ownerHash":"bad"}]', '[null]'])(
  'treats invalid mirror %s as absent and recovers from the IDB catalog', async invalid => {
    await seed(); localStorage.setItem(SEMANTIC_MEMORY_CATALOG_KEY, invalid);
    expect(readSemanticMemoryCatalog()).toBeNull();
    const enumerate = factory.databases.bind(factory);
    Object.defineProperty(factory, 'databases', { value: undefined, configurable: true });
    expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
    expect(await enumerate()).toEqual([]);
    expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).toBeNull();
  });

it('keeps genuine mirror storage-access failures unavailable instead of treating them as corruption', async () => {
  await seed();
  Object.defineProperty(factory, 'databases', { value: undefined, configurable: true });
  const get = localStorage.getItem.bind(localStorage);
  vi.spyOn(localStorage, 'getItem').mockImplementation(key => {
    if (key === SEMANTIC_MEMORY_CATALOG_KEY) throw new DOMException('synthetic denied storage', 'SecurityError');
    return get(key);
  });
  expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'unavailable', reason: 'storage_unavailable' });
  expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_PENDING_KEY)).not.toBeNull();
  expect(localStorage.getItem(SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY)).toBeNull();
});
