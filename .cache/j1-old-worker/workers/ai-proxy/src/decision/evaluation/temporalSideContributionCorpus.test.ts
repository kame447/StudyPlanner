import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_SIDE_CONTRIBUTION_CASES,
  TEMPORAL_SIDE_CONTRIBUTION_CORPUS_VERSION,
  validateTemporalSideContributionCorpus,
} from './temporalSideContributionCorpus';
import {
  TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL,
} from './temporalSideContributionHoldoutSeal';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

describe('temporal-side evaluation seal', () => {
  it('separates groups and has 16 cases / 8 groups per class per split', () => {
    expect(() => validateTemporalSideContributionCorpus()).not.toThrow();
    for (const split of ['tuning', 'holdout'] as const) {
      for (const caseClass of ['temporal', 'no_temporal', 'security'] as const) {
        const cases = TEMPORAL_SIDE_CONTRIBUTION_CASES.filter((item) =>
          item.split === split && item.caseClass === caseClass);
        expect(cases).toHaveLength(16);
        expect(new Set(cases.map((item) => item.group)).size).toBe(8);
      }
    }
  });

  it('keeps the sealed corpus unchanged and marks the holdout consumed', async () => {
    const payload = {
      version: TEMPORAL_SIDE_CONTRIBUTION_CORPUS_VERSION,
      cases: TEMPORAL_SIDE_CONTRIBUTION_CASES,
    };
    const digest = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(canonicalJson(payload)),
    );
    const corpusSha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(corpusSha256).toBe(TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL.corpusSha256);
    expect(TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL.consumed).toBe(true);
  });
});
