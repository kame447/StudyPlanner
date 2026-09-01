import {
  LEARNING_CONSULTATION_FINGERPRINT_VERSION,
  type ContextFingerprint,
  type ContextFingerprintInput,
  type ContextSourceEnvelope,
} from './contracts';

export interface ContextEnvelopeValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export function validateContextSourceEnvelope(
  envelope: ContextSourceEnvelope,
): ContextEnvelopeValidationResult {
  const errors: string[] = [];

  if (envelope.sourceDomain.trim().length === 0) errors.push('sourceDomain is required');
  if (envelope.sourceIdentity.trim().length === 0) errors.push('sourceIdentity is required');
  if (envelope.authority.trim().length === 0) errors.push('authority is required');
  if (envelope.observedAt.trim().length === 0) errors.push('observedAt is required');

  if (envelope.status === 'empty' && envelope.items.length !== 0) {
    errors.push('empty source must not contain items');
  }
  if ((envelope.status === 'unavailable' || envelope.status === 'omitted') && envelope.items.length !== 0) {
    errors.push(`${envelope.status} source must not expose items as current data`);
  }
  if (envelope.status === 'available' && envelope.items.length === 0) {
    errors.push('successful zero-item read must use empty status');
  }
  if ((envelope.status === 'available' || envelope.status === 'empty' || envelope.status === 'stale')
      && (!envelope.semanticDigest || envelope.semanticDigest.trim().length === 0)) {
    errors.push(`${envelope.status} source requires a semanticDigest`);
  }

  return { valid: errors.length === 0, errors };
}

export interface ContextReadiness {
  ready: boolean;
  blockedSources: readonly string[];
}

export function assessRequiredContextReadiness(
  sources: readonly ContextSourceEnvelope[],
): ContextReadiness {
  const blockedSources = sources
    .filter((source) => source.requirement === 'required')
    .filter((source) => source.status !== 'available' && source.status !== 'empty')
    .map((source) => source.sourceIdentity)
    .sort();

  return {
    ready: blockedSources.length === 0,
    blockedSources,
  };
}

function stableRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableRecord);
  if (typeof value !== 'object' || value === null) return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableRecord(record[key])]),
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(stableRecord(value));
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildContextFingerprint(input: ContextFingerprintInput): ContextFingerprint {
  const canonicalSources = [...input.sources]
    .map((source) => ({
      sourceDomain: source.sourceDomain,
      sourceIdentity: source.sourceIdentity,
      requirement: source.requirement,
      status: source.status,
      sourceBasis: source.sourceBasis,
      semanticDigest: source.semanticDigest,
      authority: source.authority,
    }))
    .sort((left, right) => left.sourceIdentity.localeCompare(right.sourceIdentity));

  const canonicalSignals = [...input.deterministicSignals]
    .map((signal) => ({
      signalId: signal.signalId,
      kind: signal.kind,
      value: signal.value,
      unit: signal.unit,
      basisRefs: [...signal.basisRefs].sort(),
      calculationVersion: signal.calculationVersion,
    }))
    .sort((left, right) => left.signalId.localeCompare(right.signalId));

  const payload = {
    requestTemporalContext: input.requestTemporalContext,
    sources: canonicalSources,
    deterministicSignals: canonicalSignals,
    evidenceDigests: [...input.evidenceDigests].sort(),
    materialBindingBasis: [...input.materialBindingBasis].sort(),
  };

  return {
    version: LEARNING_CONSULTATION_FINGERPRINT_VERSION,
    digest: fnv1a32(stableSerialize(payload)),
  };
}

export function sameContextFingerprint(
  left: ContextFingerprint,
  right: ContextFingerprint,
): boolean {
  return left.version === right.version && left.digest === right.digest;
}
