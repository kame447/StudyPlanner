import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_RESPONSE_CASES,
  PROPOSAL_RESPONSE_STRATA,
  validateProposalResponseCorpus,
} from './proposalResponseCorpus';
import {
  PROPOSAL_RESPONSE_HOLDOUT_SEAL,
  PROPOSAL_RESPONSE_PRE_TUNING_SEAL,
} from './proposalResponseHoldoutSeal';
import { proposalResponsePolicyFingerprints } from './proposalResponsePolicyFingerprint';

describe('proposal-response evaluation corpus', () => {
  it('passes the structural split, stratum and contract checks', () => {
    expect(() => validateProposalResponseCorpus()).not.toThrow();
  });

  it('labels only pure rejections as reject_only in both splits', () => {
    for (const item of PROPOSAL_RESPONSE_CASES) {
      expect(item.expected).toBe(item.stratum === 'pure_reject' ? 'reject_only' : 'other');
      expect(item.labelSource).toBe('synthetic_unreviewed');
    }
    for (const split of ['tuning', 'holdout'] as const) {
      const strata = new Set(PROPOSAL_RESPONSE_CASES
        .filter((item) => item.split === split)
        .map((item) => item.stratum));
      expect([...strata].sort()).toEqual([...PROPOSAL_RESPONSE_STRATA].sort());
    }
  });

  it('keeps the corpus identical to its pre-tuning seal', async () => {
    const actual = await proposalResponsePolicyFingerprints();
    expect(actual.corpusSha256).toBe(PROPOSAL_RESPONSE_PRE_TUNING_SEAL.corpusSha256);
    expect(PROPOSAL_RESPONSE_HOLDOUT_SEAL.corpusSha256)
      .toBe(PROPOSAL_RESPONSE_PRE_TUNING_SEAL.corpusSha256);
  });
});
