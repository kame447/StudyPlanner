import { SemanticMemoryUnavailableError, type SemanticMemoryEmbedder, type SemanticMemoryBackend, type SemanticMemoryUnavailableReason } from '../semanticMemoryContract';
import { EMBEDDING_TIMEOUT_MS, MAX_PENDING_EMBEDDINGS, SEMANTIC_MEMORY_MODEL, SEMANTIC_MEMORY_MODEL_CACHE } from './model';
import { validateEmbeddingInput, type EmbeddingResponse, type EmbeddingRequest } from './protocol';
export { SEMANTIC_MEMORY_MODEL, SEMANTIC_MEMORY_MODEL_CACHE, SEMANTIC_MEMORY_MODEL_WEIGHT_BYTES } from './model';

export interface EmbeddingWorkerPort {
  postMessage(message: EmbeddingRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<EmbeddingResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export interface SemanticMemoryEmbedderOptions {
  enabled: boolean;
  optedIn: boolean;
  /** Tests inject a transport; production always uses the module Worker. */
  workerFactory?: () => EmbeddingWorkerPort;
  timeoutMs?: number;
  /** Explicit device policy; never inferred from input text. */
  backendPreference?: 'auto' | 'wasm';
  /** Local public-artifact diagnostics for the synthetic harness. OFF by default. */
  debugCache?: boolean;
  /** Local privacy-safe benchmark hook; never contains text or vectors. */
  onMetrics?: (metrics: { backend: SemanticMemoryBackend; modelLoadMs: number; embedMs: number; publicModelDownloadBytes?: number }) => void;
}

/** Synchronous gate; no Worker, import, fetch or cache access before an embed. */
export function createSemanticMemoryEmbedder(options: SemanticMemoryEmbedderOptions): SemanticMemoryEmbedder {
  if (!options.enabled) throw new SemanticMemoryUnavailableError('disabled');
  if (!options.optedIn) throw new SemanticMemoryUnavailableError('not_opted_in');
  let worker: EmbeddingWorkerPort | undefined;
  let disposed = false;
  let sequence = 0;
  let backend: SemanticMemoryBackend = 'wasm'; // Provisional until a warm-up/result succeeds.
  const pending = new Map<number, { resolve(vectors: Float32Array[]): void; reject(error: unknown): void; cleanup(): void }>();
  const stop = (reason: SemanticMemoryUnavailableReason) => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    worker = undefined;
    for (const call of pending.values()) { call.cleanup(); call.reject(new SemanticMemoryUnavailableError(reason)); }
    pending.clear();
  };
  const getWorker = () => {
    if (worker) return worker;
    try {
      worker = options.workerFactory ? options.workerFactory() : new Worker(new URL('./embedding.worker.ts', import.meta.url), { type: 'module', name: 'semantic-memory' });
    } catch { throw new SemanticMemoryUnavailableError('unsupported_environment'); }
    worker.onmessage = event => {
      const result = event.data;
      const call = pending.get(result?.id);
      if (!call) return;
      if (result.type !== 'result' && result.type !== 'error') { stop('internal_error'); return; }
      pending.delete(result.id);
      call.cleanup();
      if (result.type === 'error') call.reject(new SemanticMemoryUnavailableError(result.reason));
      else {
        backend = result.backend;
        if (result.timings) {
          try { options.onMetrics?.({ backend, ...result.timings }); } catch { /* Metrics do not own execution. */ }
        }
        call.resolve(result.vectors);
      }
    };
    worker.onerror = () => stop('model_load_failed');
    worker.onmessageerror = () => stop('internal_error');
    return worker;
  };
  return {
    model: SEMANTIC_MEMORY_MODEL,
    get backend() { return backend; },
    async embed(texts, role, signal) {
      if (disposed || signal?.aborted) throw new SemanticMemoryUnavailableError('aborted');
      validateEmbeddingInput(texts, role);
      if (!texts.length) return [];
      if (pending.size >= MAX_PENDING_EMBEDDINGS) throw new SemanticMemoryUnavailableError('internal_error');
      const transport = getWorker();
      const id = ++sequence;
      return new Promise<Float32Array[]>((resolve, reject) => {
        // ONNX cannot interrupt kernels reliably. Termination releases all text,
        // queued calls and model memory; sibling calls also fail closed. The next
        // call can lazily create a fresh worker. No late result can reach callers.
        const abort = () => stop('aborted');
        const timeout = setTimeout(() => stop('timeout'), options.timeoutMs ?? EMBEDDING_TIMEOUT_MS);
        pending.set(id, { resolve, reject, cleanup: () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); } });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        try { transport.postMessage({ type: 'embed', id, texts: [...texts], role, backendPreference: options.backendPreference ?? 'auto', debugCache: options.debugCache === true }); }
        catch { stop('model_load_failed'); }
      });
    },
    async dispose() { disposed = true; stop('aborted'); },
  };
}

/** Dispose embedders before clearing so a live download cannot refill the cache. */
export async function clearSemanticMemoryModelCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(SEMANTIC_MEMORY_MODEL_CACHE);
  } catch { throw new SemanticMemoryUnavailableError('storage_unavailable'); }
}
