/**
 * Evaluation-only Node adapter for realModel.optIn.test.ts.
 *
 * Uses the same public model, pinned revision, int8 dtype, prefixes, mean
 * pooling and normalization as the browser runtime, but runs on the local
 * Node ONNX backend. Only the synthetic corpus is embedded. This is retrieval
 * quality evidence for the model, not browser or iPhone Safari evidence.
 */
import { SEMANTIC_MEMORY_MODEL } from '../runtime/model';
import type { SemanticMemoryEmbedder } from '../semanticMemoryContract';

export async function createSemanticMemoryEvaluationEmbedder(): Promise<SemanticMemoryEmbedder> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.remotePathTemplate = `{model}/resolve/${SEMANTIC_MEMORY_MODEL.revision}/`;
  env.cacheDir = process.env.SEMANTIC_MEMORY_EVAL_CACHE_DIR ?? '/tmp/laplance-semantic-memory-eval-cache';
  const extractor = await pipeline('feature-extraction', SEMANTIC_MEMORY_MODEL.modelId, {
    revision: SEMANTIC_MEMORY_MODEL.revision, dtype: 'int8', device: 'cpu',
  });
  return {
    model: SEMANTIC_MEMORY_MODEL,
    backend: 'wasm',
    async embed(texts, role) {
      const prefix = role === 'query' ? SEMANTIC_MEMORY_MODEL.queryPrefix : SEMANTIC_MEMORY_MODEL.passagePrefix;
      const vectors: Float32Array[] = [];
      for (const text of texts) {
        const tensor = await extractor([prefix + text], { pooling: 'mean', normalize: true });
        vectors.push(Float32Array.from(tensor.data as Float32Array));
      }
      return vectors;
    },
    async dispose() { await extractor.dispose(); },
  };
}
