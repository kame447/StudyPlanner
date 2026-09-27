import type { ProposalResponseCaseGroup } from './proposalResponseCorpus';

// Holdout groups are authored independently of the tuning split and sealed before
// any tuning provider call. Do not edit after the pre-tuning seal is recorded.
export const PROPOSAL_RESPONSE_HOLDOUT_GROUPS: readonly ProposalResponseCaseGroup[] = [];
