import { SemanticMemoryUnavailableError, type SemanticMemoryBackend } from '../semanticMemoryContract';
import { SEMANTIC_MEMORY_MODEL } from './model';
import { validateEmbeddingInput, type EmbeddingRequest, type EmbeddingResponse, mapRuntimeError } from './protocol';

export interface EmbeddingPipeline {
  (texts: string[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}
export interface EmbeddingEngineDependencies {
  requestAdapter(): Promise<unknown>;
  load(backend: SemanticMemoryBackend): Promise<EmbeddingPipeline>;
}

/** Worker-only engine. Construction and empty batches do not load model/runtime. */
export function createEmbeddingEngine(dependencies: EmbeddingEngineDependencies) {
  let loaded: Promise<{ pipeline: EmbeddingPipeline; backend: SemanticMemoryBackend; modelLoadMs: number }> | undefined;
  let queue = Promise.resolve();
  async function loadAndWarm() {
    const started = performance.now();
    let hasAdapter = false;
    try { hasAdapter = Boolean(await dependencies.requestAdapter()); } catch { /* WASM remains available. */ }
    const backends: SemanticMemoryBackend[] = hasAdapter ? ['webgpu', 'wasm'] : ['wasm'];
    for (const backend of backends) {
      let pipeline: EmbeddingPipeline | undefined;
      try {
        pipeline = await dependencies.load(backend);
        // Adapter availability is insufficient: execute a tiny synthetic input.
        const vectors = await pipeline(['query: test']);
        assertVectors(vectors, 1);
        return { pipeline, backend, modelLoadMs: performance.now() - started };
      } catch (error) {
        await pipeline?.dispose().catch(() => undefined);
        const reason = mapRuntimeError(error, 'load');
        if (backend === 'wasm' || reason === 'model_download_failed' || reason === 'aborted') {
          throw new SemanticMemoryUnavailableError(reason);
        }
      }
    }
    throw new SemanticMemoryUnavailableError('unsupported_environment');
  }
  return {
    handle(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const operation = queue.then(async (): Promise<EmbeddingResponse> => {
        try {
          validateEmbeddingInput(request.texts, request.role);
          if (request.texts.length === 0) return { type: 'result', id: request.id, backend: 'wasm', vectors: [] };
          loaded ??= loadAndWarm().catch(error => { loaded = undefined; throw error; });
          const { pipeline, backend, modelLoadMs } = await loaded;
          const prefix = request.role === 'query' ? SEMANTIC_MEMORY_MODEL.queryPrefix : SEMANTIC_MEMORY_MODEL.passagePrefix;
          const started = performance.now();
          const vectors = await pipeline(request.texts.map(text => prefix + text));
          assertVectors(vectors, request.texts.length);
          return { type: 'result', id: request.id, backend, vectors, timings: { modelLoadMs, embedMs: performance.now() - started } };
        } catch (error) {
          return { type: 'error', id: request.id, reason: mapRuntimeError(error, 'embed') };
        }
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}

export function assertVectors(vectors: Float32Array[], count: number): void {
  if (vectors.length !== count || vectors.some(vector => vector.length !== SEMANTIC_MEMORY_MODEL.dimensions ||
      !vector.every(Number.isFinite))) {
    throw new SemanticMemoryUnavailableError('model_load_failed');
  }
}
