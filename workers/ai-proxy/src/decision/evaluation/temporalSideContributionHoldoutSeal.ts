import { temporalSideContributionPolicyFingerprints } from './temporalSideContributionPolicyFingerprint';

// Recorded immediately after corpus/catalog/gate creation, before provider
// tuning. The holdout is never used to select or change these values.
export const TEMPORAL_SIDE_CONTRIBUTION_PRE_TUNING_SEAL = {
  catalogSha256: '54ae5141b3d8db74100609f9807f3a2a7bb1707d8145cba19f9a5e0e94f825ad',
  gateSha256: 'c670beca70dec50ddcaa0abfedb4a6a6f538612f3b500cf98722d52cb5e6d6c3',
  corpusSha256: 'f981c40cbb63f0c78fd7f08e4144978b70ffefbf52e6e573d6b34ff465fef434',
} as const;

export const TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL = {
  ...TEMPORAL_SIDE_CONTRIBUTION_PRE_TUNING_SEAL,
  consumed: false,
} as const;

export async function assertTemporalSideContributionHoldoutSeal(): Promise<void> {
  if (TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL.consumed) {
    throw new Error('Temporal-side holdout has already been consumed.');
  }
  const actual = await temporalSideContributionPolicyFingerprints();
  for (const key of ['catalogSha256', 'gateSha256', 'corpusSha256'] as const) {
    if (actual[key] !== TEMPORAL_SIDE_CONTRIBUTION_HOLDOUT_SEAL[key]) {
      throw new Error(`Temporal-side holdout seal mismatch: ${key}.`);
    }
  }
}
