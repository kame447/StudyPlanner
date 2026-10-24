/** Diagnostic categories only; never authority to retry, mutate or consume a receipt. */
export const CONTROLLED_CANDIDATE_COMMIT_REJECTIONS = [
  'missing_graph', 'graph_mismatch', 'authorization_intent_changed', 'authorization_revision_changed',
  'prepare_rejected', 'next_ledger_rejected', 'runtime_finalize_rejected',
  'reducer_rollback', 'checkpoint_rollback', 'recovery_unknown',
] as const;
export type ControlledCandidateCommitRejection = typeof CONTROLLED_CANDIDATE_COMMIT_REJECTIONS[number];
