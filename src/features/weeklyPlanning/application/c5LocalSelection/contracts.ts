import type { ApplicationCandidate, CandidateBinding, CandidateChoiceRequest, CandidateTuple, CalibratedChoicePolicy, ConsumedSelection, StagedCandidateSelection } from '../candidateSelection/contracts';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../../types';
import type { WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningTurnExecutionResult } from '../../weeklyPlanningTurnExecutionTypes';

export interface C5QuestionSnapshot {
  readonly version: 1;
  readonly ownerId: string;
  readonly conversationId: string;
  readonly graphRevision: number;
  readonly selectionEpoch: number;
  readonly question: CandidateBinding['question'];
  readonly target: CandidateBinding['target'];
  readonly scope: CandidateTuple;
  readonly sources: CandidateBinding['sources'];
  readonly cohort: readonly string[];
  readonly candidates: readonly ApplicationCandidate[];
  /** Exact immutable question payload bytes, not an authorization or an answer-bound hash. */
  readonly payloadSerialization: string;
}

/** Sibling of lastQuestionContext: consumption survives question replacement. */
export interface C5SelectionLedger {
  readonly version: 1;
  readonly ownerId: string;
  readonly conversationId: string;
  readonly lastEpoch: number;
  readonly consumed: readonly ConsumedSelection[];
}

export interface C5SelectedTurn {
  readonly selection: StagedCandidateSelection;
  readonly graph: WeeklyPlanningFactGraphV5;
}

/** Explicit PoC injection only. No default provider, thresholds, or product activation. */
export interface C5LocalSelectionOptions {
  readonly policy: CalibratedChoicePolicy;
  readonly maximumChildrenPerMenu: number;
  readonly maximumDecisions: number;
  /** Same signature as createCandidateChoiceClient().choose. Must check immediately at exposure. */
  choose(request: CandidateChoiceRequest, beforeDispatch: () => void): Promise<unknown>;
  sourceAccess(): 'allowed' | 'denied' | 'unknown';
  /** Existing application continuation owns question progression, scheduler, preview and renderer. */
  continueSelectedTurn(params: {
    snapshot: PlanningState;
    pending: WeeklyPlanningPendingTurn;
    userText: string;
    graph: WeeklyPlanningFactGraphV5;
  }): Promise<WeeklyPlanningTurnExecutionResult>;
}

export interface C5ReducerCommit {
  readonly previousStateSerialization: string;
  readonly nextLedger: C5SelectionLedger;
}
