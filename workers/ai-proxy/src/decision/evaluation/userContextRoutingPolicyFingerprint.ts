import {
  USER_CONTEXT_ROUTING_CATALOG_VERSION,
  USER_CONTEXT_ROUTING_DECISION_CATALOG,
  USER_CONTEXT_ROUTING_GATE_THRESHOLDS,
  USER_CONTEXT_ROUTING_GATE_VERSION,
} from '../userContextRoutingPolicy';
import {
  USER_CONTEXT_ROUTING_CORPUS,
  USER_CONTEXT_ROUTING_CORPUS_VERSION,
} from './userContextRoutingCorpus';

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

export function userContextRoutingPolicyFingerprintPayloads() {
  return {
    catalog: {
      version: USER_CONTEXT_ROUTING_CATALOG_VERSION,
      questions: USER_CONTEXT_ROUTING_DECISION_CATALOG,
    },
    gate: {
      version: USER_CONTEXT_ROUTING_GATE_VERSION,
      thresholds: USER_CONTEXT_ROUTING_GATE_THRESHOLDS,
    },
    corpus: {
      version: USER_CONTEXT_ROUTING_CORPUS_VERSION,
      candidates: USER_CONTEXT_ROUTING_CORPUS,
    },
  } as const;
}

export async function userContextRoutingPolicyFingerprints(): Promise<{
  catalogSha256: string;
  gateSha256: string;
  corpusSha256: string;
}> {
  const payloads = userContextRoutingPolicyFingerprintPayloads();
  const [catalogSha256, gateSha256, corpusSha256] = await Promise.all([
    sha256(payloads.catalog),
    sha256(payloads.gate),
    sha256(payloads.corpus),
  ]);
  return { catalogSha256, gateSha256, corpusSha256 };
}
