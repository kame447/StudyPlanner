import type { SemanticMemoryModelDescriptor } from '../semanticMemoryContract';

/**
 * MIT upstream intfloat/multilingual-e5-small, 100 languages including Japanese;
 * retrieval-trained with query/passage prefixes. 118,054,593-byte int8 ONNX,
 * smaller than fp16 (235 MB); q4 here is paradoxically larger (399 MB).
 * Quality is a candidate, not an acceptance claim: Japanese corpus/device gates
 * remain necessary. Public metadata pinned 2026-10-17 from:
 * https://huggingface.co/api/models/Xenova/multilingual-e5-small
 * https://huggingface.co/intfloat/multilingual-e5-small (MIT model card)
 */
export const SEMANTIC_MEMORY_MODEL: Readonly<SemanticMemoryModelDescriptor> = Object.freeze({
  modelId: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  maxWeightBytes: 120_000_000,
});
// Exact pinned ONNX weight size for the opt-in download disclosure (not runtime overhead).
export const SEMANTIC_MEMORY_MODEL_WEIGHT_BYTES = 118_054_593;
export const SEMANTIC_MEMORY_MODEL_CACHE = 'laplance-semantic-memory-model-v1';
export const MAX_EMBEDDING_BATCH = 8;
export const MAX_EMBEDDING_TEXT_LENGTH = 2048;
export const MAX_PENDING_EMBEDDINGS = 8;
export const EMBEDDING_TIMEOUT_MS = 120_000;
