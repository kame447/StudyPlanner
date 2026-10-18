import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { UserPlanningContextRecordV1 } from '../../userPlanningContextTypes';
import { selectUserPlanningContextPromptRecordsV2 } from '../../userPlanningContextPromptSelectionV2Core';
import { SemanticMemoryUnavailableError, type SemanticMemoryCanonicalView, type SemanticMemoryEmbedder } from '../semanticMemoryContract';
import { clearSemanticMemoryOptIn, eraseAllSemanticMemoryIndexes, readSemanticMemoryOptIn,
  SEMANTIC_MEMORY_ERASE_EPOCH_KEY, setSemanticMemoryOptIn } from '../semanticMemoryOptIn';
import { SemanticMemoryIndex } from './semanticMemoryIndex';
import { SemanticMemoryIndexedDbStore } from './semanticMemoryIndexedDb';
import { semanticMemoryRecordFingerprint } from './semanticMemoryFingerprint';
import { SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY } from './semanticMemoryCleanupState';
import { selectHybridUserPlanningContextPromptRecords } from './semanticMemoryHybrid';

const record = (id = 'math', patch: Partial<UserPlanningContextRecordV1> = {}): UserPlanningContextRecordV1 => ({
  id, ownerId: 'owner-a', kind: 'concern', label: id, value: '数式を復習したい',
  dateExpression: null, observedDate: '2026-10-17', resolvedDate: null,
  sourceText: '数学が苦手', sourceConversationId: 'synthetic-conversation', sourceTurnId: 'synthetic-turn',
  recordedAt: '2026-10-17T00:00:00.000Z', status: 'active', origin: 'user_stated', ...patch,
});
const model = { modelId: 'test-only', revision: 'immutable-test-revision', dimensions: 2,
  queryPrefix: '', passagePrefix: '', maxWeightBytes: 0 };
function embedder(): SemanticMemoryEmbedder {
  return { model: { ...model }, backend: 'wasm',
    embed: vi.fn(async (texts: readonly string[]) => texts.map(() => new Float32Array([1, 0]))),
    dispose: vi.fn(async () => undefined) };
}

