import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_SIDE_CONTRIBUTION_CASES,
  validateTemporalSideContributionCorpus,
} from './temporalSideContributionCorpus';
import {
  TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL,
  assertTemporalSideContributionHoldoutSeal,
} from './temporalSideContributionHoldoutSeal';
import { temporalSideContributionPolicyFingerprints } from './temporalSideContributionPolicyFingerprint';

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

  it('matches the pre-tuning fingerprints before opening holdout', async () => {
    const actual = await temporalSideContributionPolicyFingerprints();
    expect(actual.catalogSha256).toBe(TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL.catalogSha256);
    expect(actual.gateSha256).toBe(TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL.gateSha256);
    expect(actual.corpusSha256).toBe(TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL.corpusSha256);
    await expect(assertTemporalSideContributionHoldoutSeal()).resolves.toBeUndefined();
  });
});
