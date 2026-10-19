/** Explicit D5/date producer port. Consumers remain inert without domain registration and calibration. */
import type { CandidateBasis, CandidateBinding, ApplicationCandidate, CandidateTuple, StagedCandidateSelection, CandidateChoiceRequest, CandidateObservation, CalibratedChoicePolicy } from './candidateSelection/contracts';
import type { C5SelectionLedger, C5ReducerCommit } from './c5LocalSelection/contracts';
import type { PlanningState, WeeklyPlanningPendingTurn, WeeklyPlanningMessage } from '../types';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import type { prepareLocalCandidateReducerCommit } from './c5LocalSelection/selection';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerV5';
import type { WeeklyPlanningStableV5DialogueGroundingFact } from '../dialogue/weeklyPlanningStableV5DialogueContracts';

export type ControlledCandidateDomainId = 'd5_numeric' | 'availability_date';
export interface ControlledCandidateQuestionSnapshot {
  readonly version: 1;
  readonly domainId: ControlledCandidateDomainId;
  readonly domainPolicyVersion: string;
  // Captured at the presenting commit. Answer requestId/inputRevision are supplied later.
  readonly basis: CandidateBasis;
  // Only validated typed domain data; no process-local capability or provider credentials.
  readonly domainData: CandidateTuple;
  readonly payloadSerialization: string;
}
export interface ControlledCandidateSemanticContribution {
  readonly document: WeeklyPlanningSemanticDocumentV5;
  // Exact existing formal validator/binder/finalizer result, never graph-diff inference.
  readonly canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
}
export interface ControlledCandidateCaptureContext {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly graph: WeeklyPlanningFactGraphV5;
  readonly state: PlanningState;
  readonly messages: readonly WeeklyPlanningMessage[];
  readonly question: CandidateBinding['question']; // contains exact bound local message record
  readonly selectionEpoch: number;
  readonly domainPolicyVersion: string;
  readonly requestContext: WeeklyPlanningTurnRequestContext; // actual presenting turn authority
}
export interface ControlledCandidateStageContext {
  readonly snapshot: PlanningState;
  readonly pending: WeeklyPlanningPendingTurn;
  readonly frozen: ControlledCandidateQuestionSnapshot;
  readonly basis: CandidateBasis; // answer request binding; frozen question/cohort remain unchanged
  readonly userText: string;
  // Frozen pre-finalization graph + canonical public summary + original whole text/channels.
  readonly normalizerInput: WeeklyPlanningSemanticNormalizerInputV5;
  readonly policy: CalibratedChoicePolicy;
  readonly maximumChildrenPerMenu: number;
  readonly maximumDecisions: number;
  readRequestContext(): WeeklyPlanningTurnRequestContext;
  // Shared owner supplies actual begin-turn/presentation/source lease gates. Domain rederives
  // scope/sources/candidates against its live graph, preserving these independent gates.
  observeCurrentBasis(basis: CandidateBasis): CandidateObservation;
  prepareLocalCandidateReducerCommit: typeof prepareLocalCandidateReducerCommit;
  readCurrentState(): PlanningState;
  readCommittedGraph(): WeeklyPlanningFactGraphV5;
  readLedger(): C5SelectionLedger | null;
  sourceAccess(): 'allowed' | 'denied' | 'unknown';
  // The shared authenticated Choice client supplies this; policy belongs to this domain.
  choose: (request: CandidateChoiceRequest, beforeDispatch: () => void) => Promise<unknown>;
}
export interface ControlledCandidateAdapter {
  readonly selected: { readonly selection: StagedCandidateSelection; readonly graph: WeeklyPlanningFactGraphV5 };
  readonly branch: 'd5_pending_selection' | 'temporal_date_selection';
  readonly semanticContribution: ControlledCandidateSemanticContribution;
  // Calls the existing opaque receipt factory after live domain revalidation.
  prepare(): C5ReducerCommit | null;
}
export interface ControlledCandidateDomain {
  readonly domainId: ControlledCandidateDomainId;
  readonly questionCode: 'missing_effort_estimate' | 'missing_availability_date_scope';
  readonly domainPolicyVersion: string;
  /** Question time only, before capture. The registry supplies the facts the presenting request
   * accepted (what its acknowledgement may echo); true leaves the question to the ordinary route. */
  rejectsCoPresentedFacts(params: { readonly targetId: string; readonly facts: readonly WeeklyPlanningStableV5DialogueGroundingFact[] }): boolean;
  capture(context: ControlledCandidateCaptureContext): {
    readonly target: CandidateBinding['target'];
    readonly scope: CandidateTuple;
    readonly sources: CandidateBinding['sources'];
    readonly candidates: readonly ApplicationCandidate[];
    readonly domainData: CandidateTuple;
  } | null;
  stage(context: ControlledCandidateStageContext): Promise<ControlledCandidateAdapter | null>;
}
