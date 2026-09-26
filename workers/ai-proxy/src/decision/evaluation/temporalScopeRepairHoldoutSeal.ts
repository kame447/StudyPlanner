import { temporalScopeRepairPolicyFingerprints } from './temporalScopeRepairPolicyFingerprint';

// Captured before any tuning provider call. Corpus is immutable after this point.
export const TEMPORAL_SCOPE_REPAIR_PRE_TUNING_SEAL = {
  catalogSha256: 'bbd97044191d49150bba37d41bb08039b61fb846c789e329cf27fb2da3bef942',
  gateSha256: '662177b3339cabd4196ca2db2d82396573827f5e1777e1f1535ecc6c36d405c4',
  corpusSha256: '31ad21270a9ad5495fca624621d39af0deea10585e0b8c5bce63ce908759cbf7',
} as const;

// Update catalog/gate only when tuning evidence changes the frozen acceptance
// policy. The corpus hash must remain identical. Holdout execution refuses any
// mismatch and is separately disabled after its single allowed run.
export const TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL = {
  ...TEMPORAL_SCOPE_REPAIR_PRE_TUNING_SEAL,
  consumed: false,
} as const;

export async function assertTemporalScopeRepairHoldoutSeal(): Promise<void> {
  if (TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL.consumed) {
    throw new Error('Temporal-scope repair holdout has already been consumed.');
  }
  const actual = await temporalScopeRepairPolicyFingerprints();
  for (const key of ['catalogSha256', 'gateSha256', 'corpusSha256'] as const) {
    if (actual[key] !== TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL[key]) {
      throw new Error(`Temporal-scope repair holdout seal mismatch: ${key}.`);
    }
  }
}
