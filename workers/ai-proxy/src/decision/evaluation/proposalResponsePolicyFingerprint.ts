import {
  PROPOSAL_RESPONSE_CATALOG_VERSION,
  PROPOSAL_RESPONSE_DECISION_CATALOG,
  PROPOSAL_RESPONSE_GATE_THRESHOLDS,
  PROPOSAL_RESPONSE_GATE_VERSION,
} from '../proposalResponseDecisionPolicy';
import {
  PROPOSAL_RESPONSE_CASES,
  PROPOSAL_RESPONSE_CORPUS_VERSION,
} from './proposalResponseCorpus';

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
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function proposalResponsePolicyFingerprintPayloads() {
  return {
    catalog: {
      version: PROPOSAL_RESPONSE_CATALOG_VERSION,
      questions: PROPOSAL_RESPONSE_DECISION_CATALOG.questions,
      decisions: PROPOSAL_RESPONSE_DECISION_CATALOG.decisions,
    },
    gate: {
      version: PROPOSAL_RESPONSE_GATE_VERSION,
      thresholds: PROPOSAL_RESPONSE_GATE_THRESHOLDS,
    },
    corpus: {
      version: PROPOSAL_RESPONSE_CORPUS_VERSION,
      cases: PROPOSAL_RESPONSE_CASES,
    },
  } as const;
}

export async function proposalResponsePolicyFingerprints(): Promise<{
  catalogSha256: string;
  gateSha256: string;
  corpusSha256: string;
}> {
  const payloads = proposalResponsePolicyFingerprintPayloads();
  const [catalogSha256, gateSha256, corpusSha256] = await Promise.all([
    sha256(payloads.catalog),
    sha256(payloads.gate),
    sha256(payloads.corpus),
  ]);
  return { catalogSha256, gateSha256, corpusSha256 };
}
