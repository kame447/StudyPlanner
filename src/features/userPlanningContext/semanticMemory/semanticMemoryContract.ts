/**
 * Issue #294 — on-device semantic candidate discovery (shared contract).
 *
 * The local vector index is a disposable candidate-discovery cache. It never
 * owns memory truth: Firestore / userPlanningContext records stay canonical,
 * and every vector candidate is re-validated against the current canonical
 * records (owner, active status, content fingerprint, revision) before use.
 *
 * Ownership of the implementation lives in sibling modules:
 * - runtime/  : model loading, Web Worker, WASM/WebGPU backend selection
 * - index/    : IndexedDB store, sync/forget, recall-time revalidation, hybrid
 * - evaluation fixtures / tests : Japanese synthetic corpus and comparisons
 */
import type { UserPlanningContextRecordV1 } from '../userPlanningContextTypes';

/** Feature stays OFF unless both the build flag and the user's explicit opt-in are set. */
export const SEMANTIC_MEMORY_BUILD_FLAG_ENV = 'VITE_SEMANTIC_MEMORY_ENABLED' as const;

/** Bump when the stored vector layout or fingerprint rules change; old stores are discarded. */
export const SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION = 1 as const;

export type SemanticMemoryBackend = 'webgpu' | 'wasm';

/**
 * Public-weights model descriptor. `revision` must be pinned (commit SHA or
 * immutable tag); weights are fetched only from the public model host and
 * never together with user memory text.
 */
export interface SemanticMemoryModelDescriptor {
  modelId: string;
  revision: string;
  dimensions: number;
  /** Optional instruction prefixes required by the model (e.g. e5 "query: "/"passage: "). */
  queryPrefix: string;
  passagePrefix: string;
  /** Upper bound on downloaded weight bytes accepted by the runtime. */
  maxWeightBytes: number;
}

export type SemanticMemoryUnavailableReason =
  | 'disabled'
  | 'not_opted_in'
  | 'unsupported_environment'
  | 'model_download_failed'
  | 'model_load_failed'
  | 'out_of_memory'
  | 'timeout'
  | 'aborted'
  | 'storage_unavailable'
  | 'quota_exceeded'
  | 'owner_mismatch'
  | 'internal_error';

export class SemanticMemoryUnavailableError extends Error {
  readonly reason: SemanticMemoryUnavailableReason;

  constructor(reason: SemanticMemoryUnavailableReason, message?: string) {
    super(message ?? `semantic memory unavailable: ${reason}`);
    this.name = 'SemanticMemoryUnavailableError';
    this.reason = reason;
  }
}

/** Embedding port implemented by runtime/ (worker-backed) and by deterministic test fakes. */
export interface SemanticMemoryEmbedder {
  readonly model: SemanticMemoryModelDescriptor;
  readonly backend: SemanticMemoryBackend;
  embed(
    texts: readonly string[],
    role: 'query' | 'passage',
    signal?: AbortSignal,
  ): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

/** Fingerprint of the canonical record fields that were embedded. */
export interface SemanticMemorySourceRef {
  ownerId: string;
  recordId: string;
  /** Owner-level canonical revision (cloud document revision) the vector was built from. */
  sourceRevision: number;
  /** Stable hash of the embedded text fields; mismatch means the vector is stale. */
  contentFingerprint: string;
}

export interface SemanticMemoryIndexEntry extends SemanticMemorySourceRef {
  schemaVersion: typeof SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION;
  modelId: string;
  modelRevision: string;
  vector: Float32Array;
  indexedAt: string;
}

export interface SemanticMemoryCandidate extends SemanticMemorySourceRef {
  score: number;
}

/** Retrieval outcome; `unavailable` must never be confused with an authoritative empty result. */
export type SemanticMemoryRecallResult =
  | { status: 'ok'; candidates: SemanticMemoryCandidate[] }
  | { status: 'no_match' }
  | { status: 'unavailable'; reason: SemanticMemoryUnavailableReason };

/** Canonical view used for recall-time revalidation. */
export interface SemanticMemoryCanonicalView {
  ownerId: string;
  revision: number;
  records: readonly UserPlanningContextRecordV1[];
}
