import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSemanticMemoryApplication } from './semanticMemoryApplication';
import type { SemanticMemoryCanonicalView, SemanticMemoryEmbedder } from '../semanticMemoryContract';

function view(ownerId = 'owner-a', revision = 1): SemanticMemoryCanonicalView {
  return { ownerId, revision, records: [{ id: 'synthetic-memory', ownerId, kind: 'concern',
    label: '数学', value: '計算が苦手', sourceText: '数学が苦手', status: 'active', origin: 'user_stated',
    dateExpression: null, observedDate: '2026-10-17', resolvedDate: null,
    recordedAt: '2026-10-17T00:00:00Z', sourceConversationId: 'synthetic', sourceTurnId: '1' }] };
}
function fakeEmbedder(): SemanticMemoryEmbedder {
  return { model: { modelId: 'fake', revision: 'test', dimensions: 2, queryPrefix: '', passagePrefix: '', maxWeightBytes: 0 },
    backend: 'wasm', embed: vi.fn(async (texts) => texts.map(() => new Float32Array([1, 0]))),
    dispose: vi.fn(async () => undefined) };
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('flag off publishes only canonical data: no Worker, model or IndexedDB opens', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'false');
  const worker = vi.fn(); const open = vi.spyOn(globalThis.indexedDB, 'open');
  vi.stubGlobal('Worker', worker);
  const createEmbedder = vi.fn(async () => fakeEmbedder());
  const erase = vi.fn(async () => ({ status: 'ok' as const }));
  const app = createSemanticMemoryApplication({ access: async () => null, createEmbedder, erase });
  const connection = app.connect('owner-a'); connection.publish(view());
  expect(app.canonical('owner-a')).toEqual(view());
  expect(await app.recall('owner-a', '計算')).toMatchObject({ status: 'unavailable' });
  app.ownerChanged(); await vi.waitFor(() => expect(erase).toHaveBeenCalledOnce());
  expect(app.canonical('owner-a')).toBeNull();
  expect(worker).not.toHaveBeenCalled(); expect(createEmbedder).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it('flag on without consent does no model or IndexedDB work', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  const createEmbedder = vi.fn(async () => fakeEmbedder()); const open = vi.spyOn(globalThis.indexedDB, 'open');
  const app = createSemanticMemoryApplication({ access: async () => 'not_opted_in', createEmbedder });
  const scope = app.connect('owner-a'); scope.publish(view());
  expect(await app.recall('owner-a', '計算')).toMatchObject({ status: 'unavailable' });
  expect(createEmbedder).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); scope.dispose();
});

it('builds lazily when consent is granted after canonical hydration', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  let optedIn = false;
  const createEmbedder = vi.fn(async () => fakeEmbedder());
  const app = createSemanticMemoryApplication({ access: async () => optedIn ? null : 'not_opted_in', createEmbedder });
  const scope = app.connect('owner-a'); scope.publish(view());
  expect(await app.recall('owner-a', '計算')).toMatchObject({ status: 'unavailable' });
  expect(createEmbedder).not.toHaveBeenCalled();
  optedIn = true;
  expect(await app.recall('owner-a', '計算')).toMatchObject({ status: 'ok' });
  scope.dispose();
});

it('syncs the canonical revision, rejects stale publish and recalls current records', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  const embedder = fakeEmbedder();
  const app = createSemanticMemoryApplication({ access: async () => null, createEmbedder: async () => embedder });
  const scope = app.connect('owner-a'); scope.publish(view('owner-a', 5));
  await vi.waitFor(() => expect(embedder.embed).toHaveBeenCalled());
  await vi.waitFor(async () => expect(await app.recall('owner-a', '計算')).toMatchObject({ status: 'ok' }));
  scope.publish(view('owner-a', 2));
  expect(app.canonical('owner-a')).toEqual(view('owner-a', 5));
  scope.publish({ ...view('owner-a', 5), records: [] });
  expect(app.canonical('owner-a')).toBeNull();
  expect(await app.recall('owner-a', '計算')).toMatchObject({ status: 'unavailable' });
  scope.publish(view('owner-a', 4));
  expect(app.canonical('owner-a')).toBeNull();
  scope.publish({ ...view('owner-a', 6), records: [] });
  expect(await app.recall('owner-a', '計算')).toEqual({ status: 'no_match' }); scope.dispose();
});

it('owner change cancels pending work synchronously and new owner waits for erase', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  let releaseErase!: () => void;
  const erase = vi.fn(() => new Promise<{ status: 'ok' }>((resolve) => { releaseErase = () => resolve({ status: 'ok' }); }));
  const first = fakeEmbedder(); const second = fakeEmbedder();
  const createEmbedder = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const app = createSemanticMemoryApplication({ access: async () => null, createEmbedder, erase });
  const old = app.connect('owner-a'); old.publish(view());
  await vi.waitFor(() => expect(first.embed).toHaveBeenCalled());
  app.ownerChanged();
  expect(app.canonical('owner-a')).toBeNull(); expect(first.dispose).toHaveBeenCalledOnce();
  old.publish(view('owner-a', 99));
  const next = app.connect('owner-b'); next.publish(view('owner-b'));
  await vi.waitFor(() => expect(erase).toHaveBeenCalledOnce());
  expect(createEmbedder).toHaveBeenCalledOnce(); expect(app.canonical('owner-a')).toBeNull();
  releaseErase(); await vi.waitFor(() => expect(createEmbedder).toHaveBeenCalledTimes(2));
  old.dispose(); expect(app.canonical('owner-b')).toEqual(view('owner-b')); next.dispose();
});

it('failed erase keeps the next owner semantic cache unavailable', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  const createEmbedder = vi.fn(async () => fakeEmbedder());
  const app = createSemanticMemoryApplication({ access: async () => null, createEmbedder,
    erase: async () => ({ status: 'unavailable', reason: 'storage_unavailable' }) });
  app.ownerChanged(); const scope = app.connect('owner-b'); scope.publish(view('owner-b'));
  expect(await app.recall('owner-b', '計算')).toMatchObject({ status: 'unavailable' });
  expect(createEmbedder).not.toHaveBeenCalled(); scope.dispose();
});

it('disposes a model that finishes creating after its owner lifetime ended', async () => {
  vi.stubEnv('VITE_SEMANTIC_MEMORY_ENABLED', 'true');
  const embedder = fakeEmbedder(); let finish!: (value: SemanticMemoryEmbedder) => void;
  const createEmbedder = vi.fn(() => new Promise<SemanticMemoryEmbedder>((resolve) => { finish = resolve; }));
  const app = createSemanticMemoryApplication({ access: async () => null, createEmbedder });
  const scope = app.connect('owner-a'); scope.publish(view());
  await vi.waitFor(() => expect(createEmbedder).toHaveBeenCalledOnce());
  scope.dispose(); finish(embedder);
  await vi.waitFor(() => expect(embedder.dispose).toHaveBeenCalledOnce());
  expect(embedder.embed).not.toHaveBeenCalled();
});
