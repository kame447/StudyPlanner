import { proposalResponsePolicyFingerprints } from './proposalResponsePolicyFingerprint';

// Captured after the independent holdout was authored and before any tuning
// provider call. The corpus is immutable after this point.
export const PROPOSAL_RESPONSE_PRE_TUNING_SEAL = {
  catalogSha256: 'unsealed',
  gateSha256: 'unsealed',
  corpusSha256: 'unsealed',
} as const;

// Catalog/gate may change only through tuning evidence before the holdout opens;
// the corpus hash must stay identical. Holdout execution refuses any mismatch and
// is disabled after its single allowed run.
export const PROPOSAL_RESPONSE_HOLDOUT_SEAL = {
  ...PROPOSAL_RESPONSE_PRE_TUNING_SEAL,
  consumed: false,
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
