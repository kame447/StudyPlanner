import { proposalResponsePolicyFingerprints } from './proposalResponsePolicyFingerprint';

// Captured after the independent holdout was authored and before any tuning
// provider call. The corpus is immutable after this point.
export const PROPOSAL_RESPONSE_PRE_TUNING_SEAL = {
  catalogSha256: '18178fee99ce475b4e2a784001818d10ae44a90d7b77201376608fc4b99eba86',
  gateSha256: '73700b0641e2042b05be73c185d92b6d8a7e81c1f7740b8452fad7245c5a2f70',
  corpusSha256: '659ce70ab6a0dd8f3e885cf258ce8c8a1a20adaee0f90a11f6faa151966465a6',
} as const;

// Catalog/gate may change only through tuning evidence before the holdout opens;
// the corpus hash must stay identical. Holdout execution refuses any mismatch and
// is disabled after its single allowed run.
export const PROPOSAL_RESPONSE_HOLDOUT_SEAL = {
  ...PROPOSAL_RESPONSE_PRE_TUNING_SEAL,
  gateSha256: 'a5bd99046b9e08326e697f47d7ce78525f2209b48735e26aebc3c55d90e43077',
  consumed: true,
} as const;

export async function assertProposalResponseCorpusSealed(): Promise<void> {
  const actual = await proposalResponsePolicyFingerprints();
  if (actual.corpusSha256 !== PROPOSAL_RESPONSE_PRE_TUNING_SEAL.corpusSha256) {
    throw new Error('Proposal-response corpus is not sealed or has changed since the seal.');
  }
}

export async function assertProposalResponseHoldoutSeal(): Promise<void> {
  if (PROPOSAL_RESPONSE_HOLDOUT_SEAL.consumed) {
    throw new Error('Proposal-response holdout has already been consumed.');
  }
  const actual = await proposalResponsePolicyFingerprints();
  for (const key of ['catalogSha256', 'gateSha256', 'corpusSha256'] as const) {
    if (actual[key] !== PROPOSAL_RESPONSE_HOLDOUT_SEAL[key]) {
      throw new Error(`Proposal-response holdout seal mismatch: ${key}.`);
    }
  }
}
