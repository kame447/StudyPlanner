/** Issue #305 Unit 2: dormant, consumer-owned candidate selection. No production imports. */
export type * from './contracts';
export { canonicalCandidateSerialization } from './canonical';
export { createCandidateManifest, candidateFreshnessFailure, projectCandidateProviderContext } from './manifest';
export { buildCandidateHierarchy, CANDIDATE_CHOICE_OPTION_LIMIT } from './hierarchy';
export { selectApplicationCandidate, createSelectionLedger, prepareCandidateSelectionCommit, commitStagedCandidateSelection } from './transaction';
export type { CandidateSelectionResult } from './transaction';
