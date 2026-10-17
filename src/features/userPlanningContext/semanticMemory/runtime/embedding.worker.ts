import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import gpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import gpuModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { SemanticMemoryUnavailableError } from '../semanticMemoryContract';
import { createChunkedModelCache } from './chunkedModelCache';
import { traceModelCache } from './cacheDiagnostics';
import { createEmbeddingEngine } from './engine';
import { createPublicModelFetch } from './modelFetch';
import { SEMANTIC_MEMORY_MODEL, SEMANTIC_MEMORY_MODEL_CACHE } from './model';
import type { EmbeddingRequest } from './protocol';

const scope = globalThis as typeof globalThis & {
  navigator: Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  postMessage(message: unknown, transfer: Transferable[]): void;
};
let debugCache = false;
let publicModelDownloadBytes = 0;
let library: Promise<typeof import('@huggingface/transformers')> | undefined;
const engine = createEmbeddingEngine({
  requestAdapter: async () => scope.navigator?.gpu?.requestAdapter(),
  async load(backend) {
    if (typeof WebAssembly === 'undefined') throw new SemanticMemoryUnavailableError('unsupported_environment');
    // The only Transformers import in the app: unreachable until the first embed.
    library ??= import('@huggingface/transformers');
    const { env, pipeline } = await library;
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.remoteHost = 'https://huggingface.co/';
    // 4.3.0 registry probes omit revision internally. Force every probe and
    // actual download to the immutable revision, including their cache keys.
    env.remotePathTemplate = `{model}/resolve/${SEMANTIC_MEMORY_MODEL.revision}/`;
    env.useBrowserCache = typeof caches !== 'undefined';
    env.cacheKey = SEMANTIC_MEMORY_MODEL_CACHE;
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(SEMANTIC_MEMORY_MODEL_CACHE);
      if (debugCache) console.debug('semantic-memory-cache-configured', JSON.stringify({ useBrowserCache: env.useBrowserCache, cacheKey: env.cacheKey, nativeCache: cache instanceof Cache }));
      env.useCustomCache = true;
      const chunked = createChunkedModelCache(cache);
      env.customCache = debugCache ? traceModelCache(chunked, event => console.debug('semantic-memory-cache', JSON.stringify(event))) : chunked;
    }
    env.useFSCache = false;
    env.useWasmCache = true;
    const urls = [wasmUrl, wasmModuleUrl, gpuWasmUrl, gpuModuleUrl].map(url => new URL(url, scope.location.href).href);
    env.fetch = createPublicModelFetch(globalThis.fetch.bind(globalThis), urls, bytes => { publicModelDownloadBytes += bytes; });
    const wasm = env.backends.onnx.wasm!;
    // Single thread also on isolated pages: bounded baseline, compatible with iOS.
    wasm.numThreads = 1;
    wasm.proxy = false;
    wasm.wasmPaths = backend === 'webgpu'
      ? { wasm: urls[2], mjs: urls[3] }
      : { wasm: urls[0], mjs: urls[1] };
    const extractor = await pipeline('feature-extraction', SEMANTIC_MEMORY_MODEL.modelId, {
      revision: SEMANTIC_MEMORY_MODEL.revision, device: backend, dtype: 'int8',
    });
    const embed = async (texts: string[]) => {
      const tensor = await extractor(texts, { pooling: 'mean', normalize: true });
      const data = tensor.data as Float32Array;
      return texts.map((_, index) => Float32Array.from(data.subarray(index * 384, (index + 1) * 384)));
    };
    return Object.assign(embed, { dispose: async () => { await extractor.dispose(); } });
  },
});
scope.onmessage = (event: MessageEvent<EmbeddingRequest>) => {
  if (event.data?.type !== 'embed' || !Number.isSafeInteger(event.data.id)) return;
  debugCache = event.data.debugCache === true;
  void engine.handle(event.data).then(result => {
    if (result.type === 'result' && result.timings) result.timings.publicModelDownloadBytes = publicModelDownloadBytes;
    const transfer = result.type === 'result' ? result.vectors.map(vector => vector.buffer) : [];
    scope.postMessage(result, transfer);
  });
};
