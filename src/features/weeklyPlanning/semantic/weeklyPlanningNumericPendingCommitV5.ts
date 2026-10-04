import { canonicalCandidateSerialization, prepareCandidateSelectionCommit, type AtomicSelectionView, type StagedCandidateSelection, type SelectionLedger, type SelectionCommitOutcome, type SelectionFailure } from '../application/candidateSelection';
import { numericPendingBoundToInputV5, numericPendingObservationV5, type NumericPendingStateV5, type StagedNumericPendingChoiceV5 } from './weeklyPlanningNumericPendingChoiceV5';
import { readWeeklyPlanningPendingQuestionV5 } from './weeklyPlanningPendingQuestionV5';
import { applyWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createFocusedContextualAnswerDocumentV5 } from './weeklyPlanningFocusedContextualAnswerV5';

export interface NumericPendingAtomicViewV5 {
  readonly input: WeeklyPlanningSemanticNormalizerInputV5;
  readonly state: NumericPendingStateV5;
  readonly domainMinutes: readonly number[];
  readonly domainPolicyVersion: string;
  readonly ledger: SelectionLedger;
  readonly turnId: string;
}
export type NumericPendingCommitPlanV5 = { readonly status: 'rejected'; readonly reason: SelectionFailure }
  | { readonly status: 'prepared'; readonly graph: WeeklyPlanningFactGraphV5; readonly nextLedger: SelectionLedger };
export interface NumericPendingControlledCommitPortV5 {
  /** D's controlled consumer must re-read, decide, finalize graph, reducer and checkpoint receipt together.
   * No await after decide; unknown retains recovery and blocks both retry and fallback mutation.
   * This structural port is NOT an implemented production storage/controller guarantee. */
  commitAtomically(staged: StagedNumericPendingChoiceV5, decide: (view: NumericPendingAtomicViewV5) => NumericPendingCommitPlanV5): Promise<SelectionCommitOutcome>;
}
/** Synchronous adapter for D's future generic controlled commit callback; no inferred evidence from a plain document. */
export function prepareNumericPendingCommitV5(staged: StagedNumericPendingChoiceV5, view: NumericPendingAtomicViewV5): NumericPendingCommitPlanV5 {
  const reject = (reason: SelectionFailure): NumericPendingCommitPlanV5 => ({ status: 'rejected', reason });
  try {
    if (!numericPendingBoundToInputV5(view.input, view.state) || view.input.userText !== staged.wholeUtterance) return reject('stale');
    const leaf = staged.selection.candidate.tuple;
    const expectedDocument = createFocusedContextualAnswerDocumentV5({ input: view.input, decision: { decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: leaf.measurement, minutes: leaf.minutes, precision: leaf.precision, quantityRole: null } });
    if (!expectedDocument || canonicalCandidateSerialization(expectedDocument) !== canonicalCandidateSerialization(staged.document)) return reject('invalid_leaf');
    const efforts = staged.document.tasks.flatMap(t => t.effortEstimates);
    if (efforts.length !== 1 || efforts[0].targetLocalId !== leaf.targetId || efforts[0].kind !== leaf.measurement
      || efforts[0].minutes !== leaf.minutes || efforts[0].precision !== leaf.precision || efforts[0].unitCode !== leaf.perUnit) return reject('invalid_leaf');
    const decision = prepareCandidateSelectionCommit(staged.selection, { observation: numericPendingObservationV5(view.state, view.domainMinutes, view.domainPolicyVersion), ledger: view.ledger,
      validateLeaf: candidate => canonicalCandidateSerialization(candidate) === canonicalCandidateSerialization(staged.selection.candidate) });
    if (decision.status !== 'prepared') return decision;
    const graph = view.input.committedGraph!;
    const applied = applyWeeklyPlanningStableV5ContextualAnswer({ graph, document: staged.document,
      pendingQuestion: readWeeklyPlanningPendingQuestionV5(view.input.publicStateSummary)!, conversationId: view.state.binding.conversationId,
      turnId: view.turnId, expectedRevision: graph.revision, userText: view.input.userText });
    if (applied?.status !== 'applied') return reject('formal_gate');
    const added = applied.graph.effortEstimates.filter(e => !graph.effortEstimates.some(old => old.id === e.id));
    if (added.length !== 1 || added[0].targetFactId !== leaf.targetId || added[0].kind !== leaf.measurement
      || added[0].minutes !== leaf.minutes || added[0].precision !== leaf.precision || added[0].unitCode !== leaf.perUnit) return reject('invalid_leaf');
    return { status: 'prepared', graph: applied.graph, nextLedger: decision.nextLedger };
  } catch { return reject('observation_error'); }
}
export async function commitNumericPendingChoiceV5(staged: StagedNumericPendingChoiceV5, port: NumericPendingControlledCommitPortV5): Promise<SelectionCommitOutcome> {
  try { return await port.commitAtomically(staged, view => prepareNumericPendingCommitV5(staged, view)); }
  catch { return { status: 'unknown' }; }
}

