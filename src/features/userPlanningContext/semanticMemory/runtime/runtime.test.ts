import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSemanticMemoryEmbedder, clearSemanticMemoryModelCache, type EmbeddingWorkerPort } from './index';
import { createEmbeddingEngine, type EmbeddingPipeline } from './engine';
import { createPublicModelFetch } from './modelFetch';
import { mapRuntimeError } from './protocol';
import { SEMANTIC_MEMORY_MODEL, SEMANTIC_MEMORY_MODEL_CACHE } from './model';
import { SemanticMemoryUnavailableError } from '../semanticMemoryContract';
import type { EmbeddingRequest, EmbeddingResponse } from './protocol';

class FakeWorker implements EmbeddingWorkerPort {
  onmessage: EmbeddingWorkerPort['onmessage'] = null;
  onerror: EmbeddingWorkerPort['onerror'] = null;
  onmessageerror: EmbeddingWorkerPort['onmessageerror'] = null;
  postMessage = vi.fn<(request: EmbeddingRequest) => void>();
  terminate = vi.fn();
  reply(response: EmbeddingResponse) { this.onmessage?.({ data: response } as MessageEvent<EmbeddingResponse>); }
}
const vector = () => new Float32Array(384).fill(0.1);
function fakePipeline(): EmbeddingPipeline {
  return Object.assign(vi.fn(async (texts: string[]) => texts.map(vector)), { dispose: vi.fn(async () => {}) });
}
const request = (id: number, text = '合成テキスト'): EmbeddingRequest => ({ type: 'embed', id, role: 'query', texts: [text] });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('lazy bounded worker transport', () => {
  it('rejects disabled and non-opted-in construction without touching worker or fetch', () => {
    const factory = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(() => createSemanticMemoryEmbedder({ enabled: false, optedIn: true, workerFactory: factory })).toThrowError(expect.objectContaining({ reason: 'disabled' }));
    expect(() => createSemanticMemoryEmbedder({ enabled: true, optedIn: false, workerFactory: factory })).toThrowError(expect.objectContaining({ reason: 'not_opted_in' }));
    expect(factory).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('is lazy, caps input, correlates out-of-order IDs and accepts backend after warm-up', async () => {
    const worker = new FakeWorker(); const factory = vi.fn(() => worker);
    const embedder = createSemanticMemoryEmbedder({ enabled: true, optedIn: true, workerFactory: factory });
    expect(factory).not.toHaveBeenCalled(); expect(await embedder.embed([], 'query')).toEqual([]);
    await expect(embedder.embed(['x'.repeat(2049)], 'query')).rejects.toMatchObject({ reason: 'internal_error' });
    await expect(embedder.embed(Array(9).fill('x'), 'query')).rejects.toMatchObject({ reason: 'internal_error' });
    expect(factory).not.toHaveBeenCalled();
    const first = embedder.embed(['one'], 'query'); const second = embedder.embed(['two'], 'passage');
    worker.reply({ type: 'result', id: 99, backend: 'wasm', vectors: [] });
    worker.reply({ type: 'result', id: 2, backend: 'webgpu', vectors: [vector()] });
    worker.reply({ type: 'error', id: 1, reason: 'out_of_memory' });
    await expect(first).rejects.toMatchObject({ reason: 'out_of_memory' });
    expect((await second)[0]).toHaveLength(384); expect(embedder.backend).toBe('webgpu');
    expect(factory).toHaveBeenCalledTimes(1); await embedder.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('aborts all queued work, terminates computation, ignores late results and can retry fresh', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]; let index = 0;
    const embedder = createSemanticMemoryEmbedder({ enabled: true, optedIn: true, workerFactory: () => workers[index++] });
    const abort = new AbortController();
    const a = embedder.embed(['secret'], 'query', abort.signal); const b = embedder.embed(['queued'], 'query');
    abort.abort();
    await expect(a).rejects.toMatchObject({ reason: 'aborted' }); await expect(b).rejects.toMatchObject({ reason: 'aborted' });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const c = embedder.embed(['new'], 'query');
    expect(workers[0].onerror).toBeNull();
    workers[0].reply({ type: 'result', id: 1, backend: 'webgpu', vectors: [vector()] });
    workers[1].reply({ type: 'result', id: 3, backend: 'wasm', vectors: [vector()] });
    expect(await c).toHaveLength(1); await embedder.dispose();
    await expect(embedder.embed(['x'], 'query')).rejects.toMatchObject({ reason: 'aborted' });
  });
  it('pre-aborted call starts nothing; timeout and worker errors terminate', async () => {
    vi.useFakeTimers(); const worker = new FakeWorker(); const factory = vi.fn(() => worker);
    const embedder = createSemanticMemoryEmbedder({ enabled: true, optedIn: true, workerFactory: factory, timeoutMs: 10 });
    await expect(embedder.embed(['x'], 'query', AbortSignal.abort())).rejects.toMatchObject({ reason: 'aborted' });
    expect(factory).not.toHaveBeenCalled();
    const timed = expect(embedder.embed(['x'], 'query')).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(10); await timed; expect(worker.terminate).toHaveBeenCalledOnce();
    const crash = embedder.embed(['x'], 'query'); worker.onerror?.({} as ErrorEvent);
    await expect(crash).rejects.toMatchObject({ reason: 'model_load_failed' }); await embedder.dispose();
  });
  it('caps queued work and fails unsupported environments without exposing native errors', async () => {
    const unsupported = createSemanticMemoryEmbedder({ enabled: true, optedIn: true, workerFactory: () => { throw Error('native details'); } });
    await expect(unsupported.embed(['x'], 'query')).rejects.toMatchObject({ reason: 'unsupported_environment' });
    const worker = new FakeWorker(); const embedder = createSemanticMemoryEmbedder({ enabled: true, optedIn: true, workerFactory: () => worker });
    const queued = Array.from({ length: 8 }, () => embedder.embed(['x'], 'query').catch(error => error));
    await expect(embedder.embed(['x'], 'query')).rejects.toMatchObject({ reason: 'internal_error' });
    await embedder.dispose(); expect((await Promise.all(queued)).every(error => error.reason === 'aborted')).toBe(true);
  });
  it('clears only the namespaced public model cache and maps storage denial', async () => {
    const remove = vi.fn(async () => true); vi.stubGlobal('caches', { delete: remove });
    await clearSemanticMemoryModelCache(); expect(remove).toHaveBeenCalledWith(SEMANTIC_MEMORY_MODEL_CACHE);
    remove.mockRejectedValueOnce(Error('denied'));
    await expect(clearSemanticMemoryModelCache()).rejects.toMatchObject({ reason: 'storage_unavailable' });
  });
});

describe('worker engine', () => {
  it('loads once for concurrent calls, prefixes correctly, and warms before user inputs', async () => {
    const fetcher = vi.fn(() => { throw Error('text must not reach network'); }); vi.stubGlobal('fetch', fetcher);
    const pipeline = fakePipeline(); const load = vi.fn(async () => pipeline); const adapter = vi.fn(async () => null);
    const engine = createEmbeddingEngine({ requestAdapter: adapter, load }); expect(load).not.toHaveBeenCalled();
    expect(await engine.handle({ ...request(0), texts: [] })).toMatchObject({ type: 'result', vectors: [] }); expect(load).not.toHaveBeenCalled();
    const results = await Promise.all([engine.handle(request(1)), engine.handle({ ...request(2), role: 'passage' })]);
    expect(results.map(result => result.type)).toEqual(['result', 'result']); expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('wasm');
    expect(pipeline).toHaveBeenNthCalledWith(1, ['query: test']);
    expect(pipeline).toHaveBeenNthCalledWith(2, ['query: 合成テキスト']);
    expect(pipeline).toHaveBeenNthCalledWith(3, ['passage: 合成テキスト']);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('falls back on adapter rejection and on GPU warm-up failure', async () => {
    const gpu = fakePipeline(); vi.mocked(gpu).mockRejectedValueOnce(Error('unsupported kernel'));
    const wasm = fakePipeline(); const load = vi.fn(async (backend: string) => backend === 'webgpu' ? gpu : wasm);
    const engine = createEmbeddingEngine({ requestAdapter: async () => ({}), load });
    expect(await engine.handle(request(1))).toMatchObject({ type: 'result', backend: 'wasm' });
    expect(gpu.dispose).toHaveBeenCalledOnce(); expect(load.mock.calls.map(args => args[0])).toEqual(['webgpu', 'wasm']);
    const rejectedAdapter = createEmbeddingEngine({ requestAdapter: async () => { throw Error('denied'); }, load });
    expect(await rejectedAdapter.handle(request(2))).toMatchObject({ type: 'result', backend: 'wasm' });
  });
  it('rejects bad vectors, download errors and memory failure with typed reasons', async () => {
    const invalid = Object.assign(async () => [new Float32Array(1)], { dispose: async () => {} });
    const engine = createEmbeddingEngine({ requestAdapter: async () => null, load: async () => invalid });
    expect(await engine.handle(request(1))).toMatchObject({ type: 'error', reason: 'model_load_failed' });
    for (const [error, reason] of [[new SemanticMemoryUnavailableError('model_download_failed'), 'model_download_failed'], [Error('out of memory'), 'out_of_memory']] as const) {
      const failing = createEmbeddingEngine({ requestAdapter: async () => null, load: async () => { throw error; } });
      expect(await failing.handle(request(1))).toMatchObject({ type: 'error', reason });
    }
    expect(mapRuntimeError(new DOMException('', 'AbortError'), 'load')).toBe('aborted');
    expect(mapRuntimeError(new DOMException('', 'TimeoutError'), 'load')).toBe('timeout');
    expect(mapRuntimeError(Error('network'), 'download')).toBe('model_download_failed');
  });
});

describe('public artifact network boundary', () => {
  const base = `https://huggingface.co/${SEMANTIC_MEMORY_MODEL.modelId}/resolve/${SEMANTIC_MEMORY_MODEL.revision}/`;
  it('only fetches immutable artifact URLs via GET with no text/body/credentials', async () => {
    const fetcher = vi.fn(async () => new Response('model')) as unknown as typeof fetch;
    const fetchPublic = createPublicModelFetch(fetcher);
    const response = await fetchPublic(base + 'tokenizer.json'); expect(await response.text()).toBe('model');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(base + 'tokenizer.json', { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
    for (const url of ['https://api.example/embedding', base + 'tokenizer.json?text=secret', base + '../secret', base.replace(SEMANTIC_MEMORY_MODEL.revision, 'main') + 'config.json']) {
      await expect(fetchPublic(url)).rejects.toMatchObject({ reason: 'model_download_failed' });
    }
    await expect(fetchPublic(base + 'config.json', { method: 'POST', body: 'private' })).rejects.toMatchObject({ reason: 'model_download_failed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds weights before downloading and while streaming without content-length', async () => {
    const big = vi.fn(async () => new Response('x', { headers: { 'content-length': String(SEMANTIC_MEMORY_MODEL.maxWeightBytes + 1) } }));
    await expect(createPublicModelFetch(big)(base + 'onnx/model_int8.onnx')).rejects.toMatchObject({ reason: 'model_download_failed' });
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20_000_001)); controller.close(); } });
    const response = await createPublicModelFetch(async () => new Response(stream))(base + 'tokenizer.json');
    await expect(response.arrayBuffer()).rejects.toMatchObject({ reason: 'model_download_failed' });
  });
  it('maps HTTP and network failures without leaking error details', async () => {
    await expect(createPublicModelFetch(async () => new Response('', { status: 503 }))(base + 'config.json')).rejects.toMatchObject({ reason: 'model_download_failed' });
    await expect(createPublicModelFetch(async () => { throw Error('sensitive'); })(base + 'config.json')).rejects.toMatchObject({ reason: 'model_download_failed' });
    const interrupted = new ReadableStream({ pull(controller) { controller.error(Error('network connection interrupted')); } });
    const response = await createPublicModelFetch(async () => new Response(interrupted))(base + 'config.json');
    await expect(response.arrayBuffer()).rejects.toMatchObject({ reason: 'model_download_failed' });
  });
});
