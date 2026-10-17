import {
  SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION,
  SemanticMemoryUnavailableError,
  type SemanticMemoryCanonicalView,
  type SemanticMemoryCandidate,
  type SemanticMemoryEmbedder,
  type SemanticMemoryRecallResult,
  type SemanticMemoryUnavailableReason,
} from '../semanticMemoryContract';
import { semanticMemoryAccess } from '../semanticMemoryOptIn';
import { semanticMemoryEmbeddedText, semanticMemoryHash, semanticMemoryRecordFingerprint } from './semanticMemoryFingerprint';
import { SemanticMemoryIndexedDbStore, semanticMemoryStorageError } from './semanticMemoryIndexedDb';

/** Provisional model-specific threshold: calibrate with eval before enabling; this is not a quality claim. */
export const DEFAULT_SEMANTIC_MEMORY_MIN_SCORE = 0.75;

export type SemanticMemorySyncResult =
  | { status: 'ok'; indexed: number; remaining: number }
  | { status: 'unavailable'; reason: SemanticMemoryUnavailableReason };

export interface SemanticMemoryIndexOptions {
  ownerId: string;
  embedder: SemanticMemoryEmbedder;
  /** Must return the current canonical snapshot, never the snapshot captured before embedding. */
  getCanonicalView: () => SemanticMemoryCanonicalView;
  batchSize?: number;
  maxRecordsPerSync?: number;
  minScore?: number;
  topK?: number;
  /** Browser adapters are injectable for deterministic, network-free tests. */
  factory?: IDBFactory;
  access?: () => Promise<SemanticMemoryUnavailableReason | null>;
}

function cap(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.min(maximum, Math.floor(value)));
}

export async function revalidateSemanticMemoryCandidates(
  ownerId: string, candidates: readonly SemanticMemoryCandidate[], view: SemanticMemoryCanonicalView,
): Promise<SemanticMemoryCandidate[]> {
  if (view.ownerId !== ownerId || !Number.isSafeInteger(view.revision) || view.revision < 0) return [];
  const current = new Map(view.records.map((record) => [record.id, record]));
  const valid: SemanticMemoryCandidate[] = [];
  for (const candidate of candidates) {
    const record = current.get(candidate.recordId);
    if (candidate.ownerId === ownerId && record?.ownerId === ownerId && record.status === 'active'
      && Number.isSafeInteger(candidate.sourceRevision) && candidate.sourceRevision >= 0
      && candidate.sourceRevision <= view.revision && Number.isFinite(candidate.score)
      && candidate.contentFingerprint === await semanticMemoryRecordFingerprint(record)) valid.push(candidate);
  }
  return valid;
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (!left.length || left.length !== right.length) return -Infinity;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) return -Infinity;
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -Infinity;
}

export class SemanticMemoryIndex {
  private readonly store: SemanticMemoryIndexedDbStore;
  private disposed = false;
  constructor(private readonly options: SemanticMemoryIndexOptions) {
    this.store = new SemanticMemoryIndexedDbStore(options.ownerId, options.embedder.model, options.factory);
  }

  private async guard(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new SemanticMemoryUnavailableError('aborted');
    if (this.disposed) throw new SemanticMemoryUnavailableError('not_opted_in');
    const reason = await (this.options.access?.() ?? semanticMemoryAccess(this.options.ownerId));
    if (reason) throw new SemanticMemoryUnavailableError(reason);
    if (signal?.aborted) throw new SemanticMemoryUnavailableError('aborted');
  }

  private view(): SemanticMemoryCanonicalView {
    const view = this.options.getCanonicalView();
    if (view.ownerId !== this.options.ownerId) throw new SemanticMemoryUnavailableError('owner_mismatch');
    if (!Number.isSafeInteger(view.revision) || view.revision < 0) throw new SemanticMemoryUnavailableError('internal_error');
    // Freeze this operation's input against mutable record arrays while hashing/embedding.
    return { ...view, records: view.records.map((record) => ({ ...record })) };
  }

