import {
  TEMPORAL_SIDE_CONTRIBUTION_CATALOG_VERSION,
  TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG,
  TEMPORAL_SIDE_CONTRIBUTION_GATE_THRESHOLDS,
  TEMPORAL_SIDE_CONTRIBUTION_GATE_VERSION,
} from '../temporalSideContributionDecisionPolicy';
import {
  TEMPORAL_SIDE_CONTRIBUTION_CASES,
  TEMPORAL_SIDE_CONTRIBUTION_CORPUS_VERSION,
} from './temporalSideContributionCorpus';

type CanonicalJson = null | boolean | number | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as { readonly [key: string]: CanonicalJson };
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key] as CanonicalJson)}`
  )).join(',')}}`;
}

async function sha256(value: CanonicalJson): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function temporalSideContributionPolicyFingerprintPayloads() {
  return {
    catalog: {
      version: TEMPORAL_SIDE_CONTRIBUTION_CATALOG_VERSION,
      questions: TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG.questions,
      decisions: TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG.decisions,
    },
    gate: {
      version: TEMPORAL_SIDE_CONTRIBUTION_GATE_VERSION,
      thresholds: TEMPORAL_SIDE_CONTRIBUTION_GATE_THRESHOLDS,
    },
    corpus: {
      version: TEMPORAL_SIDE_CONTRIBUTION_CORPUS_VERSION,
      cases: TEMPORAL_SIDE_CONTRIBUTION_CASES,
    },
  } as const;
}

export async function temporalSideContributionPolicyFingerprints(): Promise<{
  catalogSha256: string;
  gateSha256: string;
  corpusSha256: string;
}> {
  const payloads = temporalSideContributionPolicyFingerprintPayloads();
  const [catalogSha256, gateSha256, corpusSha256] = await Promise.all([
    sha256(payloads.catalog), sha256(payloads.gate), sha256(payloads.corpus),
  ]);
  return { catalogSha256, gateSha256, corpusSha256 };
}
