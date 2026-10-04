import { canonicalCandidateSerialization, freezeCandidateValue } from './canonical';
import type { CandidateBasis, CandidateManifest, CandidateObservation, CandidateProviderContext, CandidateTuple, SelectionFailure } from './contracts';

const manifests = new WeakSet<object>();
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));

export function snapshotCandidateBasis<T extends CandidateTuple>(basis: CandidateBasis<T>): CandidateBasis<T> {
  const snapshot = freezeCandidateValue(basis) as unknown as CandidateBasis<T>;
  const { binding, candidates } = snapshot;
  if (!record(snapshot) || !keys(snapshot, ['binding', 'candidates'])
    || !record(binding) || !keys(binding, ['ownerId', 'conversationId', 'requestId', 'inputRevision', 'graphRevision', 'sources', 'target', 'scope', 'question', 'selectionEpoch'])
    || ![binding.ownerId, binding.conversationId, binding.requestId].every(nonempty)
    || ![binding.inputRevision, binding.graphRevision, binding.selectionEpoch].every(revision)
    || !record(binding.target) || !keys(binding.target, ['kind', 'id'])
    || !nonempty(binding.target.id) || !nonempty(binding.target.kind) || !record(binding.scope)
    || !record(binding.question) || !keys(binding.question, ['id', 'code', 'presentingTurnId', 'presentingMessageId', 'presentationRevision'])
    || ![binding.question.id, binding.question.code, binding.question.presentingTurnId, binding.question.presentingMessageId].every(nonempty)
    || !revision(binding.question.presentationRevision)
    || !Array.isArray(binding.sources) || binding.sources.some((source) => !record(source) || !keys(source, ['id', 'revision']) || !nonempty(source.id) || !nonempty(source.revision))
    || new Set(binding.sources.map((source) => source.id)).size !== binding.sources.length
    || !Array.isArray(candidates) || candidates.length === 0
    || candidates.some((candidate) => !record(candidate) || !keys(candidate, ['id', 'label', 'tuple']) || !nonempty(candidate.id) || !nonempty(candidate.label) || !record(candidate.tuple))
    || new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error('Invalid application candidate basis.');
  }
  return snapshot;
}

export function serializeCandidateBasis<T extends CandidateTuple>(basis: CandidateBasis<T>): string {
  return canonicalCandidateSerialization({ version: 1, ...snapshotCandidateBasis(basis) });
}

export async function createCandidateManifest<T extends CandidateTuple>(basis: CandidateBasis<T>): Promise<CandidateManifest<T>> {
  // Snapshot BEFORE await: caller-owned references cannot change what is hashed or returned.
  const snapshot = snapshotCandidateBasis(basis);
  const canonicalSerialization = serializeCandidateBasis(snapshot);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSerialization));
  const candidateSetHash = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  const manifest: CandidateManifest<T> = Object.freeze({ version: 1, ...snapshot, canonicalSerialization, candidateSetHash });
  manifests.add(manifest);
  return manifest;
}

export function isCreatedCandidateManifest(value: object): boolean { return manifests.has(value); }

export function projectCandidateProviderContext<T extends CandidateTuple>(manifest: CandidateManifest<T>): CandidateProviderContext {
  if (!isCreatedCandidateManifest(manifest)) throw new Error('Invalid manifest.');
  return Object.freeze({
    question: Object.freeze({ id: manifest.binding.question.id, code: manifest.binding.question.code }),
    target: manifest.binding.target,
    scope: manifest.binding.scope,
  });
}

/** Exact basis plus independent formal gates; hash equality is deliberately insufficient. */
export function candidateFreshnessFailure<T extends CandidateTuple>(
  manifest: CandidateManifest<T>, current: CandidateObservation<T>,
): SelectionFailure | null {
  if (!isCreatedCandidateManifest(manifest)) return 'invalid_selection';
  if (current.sourceAccess !== 'allowed') return 'source_access';
  if (current.intentProvenance !== 'validated_current_turn') return 'current_intent';
  if (current.targetStatus !== 'active') return 'target_inactive';
  if (current.questionPresentation !== 'fresh') return 'question_not_fresh';
  if (current.formalEligibility !== 'eligible') return 'formal_gate';
  try {
    return serializeCandidateBasis({ binding: current.binding, candidates: current.candidates }) === manifest.canonicalSerialization ? null : 'stale';
  } catch {
    return 'stale';
  }
}
