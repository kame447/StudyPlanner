import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL,
  TEMPORAL_SCOPE_REPAIR_PRE_TUNING_SEAL,
  assertTemporalScopeRepairHoldoutSeal,
} from './temporalScopeRepairHoldoutSeal';
import { temporalScopeRepairPolicyFingerprints } from './temporalScopeRepairPolicyFingerprint';

describe('temporal-scope repair holdout seal', () => {
  it('matches the frozen catalog, gate, and pre-tuning corpus', async () => {
    expect(await temporalScopeRepairPolicyFingerprints()).toEqual({
      catalogSha256: TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL.catalogSha256,
      gateSha256: TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL.gateSha256,
      corpusSha256: TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL.corpusSha256,
    });
    expect(TEMPORAL_SCOPE_REPAIR_HOLDOUT_SEAL.corpusSha256)
      .toBe(TEMPORAL_SCOPE_REPAIR_PRE_TUNING_SEAL.corpusSha256);
    await expect(assertTemporalScopeRepairHoldoutSeal()).resolves.toBeUndefined();
  });
});