  async sync(signal?: AbortSignal): Promise<SemanticMemorySyncResult> {
    try {
      await this.guard(signal);
      const view = this.view();
      const active = view.records.filter((record) => record.ownerId === view.ownerId && record.status === 'active');
      const fingerprints = new Map(await Promise.all(active.map(async (record) =>
        [record.id, await semanticMemoryRecordFingerprint(record)] as const)));
      const signature = await semanticMemoryHash(JSON.stringify([...fingerprints].sort(([a], [b]) => a.localeCompare(b))));
      await this.guard(signal);
      // Advance the fence/remove obsolete vectors before starting costly cancellable work.
      const { token, entries } = await this.store.reconcile(view.revision, signature, fingerprints);
      const indexedIds = new Set(entries.map((entry) => entry.recordId));
      const missing = active.filter((record) => !indexedIds.has(record.id));
      const work = missing.slice(0, cap(this.options.maxRecordsPerSync, 100, 500));
      const batchSize = Math.max(1, cap(this.options.batchSize, 8, 32));
      let indexed = 0;
      for (let offset = 0; offset < work.length; offset += batchSize) {
        await this.guard(signal);
        const batch = work.slice(offset, offset + batchSize);
        const vectors = await this.options.embedder.embed(batch.map(semanticMemoryEmbeddedText), 'passage', signal);
        await this.guard(signal);
        if (vectors.length !== batch.length || vectors.some((vector) =>
          vector.length !== this.options.embedder.model.dimensions || !vector.every(Number.isFinite))) {
          throw new SemanticMemoryUnavailableError('internal_error');
        }
        const candidates = batch.map((record) => ({ ownerId: view.ownerId, recordId: record.id,
          sourceRevision: view.revision, contentFingerprint: fingerprints.get(record.id)!, score: 1 }));
        const current = this.view();
        if (current.revision < view.revision
          || (await revalidateSemanticMemoryCandidates(view.ownerId, candidates, current)).length !== batch.length) {
          throw new SemanticMemoryUnavailableError('internal_error', 'canonical records changed during sync');
        }
        const accepted = await this.store.write(token, batch.map((record, index) => ({
          ...candidates[index], schemaVersion: SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION,
          modelId: this.options.embedder.model.modelId, modelRevision: this.options.embedder.model.revision,
          vector: vectors[index], indexedAt: new Date().toISOString(), recordId: record.id,
        })));
        if (!accepted) throw new SemanticMemoryUnavailableError('internal_error', 'stale write rejected');
        indexed += batch.length;
      }
      return { status: 'ok', indexed, remaining: missing.length - indexed };
    } catch (error) { return { status: 'unavailable', reason: semanticMemoryStorageError(error).reason }; }
  }

  async recall(query: string, signal?: AbortSignal): Promise<SemanticMemoryRecallResult> {
    try {
      await this.guard(signal);
      this.view();
      const [queryVector] = await this.options.embedder.embed([query], 'query', signal);
      await this.guard(signal);
      if (!queryVector || queryVector.length !== this.options.embedder.model.dimensions
        || !queryVector.every(Number.isFinite)) throw new SemanticMemoryUnavailableError('internal_error');
      const { entries, revision } = await this.store.read();
      const current = this.view();
      if (current.revision < revision) throw new SemanticMemoryUnavailableError('internal_error', 'stale canonical view');
      const minimum = this.options.minScore === undefined ? DEFAULT_SEMANTIC_MEMORY_MIN_SCORE
        : Math.max(-1, Math.min(1, this.options.minScore));
      const scored = entries.filter((entry) => entry.ownerId === this.options.ownerId
        && entry.schemaVersion === SEMANTIC_MEMORY_INDEX_SCHEMA_VERSION
        && entry.modelId === this.options.embedder.model.modelId
        && entry.modelRevision === this.options.embedder.model.revision).map((entry) => ({
        ownerId: entry.ownerId, recordId: entry.recordId, sourceRevision: entry.sourceRevision,
        contentFingerprint: entry.contentFingerprint, score: cosine(queryVector, entry.vector),
      })).filter((candidate) => candidate.score >= minimum);
      const valid = await revalidateSemanticMemoryCandidates(this.options.ownerId, scored, current);
      await this.guard(signal);
      // Hashing is asynchronous; repeat against the latest snapshot if it changed meanwhile.
      const latest = this.view();
      if (latest.revision !== current.revision || JSON.stringify(latest.records) !== JSON.stringify(current.records)) {
        return { status: 'unavailable', reason: 'internal_error' };
      }
      const candidates = valid.sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId))
        .slice(0, cap(this.options.topK, 5, 20));
      return candidates.length ? { status: 'ok', candidates } : { status: 'no_match' };
    } catch (error) { return { status: 'unavailable', reason: semanticMemoryStorageError(error).reason }; }
  }

  dispose(): void { this.disposed = true; this.store.dispose(); }
}
