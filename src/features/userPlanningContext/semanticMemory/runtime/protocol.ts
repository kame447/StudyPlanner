import { SemanticMemoryUnavailableError, type SemanticMemoryBackend, type SemanticMemoryUnavailableReason } from '../semanticMemoryContract';
import { MAX_EMBEDDING_BATCH, MAX_EMBEDDING_TEXT_LENGTH } from './model';

export interface EmbeddingRequest {
  type: 'embed';
  id: number;
  texts: string[];
  role: 'query' | 'passage';
  backendPreference?: 'auto' | 'wasm';
}
export type EmbeddingResponse =
  | { type: 'result'; id: number; backend: SemanticMemoryBackend; vectors: Float32Array[]; timings?: { modelLoadMs: number; embedMs: number } }
  | { type: 'error'; id: number; reason: SemanticMemoryUnavailableReason };

export function validateEmbeddingInput(texts: readonly string[], role: string): void {
  if (!Array.isArray(texts) || texts.length > MAX_EMBEDDING_BATCH ||
      texts.some(text => typeof text !== 'string' || text.length > MAX_EMBEDDING_TEXT_LENGTH) ||
      (role !== 'query' && role !== 'passage')) {
    throw new SemanticMemoryUnavailableError('internal_error', 'embedding input exceeds bounded runtime contract');
  }
}

/** Only infrastructure exceptions are classified; no user-language interpretation. */
export function mapRuntimeError(error: unknown, phase: 'download' | 'load' | 'embed'): SemanticMemoryUnavailableReason {
  if (error instanceof SemanticMemoryUnavailableError) return error.reason;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'AbortError') return 'aborted';
  if (name === 'TimeoutError') return 'timeout';
  if (/out of memory|memory access out of bounds|allocation failed|could not allocate memory|cannot enlarge memory|bad_alloc/i.test(message)) return 'out_of_memory';
  if (phase === 'download') return 'model_download_failed';
  return 'model_load_failed';
}