/** Structural equivalents of D's C5SelectionLedger and opaque reducer receipt factory.
 * The receipt must be issued by D; this module never fabricates or serializes its capability. */
export interface NumericPendingReducerLedgerV5 extends SelectionLedger {
  readonly version: 1;
  readonly lastEpoch: number;
}
export interface NumericPendingReducerBridgeV5<State, Receipt> {
  /** Live pending/application observation against the immutable pre-finalization input graph.
   * Runtime graph is read independently below, including after D finalizes it.
   * current is D's actual PlanningState, with this same ledger in intakeState.c5SelectionLedger. */
  readCurrent(): NumericPendingAtomicViewV5 & { readonly current: State; readonly ledger: NumericPendingReducerLedgerV5 };
  readRuntimeGraph(): WeeklyPlanningFactGraphV5;
  prepareLocalCandidateReducerCommit(input: {
    selection: StagedCandidateSelection; current: State; ledger: NumericPendingReducerLedgerV5;
    view: AtomicSelectionView; revalidateFinalized(): boolean;
  }): Receipt | null;
}
/** API-shaped handoff to commitControlledCandidateTurn({...context, ...adapter}).
 * D's actual controller/reducer/checkpoint remain required; this dormant bridge proves no durability. */
export function createNumericPendingControlledAdapterV5<State, Receipt>(staged: StagedNumericPendingChoiceV5, port: NumericPendingReducerBridgeV5<State, Receipt>): {
  readonly selected: { readonly selection: StagedCandidateSelection; readonly graph: WeeklyPlanningFactGraphV5 };
  readonly branch: 'd5_pending_selection';
  prepare(): Receipt | null;
} | null {
  try {
    const matchingStateLedger = (view: ReturnType<typeof port.readCurrent>) => canonicalCandidateSerialization(
      (view.current as { intakeState?: { c5SelectionLedger?: unknown } }).intakeState?.c5SelectionLedger,
    ) === canonicalCandidateSerialization(view.ledger);
    const initial = port.readCurrent();
    if (!matchingStateLedger(initial)) return null;
    const projectLedger = (ledger: SelectionLedger): SelectionLedger => ({ ownerId: ledger.ownerId, conversationId: ledger.conversationId, consumed: ledger.consumed });
    const plan = prepareNumericPendingCommitV5(staged, { ...initial, ledger: projectLedger(initial.ledger) });
    if (plan.status !== 'prepared' || canonicalCandidateSerialization(port.readRuntimeGraph()) !== canonicalCandidateSerialization(initial.input.committedGraph)) return null;
    const graph = plan.graph;
    return {
      selected: { selection: staged.selection, graph }, branch: 'd5_pending_selection',
      prepare() {
        try {
          const live = port.readCurrent();
          if (!matchingStateLedger(live)) return null;
          const fresh = prepareNumericPendingCommitV5(staged, { ...live, ledger: projectLedger(live.ledger) });
          if (fresh.status !== 'prepared' || live.ledger.lastEpoch !== staged.selection.manifest.binding.selectionEpoch
            || canonicalCandidateSerialization(fresh.graph) !== canonicalCandidateSerialization(graph)
            || canonicalCandidateSerialization(port.readRuntimeGraph()) !== canonicalCandidateSerialization(live.input.committedGraph)) return null;
          const observation = numericPendingObservationV5(live.state, live.domainMinutes, live.domainPolicyVersion);
          const ledger = projectLedger(live.ledger);
          const evidence = canonicalCandidateSerialization({ input: live.input, observation, ledger: live.ledger, turnId: live.turnId });
          return port.prepareLocalCandidateReducerCommit({ selection: staged.selection, current: live.current, ledger: live.ledger,
            view: { observation, ledger, validateLeaf: candidate => canonicalCandidateSerialization(candidate) === canonicalCandidateSerialization(staged.selection.candidate) },
            revalidateFinalized() {
              try {
                const current = port.readCurrent();
                return matchingStateLedger(current) && canonicalCandidateSerialization({ input: current.input,
                  observation: numericPendingObservationV5(current.state, current.domainMinutes, current.domainPolicyVersion), ledger: current.ledger, turnId: current.turnId }) === evidence
                  && canonicalCandidateSerialization(port.readRuntimeGraph()) === canonicalCandidateSerialization(graph);
              } catch { return false; }
            },
          });
        } catch { return null; }
      },
    };
  } catch { return null; }
}
