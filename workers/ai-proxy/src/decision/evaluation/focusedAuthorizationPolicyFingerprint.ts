import {
  AUTHORIZATION_QUESTIONS,
  FOCUSED_AUTHORIZATION_GATE_THRESHOLDS,
  JEV_CATALOG_VERSION,
  JEV_GATE_VERSION,
} from '../decisionPolicy';

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

export function focusedAuthorizationPolicyFingerprintPayloads() {
  return {
    catalog: {
      version: JEV_CATALOG_VERSION,
      questions: AUTHORIZATION_QUESTIONS,
    },
    gate: {
      version: JEV_GATE_VERSION,
      thresholds: FOCUSED_AUTHORIZATION_GATE_THRESHOLDS,
    },
  } as const;
}

export async function focusedAuthorizationPolicyFingerprints(): Promise<{
  catalogSha256: string;
  gateSha256: string;
}> {
  const payloads = focusedAuthorizationPolicyFingerprintPayloads();
  const [catalogSha256, gateSha256] = await Promise.all([
    sha256(payloads.catalog),
    sha256(payloads.gate),
  ]);
  return { catalogSha256, gateSha256 };
}