describe('disposable semantic index safety (synthetic records; no network)', () => {
  let view: SemanticMemoryCanonicalView;
  let factory: IDBFactory;
  let indexes: SemanticMemoryIndex[];
  let stores: SemanticMemoryIndexedDbStore[];
  let fetchSpy: ReturnType<typeof vi.fn>;
  function create(options: Partial<ConstructorParameters<typeof SemanticMemoryIndex>[0]> = {}) {
    const instance = new SemanticMemoryIndex({ ownerId: 'owner-a', embedder: embedder(),
      getCanonicalView: () => view, factory, access: async () => null, ...options });
    indexes.push(instance);
    return instance;
  }
  beforeEach(() => {
    factory = new IDBFactory();
    view = { ownerId: 'owner-a', revision: 1, records: [record()] };
    indexes = []; stores = [];
    vi.stubGlobal('indexedDB', factory);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key) });
    fetchSpy = vi.fn(() => { throw new Error('network forbidden'); });
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    indexes.forEach((index) => index.dispose()); stores.forEach((store) => store.dispose());
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });

  it('indexes idempotently and recalls unchanged records at a later canonical revision', async () => {
    const fake = embedder(); const index = create({ embedder: fake });
    expect(await index.sync()).toEqual({ status: 'ok', indexed: 1, remaining: 0 });
    expect(await index.sync()).toEqual({ status: 'ok', indexed: 0, remaining: 0 });
    expect(fake.embed).toHaveBeenCalledTimes(1);
    view = { ...view, revision: 2 };
    expect(await index.recall('計算が不安')).toMatchObject({ status: 'ok', candidates: [{ recordId: 'math', sourceRevision: 1 }] });
  });

  it.each(['revoked', 'superseded', 'historical', 'needs_review', 'archived'] as const)(
    'never returns %s canonical records even while their vector remains', async (status) => {
      const index = create(); await index.sync();
      view = { ...view, revision: 2, records: [record('math', { status })] };
      expect(await index.recall('数式')).toEqual({ status: 'no_match' });
      expect(await index.sync()).toEqual({ status: 'ok', indexed: 0, remaining: 0 });
    });

  it('does not resurrect deleted/absent entries from stale offline snapshots', async () => {
    const index = create(); await index.sync();
    view = { ...view, revision: 2, records: [] };
    expect(await index.recall('数式')).toEqual({ status: 'no_match' });
    await index.sync();
    view = { ...view, revision: 1, records: [record()] };
    expect(await index.sync()).toMatchObject({ status: 'unavailable' });
    expect(await index.recall('数式')).toMatchObject({ status: 'unavailable' });
  });

  it('excludes wrong-owner records and rejects a switched canonical owner', async () => {
    view.records = [record('foreign', { ownerId: 'owner-b' }), record()];
    const index = create(); expect(await index.sync()).toMatchObject({ indexed: 1 });
    view = { ownerId: 'owner-b', revision: 1, records: [record('foreign', { ownerId: 'owner-b' })] };
    expect(await index.recall('math')).toEqual({ status: 'unavailable', reason: 'owner_mismatch' });
  });

  it.each([{ value: '更新された内容' }, { origin: 'user_confirmed' as const }, { sourceTurnId: 'changed' }])(
    'invalidates changed embedded fields or provenance: %j', async (patch) => {
      const index = create(); await index.sync();
      view = { ...view, revision: 2, records: [record('math', patch)] };
      expect(await index.recall('数式')).toEqual({ status: 'no_match' });
    });

  it('validates current records after asynchronous query embedding', async () => {
    const fake = embedder(); const index = create({ embedder: fake }); await index.sync();
    vi.mocked(fake.embed).mockImplementationOnce(async () => {
      view = { ...view, revision: 2, records: [] };
      return [new Float32Array([1, 0])];
    });
    expect(await index.recall('数式')).toEqual({ status: 'no_match' });
  });

  it('rejects stale-tab writes with an atomic durable revision fence', async () => {
    const storeA = new SemanticMemoryIndexedDbStore('owner-a', model, factory);
    const storeB = new SemanticMemoryIndexedDbStore('owner-a', model, factory);
    stores.push(storeA, storeB);
    const fingerprint = await semanticMemoryRecordFingerprint(record());
    const old = await storeA.reconcile(1, 'active', new Map([['math', fingerprint]]));
    await storeB.reconcile(2, 'forgotten', new Map());
    expect(await storeA.write(old.token, [{ ownerId: 'owner-a', recordId: 'math', sourceRevision: 1,
      contentFingerprint: fingerprint, schemaVersion: 1, modelId: model.modelId,
      modelRevision: model.revision, vector: new Float32Array([1, 0]), indexedAt: '' }])).toBe(false);
    expect((await storeB.read()).entries).toEqual([]);
    await expect(storeA.reconcile(1, 'active', new Map())).rejects.toThrow('stale');
  });

  it('rejects same-revision conflicting canonical content', async () => {
    const index = create(); await index.sync();
    view = { ...view, records: [record('math', { value: 'conflicting content' })] };
    expect(await index.sync()).toMatchObject({ status: 'unavailable' });
  });

  it('recreates an existing owner cache when a fresh index sees a restarted canonical revision', async () => {
    const first = create(); view = { ...view, revision: 20 }; await first.sync(); first.dispose();
    view = { ...view, revision: 1, records: [record('fresh', { value: 'restarted canonical document' })] };
    const remove = vi.spyOn(factory, 'deleteDatabase');
    const fresh = create();
    expect(await fresh.sync()).toEqual({ status: 'unavailable', reason: 'internal_error' });
    expect(remove).not.toHaveBeenCalled();
    expect(await fresh.sync()).toEqual({ status: 'ok', indexed: 1, remaining: 0 });
    expect(remove).toHaveBeenCalledOnce();
    expect(await fresh.recall('合成')).toMatchObject({ status: 'ok', candidates: [{ recordId: 'fresh', sourceRevision: 1 }] });
  });

  it('advances generation across revision restart and refuses old tokens and live stale stores', async () => {
    const old = new SemanticMemoryIndexedDbStore('owner-a', model, factory);
    const fresh = new SemanticMemoryIndexedDbStore('owner-a', model, factory); stores.push(old, fresh);
    const { token } = await old.reconcile(20, 'previous-document', new Map());
    await expect(old.reconcile(1, 'stale-live-view', new Map())).rejects.toThrow('stale');
    await expect(fresh.reconcile(1, 'new-document', new Map())).rejects.toThrow('confirmation');
    const reset = await fresh.reconcile(1, 'new-document', new Map());
    expect(reset.token.generation).toBeGreaterThan(token.generation);
    expect((await fresh.read()).revision).toBe(1);
    await expect(old.write(token, [])).rejects.toMatchObject({ reason: 'not_opted_in' });
    const missedBroadcast = new SemanticMemoryIndexedDbStore('owner-a', model, factory); stores.push(missedBroadcast);
    expect(await missedBroadcast.write(token, [])).toBe(false);
  });

  it('does not re-inherit obsolete model fences after a canonical document restart', async () => {
    view = { ...view, revision: 20 };
    const oldModel = create(); await oldModel.sync(); oldModel.dispose();
    const fake = embedder(); fake.model.revision = 'replacement-model';
    const migrated = create({ embedder: fake }); await migrated.sync(); migrated.dispose();
    view = { ...view, revision: 1, records: [record('fresh')] };
    const restarted = create({ embedder: fake });
    expect(await restarted.sync()).toMatchObject({ status: 'unavailable', reason: 'internal_error' });
    expect(await restarted.sync()).toMatchObject({ status: 'ok', indexed: 1 }); restarted.dispose();
    const reloaded = create({ embedder: fake });
    expect(await reloaded.sync()).toMatchObject({ status: 'ok', indexed: 0 });
    expect((await factory.databases()).filter(db => db.name?.includes(':v1:'))).toHaveLength(1);
  });

  it('does not erase for one stale lower view followed by the current revision', async () => {
    const old = new SemanticMemoryIndexedDbStore('owner-a', model, factory);
    const fresh = new SemanticMemoryIndexedDbStore('owner-a', model, factory); stores.push(old, fresh);
    await old.reconcile(20, 'current', new Map());
    const remove = vi.spyOn(factory, 'deleteDatabase');
    await expect(fresh.reconcile(1, 'cached', new Map(), 1)).rejects.toThrow('confirmation');
    await expect(fresh.reconcile(1, 'cached', new Map(), 1)).rejects.toThrow('confirmation');
    await fresh.reconcile(20, 'current', new Map(), 2);
    expect(remove).not.toHaveBeenCalled(); expect((await fresh.read()).revision).toBe(20);
    await expect(fresh.reconcile(1, 'cached', new Map(), 3)).rejects.toThrow('stale');
  });

  it('requires consecutive matching lower content against the same fence before reset', async () => {
    const old = new SemanticMemoryIndexedDbStore('owner-a', model, factory);
    const fresh = new SemanticMemoryIndexedDbStore('owner-a', model, factory); stores.push(old, fresh);
    await old.reconcile(20, 'current', new Map());
    const remove = vi.spyOn(factory, 'deleteDatabase');
    await expect(fresh.reconcile(1, 'cached-a', new Map(), 1)).rejects.toThrow('confirmation');
    await expect(fresh.reconcile(1, 'cached-b', new Map(), 2)).rejects.toThrow('confirmation');
    await expect(fresh.reconcile(2, 'cached-b', new Map(), 3)).rejects.toThrow('confirmation');
    await old.reconcile(21, 'new-current', new Map());
    await expect(fresh.reconcile(1, 'cached-b', new Map(), 4)).rejects.toThrow('confirmation');
    expect(remove).not.toHaveBeenCalled();
    const result = await fresh.reconcile(1, 'cached-b', new Map(), 5);
    expect(result.token.revision).toBe(1); expect(remove).toHaveBeenCalledOnce();
  });

  it('rejects stale generation writes even when BroadcastChannel invalidation was missed', async () => {
    const store = new SemanticMemoryIndexedDbStore('owner-a', model, factory); stores.push(store);
    const { token } = await store.reconcile(1, 'active', new Map());
    const name = (await factory.databases()).find((item) => item.name?.includes(':v1:'))!.name!;
    await new Promise<void>((resolve, reject) => {
      const pending = factory.open(name);
      pending.onerror = () => reject(pending.error);
      pending.onsuccess = () => {
        const db = pending.result;
        const tx = db.transaction(['state', 'entries'], 'readwrite');
        tx.objectStore('entries').clear();
        tx.objectStore('state').put({ ...token, generation: token.generation + 1 }, 'fence');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    expect(await store.write(token, [])).toBe(false);
    await expect(store.read()).rejects.toMatchObject({ reason: 'not_opted_in' });
  });

  it('invalidates a live tab on a BroadcastChannel erase notice', async () => {
    const channels: { onmessage: ((event: { data: string }) => void) | null }[] = [];
    vi.stubGlobal('BroadcastChannel', class {
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() { channels.push(this); }
      close() {} postMessage() {}
    });
    const index = create(); await index.sync();
    const name = (await factory.databases()).find((item) => item.name?.includes(':v1:'))!.name!;
    channels.forEach((channel) => channel.onmessage?.({ data: name }));
    expect(await index.recall('math')).toEqual({ status: 'unavailable', reason: 'not_opted_in' });
  });

  it('reports quota exhaustion during the actual vector transaction', async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'entries') throw new DOMException('synthetic full device', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    expect(await create().sync()).toEqual({ status: 'unavailable', reason: 'quota_exceeded' });
  });

  it('rejects an in-flight embedding after another tab forgets', async () => {
    let release: (() => void) | undefined;
    const fake = embedder(); const first = create({ embedder: fake }); const second = create();
    vi.mocked(fake.embed).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return [new Float32Array([1, 0])];
    });
    const running = first.sync();
    await vi.waitFor(() => expect(release).toBeDefined());
    view = { ...view, revision: 2, records: [] }; await second.sync(); release!();
    expect(await running).toMatchObject({ status: 'unavailable' });
    expect(await second.recall('数学')).toEqual({ status: 'no_match' });
  });

  it('caps batches/work and aborts between batches without writing a late batch', async () => {
    view.records = Array.from({ length: 6 }, (_, index) => record(`r${index}`));
    const fake = embedder(); const abort = new AbortController();
    const index = create({ embedder: fake, batchSize: 2, maxRecordsPerSync: 4 });
    expect(await index.sync()).toEqual({ status: 'ok', indexed: 4, remaining: 2 });
    expect(vi.mocked(fake.embed).mock.calls.map(([texts]) => texts.length)).toEqual([2, 2]);
    vi.mocked(fake.embed).mockImplementationOnce(async (texts) => {
      abort.abort(); return texts.map(() => new Float32Array([1, 0]));
    });
    expect(await index.sync(abort.signal)).toEqual({ status: 'unavailable', reason: 'aborted' });
    expect(await index.sync()).toEqual({ status: 'ok', indexed: 2, remaining: 0 });
  });

  it('uses cosine ranking, configurable threshold and bounded top-k', async () => {
    view.records = [record('low'), record('high'), record('zero')];
    const fake = embedder();
    vi.mocked(fake.embed).mockImplementation(async (texts, role) => role === 'query'
      ? [new Float32Array([1, 0])]
      : texts.map((text) => new Float32Array(text.includes('high') ? [2, 0] : text.includes('low') ? [0, 1] : [0, 0])));
    const index = create({ embedder: fake, minScore: 0.8, topK: 1 }); await index.sync();
    expect(await index.recall('query')).toMatchObject({ status: 'ok', candidates: [{ recordId: 'high', score: 1 }] });
  });

  it.each(['QuotaExceededError', 'SecurityError'])(
    'degrades %s to unavailable and byte-identical lexical output', async (name) => {
      const broken = { open() { throw new DOMException('synthetic failure', name); } } as unknown as IDBFactory;
      const index = create({ factory: broken });
      expect(await index.sync()).toEqual({ status: 'unavailable', reason: name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_unavailable' });
      const semantic = await index.recall('数式');
      const hybrid = await selectHybridUserPlanningContextPromptRecords({ ownerId: 'owner-a',
        getCanonicalView: () => view, semantic, enabled: true });
      expect(JSON.stringify(hybrid)).toBe(JSON.stringify(selectUserPlanningContextPromptRecordsV2({ records: view.records })));
    });

  it('purges every owner on account switch and rejects pending old instances', async () => {
    const first = create(); await first.sync();
    const second = create({ ownerId: 'owner-b', getCanonicalView: () => ({ ownerId: 'owner-b', revision: 1,
      records: [record('b', { ownerId: 'owner-b' })] }) });
    await second.sync();
    expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
    expect(await first.recall('math')).toMatchObject({ status: 'unavailable' });
    expect(await second.recall('b')).toMatchObject({ status: 'unavailable' });
    const fresh = create(); expect(await fresh.recall('math')).toEqual({ status: 'no_match' });
  });

  it('flag-off account cleanup with no leftovers never opens IndexedDB and clears consent', async () => {
    vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
    await setSemanticMemoryOptIn('owner-a', true);
    vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
    const open = vi.spyOn(factory, 'open');
    expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
    expect(open).not.toHaveBeenCalled();
    // Only content-free erase/cleanup hints remain; no consent, catalog or record data.
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)))
      .toEqual([SEMANTIC_MEMORY_ERASE_EPOCH_KEY, SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY]);
    expect(localStorage.getItem(SEMANTIC_MEMORY_ERASE_EPOCH_KEY)).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(SEMANTIC_MEMORY_FLAG_OFF_CLEANUP_KEY)).toBe('signed-out');
    expect(await factory.databases()).toEqual([]);
  });

  it('flag-off account cleanup deletes existing indexes without opening them or touching other databases', async () => {
    const index = create(); await index.sync();
    await new Promise<void>((resolve) => {
      const pending = factory.open('unrelated-planner-data');
      pending.onsuccess = () => { pending.result.close(); resolve(); };
    });
    vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
    const open = vi.spyOn(factory, 'open');
    expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'ok' });
    expect(open).not.toHaveBeenCalled();
    expect((await factory.databases()).map((database) => database.name)).toEqual(['unrelated-planner-data']);
    expect(await index.recall('math')).toMatchObject({ status: 'unavailable' });
  });

  it('does not report account cleanup success when consent could not be removed', async () => {
    vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
    await setSemanticMemoryOptIn('owner-a', true);
    vi.spyOn(globalThis.localStorage, 'removeItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(await eraseAllSemanticMemoryIndexes()).toEqual({ status: 'unavailable', reason: 'storage_unavailable' });
  });

  it('discards old model vectors and carries the last canonical revision fence across models', async () => {
    const first = create(); await first.sync(); view = { ...view, revision: 4, records: [] }; await first.sync();
    const fake = embedder(); fake.model.revision = 'next-model';
    const next = create({ embedder: fake });
    view = { ...view, revision: 1, records: [record()] };
    expect(await next.sync()).toMatchObject({ status: 'unavailable' });
    view = { ...view, revision: 4, records: [] };
    expect(await next.sync()).toMatchObject({ status: 'ok', indexed: 0 });
    expect(await next.recall('math')).toEqual({ status: 'no_match' });
  });

  it('requires both default-off build flag and explicit hashed per-owner opt-in; opt-out erases', async () => {
    expect(await readSemanticMemoryOptIn('owner-a')).toBe(false);
    expect(await setSemanticMemoryOptIn('owner-a', true)).toBe(false);
    const index = create({ access: undefined });
    expect(await index.sync()).toEqual({ status: 'unavailable', reason: 'disabled' });
    vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
    expect(await index.sync()).toEqual({ status: 'unavailable', reason: 'not_opted_in' });
    expect(await setSemanticMemoryOptIn('owner-a', true)).toBe(true);
    expect(await readSemanticMemoryOptIn('owner-a')).toBe(true);
    expect(await readSemanticMemoryOptIn('owner-b')).toBe(false);
    expect(globalThis.localStorage.key(0)).not.toContain('owner-a');
    expect(await index.sync()).toMatchObject({ status: 'ok' });
    expect(await clearSemanticMemoryOptIn('owner-a')).toBe(true);
    expect(await index.recall('math')).toEqual({ status: 'unavailable', reason: 'not_opted_in' });
  });

  it('preserves provider unavailable reasons without throwing into core planning', async () => {
    const fake = embedder(); vi.mocked(fake.embed).mockRejectedValue(new SemanticMemoryUnavailableError('out_of_memory'));
    const index = create({ embedder: fake });
    expect(await index.sync()).toEqual({ status: 'unavailable', reason: 'out_of_memory' });
    expect(await index.recall('math')).toEqual({ status: 'unavailable', reason: 'out_of_memory' });
  });

  it('hybrid only appends bounded revalidated scoped candidates and preserves baseline/core/authority', async () => {
    view.records = [record('goal', { kind: 'study_goal' }), ...Array.from({ length: 10 }, (_, index) => record(`r${index}`))];
    const index = create({ topK: 20 }); await index.sync(); const semantic = await index.recall('math');
    const baseline = selectUserPlanningContextPromptRecordsV2({ records: view.records });
    const params = { ownerId: 'owner-a', getCanonicalView: () => view, semantic, enabled: true, maxAdditions: 2 };
    const hybrid = await selectHybridUserPlanningContextPromptRecords(params);
    expect(hybrid.slice(0, baseline.length)).toEqual(baseline);
    expect(hybrid.length).toBe(baseline.length + 2);
    expect(hybrid.slice(baseline.length).every((item) => item.relevanceTier === 'relevant' && item.origin === 'user_stated')).toBe(true);
    expect(await selectHybridUserPlanningContextPromptRecords({ ...params, enabled: false })).toEqual(baseline);
    view = { ...view, revision: 2, records: view.records.map((item) => ({ ...item, status: 'revoked' })) };
    expect(await selectHybridUserPlanningContextPromptRecords(params)).toEqual([]);
  });

  it('hybrid never returns the next owner records when owner changes during revalidation', async () => {
    const index = create(); await index.sync(); const semantic = await index.recall('math');
    let reads = 0;
    const result = await selectHybridUserPlanningContextPromptRecords({ ownerId: 'owner-a', semantic, enabled: true,
      getCanonicalView: () => ++reads === 1 ? view : { ownerId: 'owner-b', revision: 2,
        records: [record('secret-b', { ownerId: 'owner-b' })] } });
    expect(result).toEqual([]);
  });
});
