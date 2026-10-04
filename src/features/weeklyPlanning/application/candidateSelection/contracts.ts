/** Dormant application boundary. Tuples must already have passed the consumer's domain validator. */
export type CandidateValue = null | boolean | number | string | readonly CandidateValue[] | CandidateTuple;
export interface CandidateTuple { readonly [key: string]: CandidateValue }

export interface CandidateBinding {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly inputRevision: number;
  readonly graphRevision: number;
  readonly sources: readonly { readonly id: string; readonly revision: string }[];
  readonly target: { readonly kind: string; readonly id: string };
  readonly scope: CandidateTuple;
  readonly question: {
    readonly id: string;
    readonly code: string;
    readonly presentingTurnId: string;
    readonly presentingMessageId: string;
    readonly presentationRevision: number;
  };
  /** Application-owned generation; must advance even when the same question is re-presented. */
  readonly selectionEpoch: number;
}

export interface ApplicationCandidate<T extends CandidateTuple = CandidateTuple> {
  readonly id: string;
  readonly label: string;
  readonly tuple: T;
}

export interface CandidateBasis<T extends CandidateTuple = CandidateTuple> {
  readonly binding: CandidateBinding;
  /** Application order is significant: never sort the candidates by label or ID. */
  readonly candidates: readonly ApplicationCandidate<T>[];
}

export interface CandidateManifest<T extends CandidateTuple = CandidateTuple> extends CandidateBasis<T> {
  readonly version: 1;
  readonly canonicalSerialization: string;
  /** Integrity/correlation only. Neither permission nor current intent. */
  readonly candidateSetHash: string;
}

export interface CandidateObservation<T extends CandidateTuple = CandidateTuple> extends CandidateBasis<T> {
  readonly sourceAccess: 'allowed' | 'denied' | 'unknown';
  /** Validated application provenance only; never proof of the raw utterance's semantic sufficiency. */
  readonly intentProvenance: 'validated_current_turn' | 'unproven';
  readonly targetStatus: 'active' | 'inactive';
  readonly questionPresentation: 'fresh' | 'stale' | 'unknown';
  readonly formalEligibility: 'eligible' | 'ineligible';
}

export type SelectionFailure =
  | 'stale' | 'source_access' | 'current_intent' | 'target_inactive' | 'question_not_fresh'
  | 'formal_gate' | 'invalid_policy' | 'uncalibrated_menu' | 'invalid_response'
  | 'low_probability' | 'none' | 'extra_meaning' | 'budget_exhausted' | 'repeated_group'
  | 'provider_error' | 'observation_error' | 'invalid_selection' | 'already_consumed'
  | 'ledger_scope' | 'invalid_leaf';

/** Calibrated externally; no production threshold defaults or claim of empirical correctness. */
export interface CalibratedChoicePolicy {
  readonly id: string;
  readonly calibrationEvidenceId: string;
  readonly rules: readonly {
    readonly menuKind: 'leaves' | 'groups';
    readonly optionCount: number;
    readonly depth: number;
    readonly minimumTopProbability: number;
    readonly minimumMargin: number;
  }[];
}

export interface SelectionMenu<T extends CandidateTuple = CandidateTuple> {
  readonly nodeId: string;
  readonly depth: number;
  readonly kind: 'leaves' | 'groups';
  readonly options: readonly (
    | { readonly kind: 'none'; readonly id: 'none' }
    | { readonly kind: 'leaf'; readonly id: string; readonly candidate: ApplicationCandidate<T> }
    | { readonly kind: 'group'; readonly id: string; readonly candidates: readonly ApplicationCandidate<T>[] }
  )[];
}

export interface CandidateChoiceRequest<T extends CandidateTuple = CandidateTuple> {
  readonly wholeUtterance: string;
  readonly requestId: string;
  readonly selectionEpoch: number;
  readonly candidateSetHash: string;
  readonly context: CandidateProviderContext;
  readonly menu: SelectionMenu<T>;
}

/** Minimal binding projection, shared unchanged by flat/hierarchy/span arms. No owner/access metadata. */
export interface CandidateProviderContext {
  readonly question: { readonly id: string; readonly code: string };
  readonly target: CandidateBinding['target'];
  /** Consumer-owned semantic scope; consumers must review its provider/privacy eligibility. */
  readonly scope: CandidateTuple;
}

/** This is a staging result, never a scheduler/save/approval/lifecycle command. */
export interface StagedCandidateSelection<T extends CandidateTuple = CandidateTuple> {
  readonly manifest: CandidateManifest<T>;
  readonly candidate: ApplicationCandidate<T>;
}

export interface ConsumedSelection {
  readonly selectionKey: string;
  readonly requestKey: string;
  readonly candidateSetHash: string;
  readonly candidateId: string;
}

export interface SelectionLedger {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly consumed: readonly ConsumedSelection[];
}

export interface AtomicSelectionView<T extends CandidateTuple = CandidateTuple> {
  readonly observation: CandidateObservation<T>;
  readonly ledger: SelectionLedger;
  /** Re-run the existing formal/domain validator against the transaction's current state. */
  validateLeaf(candidate: ApplicationCandidate<T>): boolean;
}

export type SelectionCommitDecision<T extends CandidateTuple = CandidateTuple> =
  | { readonly status: 'rejected'; readonly reason: SelectionFailure }
  | { readonly status: 'prepared'; readonly candidate: ApplicationCandidate<T>; readonly nextLedger: SelectionLedger };

export type SelectionCommitOutcome =
  | { readonly status: 'committed' }
  | { readonly status: 'rejected'; readonly reason: SelectionFailure }
  /** Port positively knows it rolled back with no effect. */
  | { readonly status: 'failed' }
  /** Unhandled port exception may have happened AFTER commit. Recover ledger before any retry/fallback mutation. */
  | { readonly status: 'unknown' };

/**
 * Consumer obligation, not an implemented storage guarantee:
 * - obtain a current view inside the authoritative transaction/lock;
 * - call decide synchronously, then validate/apply the complete leaf and nextLedger atomically;
 * - on conflict retry with a NEW view; on rejection/error write neither;
 * - retain ledger with the state across retries/reload; never prune active epochs/requests;
 * - do not await between decide and a local state swap. Remote writes require real CAS/transaction.
 * Existing V5 local question freshness is not cross-device CAS.
 */
export interface AtomicSelectionCommitPort<T extends CandidateTuple = CandidateTuple> {
  commitAtomically(
    selection: StagedCandidateSelection<T>,
    decide: (view: AtomicSelectionView<T>) => SelectionCommitDecision<T>,
  ): Promise<SelectionCommitOutcome>;
}
