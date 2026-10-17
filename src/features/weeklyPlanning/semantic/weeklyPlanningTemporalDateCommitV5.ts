import { canonicalCandidateSerialization, prepareCandidateSelectionCommit,
  type AtomicSelectionView, type SelectionLedger, type SelectionFailure, type StagedCandidateSelection,
} from '../application/candidateSelection';
import { createTemporalDateBasisV5, temporalDateObservationV5, type TemporalDateViewV5, type StagedTemporalDateChoiceV5 } from './weeklyPlanningTemporalDateChoiceV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';

export interface TemporalDateAtomicViewV5 extends TemporalDateViewV5 {
  readonly ledger: SelectionLedger;
  readonly turnId: string;
}
export interface TemporalDateSemanticContributionV5 {
  readonly document: WeeklyPlanningSemanticDocumentV5;
  readonly canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5;
}
export type TemporalDateCommitPlanV5 = { readonly status: 'rejected'; readonly reason: SelectionFailure }
  | { readonly status: 'prepared'; readonly graph: WeeklyPlanningFactGraphV5; readonly nextLedger: SelectionLedger; readonly semanticContribution: TemporalDateSemanticContributionV5 };

/** Select only the already bound date. Every other value is copied from the current exact source. */
function dateReplacementDocument(view: TemporalDateAtomicViewV5, dateExpression: string): WeeklyPlanningSemanticDocumentV5 {
  const before = view.input.committedGraph!.availabilityDeclarations.find(fact => fact.id === view.binding.target.id)!;
  const sourceText = view.input.userText;
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [], relations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], decisions: [],
    availabilityDeclarations: [{ localId: 'temporal-date-replacement', kind: before.kind,
      dateExpression, namedTimePeriod: before.namedTimePeriod, startTime: before.startTime, endTime: before.endTime,
      recurrenceKind: before.recurrenceKind, days: [...before.days], constraintLevel: before.constraintLevel,
      ...(before.capacityMinutes === undefined ? {} : { capacityMinutes: before.capacityMinutes }), sourceText }],
    corrections: [{ localId: 'temporal-date-correction', target: { kind: 'availability_declaration', publicId: before.id, localId: null, mention: sourceText },
      operation: 'replace', replacementLocalId: 'temporal-date-replacement', sourceText }],
  };
}

/** Synchronous formal proof for J2's authoritative atomic commit; not a mutation or durable receipt. */
export function prepareTemporalDateCommitV5(staged: StagedTemporalDateChoiceV5, view: TemporalDateAtomicViewV5): TemporalDateCommitPlanV5 {
  const reject = (reason: SelectionFailure): TemporalDateCommitPlanV5 => ({ status: 'rejected', reason });
  try {
    if (view.input.userText !== staged.wholeUtterance) return reject('stale');
    const basis = createTemporalDateBasisV5(view); const observation = temporalDateObservationV5(view);
    if (!basis || !observation) return reject('stale');
    const selected = basis.candidates.find(candidate => candidate.id === staged.selection.candidate.id);
    if (!selected || canonicalCandidateSerialization(selected) !== canonicalCandidateSerialization(staged.selection.candidate)) return reject('invalid_leaf');
    const decision = prepareCandidateSelectionCommit(staged.selection, { observation, ledger: view.ledger,
      validateLeaf: candidate => canonicalCandidateSerialization(candidate) === canonicalCandidateSerialization(selected) });
    if (decision.status !== 'prepared') return decision;
    const originalGraph = view.input.committedGraph!;
    const document = dateReplacementDocument(view, selected.tuple.dateExpression);
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
      currentUserText: view.input.userText, committedGraph: originalGraph,
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, originalGraph),
    });
    if (!validation.document) return reject('formal_gate');
    const context = { conversationId: view.binding.conversationId, turnId: view.turnId, expectedRevision: originalGraph.revision };
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: originalGraph, document: validation.document, context });
    const finalized = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph, document: validation.document, baseCanonicalization: base,
      contextualAnswer: false, questionCode: 'missing_availability_date_scope', operationKeyPrefix: `${context.conversationId}:${context.turnId}:temporal-date` }).canonicalization;
    if (finalized.status !== 'applied') return reject('formal_gate');
    const graph = finalized.graph;
    const replacement = graph.availabilityDeclarations.filter(fact => !originalGraph.availabilityDeclarations.some(old => old.id === fact.id));
    if (replacement.length !== 1 || isWeeklyPlanningFactActiveV5(graph, view.binding.target.id)
      || !isWeeklyPlanningFactActiveV5(graph, replacement[0].id) || replacement[0].dateExpression !== selected.tuple.dateExpression) return reject('invalid_leaf');
    const before = originalGraph.availabilityDeclarations.find(fact => fact.id === view.binding.target.id)!;
    const fields = (fact: typeof before) => ({ kind: fact.kind, constraintLevel: fact.constraintLevel, namedTimePeriod: fact.namedTimePeriod,
      startTime: fact.startTime, endTime: fact.endTime, recurrenceKind: fact.recurrenceKind, days: fact.days, capacityMinutes: fact.capacityMinutes ?? null });
    if (canonicalCandidateSerialization(fields(before)) !== canonicalCandidateSerialization(fields(replacement[0]))) return reject('invalid_leaf');
    const oldAvailability = graph.availabilityDeclarations.filter(fact => originalGraph.availabilityDeclarations.some(old => old.id === fact.id));
    if (canonicalCandidateSerialization(oldAvailability) !== canonicalCandidateSerialization(originalGraph.availabilityDeclarations)) return reject('invalid_leaf');
    const unchanged = ['tasks','components','studyContexts','workloads','effortEstimates','temporalConstraints','recurrences','planningWindows','relations','constraintSourceRequests','taskDateRules','decisionIntents','uncertainties'] as const;
    if (unchanged.some(key => canonicalCandidateSerialization(graph[key]) !== canonicalCandidateSerialization(originalGraph[key]))) return reject('invalid_leaf');
    return { status: 'prepared', graph, nextLedger: decision.nextLedger, semanticContribution: { document: validation.document, canonicalization: finalized } };
  } catch { return reject('observation_error'); }
}

/** Structural handoff only. J2 owns live state, opaque reducer capability, ledger/graph durability and recovery. */
export interface TemporalDateReducerBridgeV5<State, Receipt> {
  /** Live pending/permission/ledger against immutable pre-finalization input; runtime graph is read independently. */
  readCurrent(): TemporalDateAtomicViewV5 & { readonly current: State; readonly ledger: SelectionLedger & { readonly version: 1; readonly lastEpoch: number } };
  readRuntimeGraph(): WeeklyPlanningFactGraphV5;
  prepareLocalCandidateReducerCommit(input: {
    selection: StagedCandidateSelection; current: State; ledger: ReturnType<TemporalDateReducerBridgeV5<State, Receipt>['readCurrent']>['ledger'];
    view: AtomicSelectionView; revalidateFinalized(): boolean;
  }): Receipt | null;
}
export function createTemporalDateControlledAdapterV5<State, Receipt>(staged: StagedTemporalDateChoiceV5, port: TemporalDateReducerBridgeV5<State, Receipt>) {
  try {
    const live = port.readCurrent();
    const matchingStateLedger = (value: typeof live) => canonicalCandidateSerialization((value.current as { intakeState?: { c5SelectionLedger?: unknown } }).intakeState?.c5SelectionLedger) === canonicalCandidateSerialization(value.ledger);
    if (!matchingStateLedger(live)) return null;
    const project = (view: typeof live) => ({ ...view, ledger: { ownerId: view.ledger.ownerId, conversationId: view.ledger.conversationId, consumed: view.ledger.consumed } });
    const plan = prepareTemporalDateCommitV5(staged, project(live));
    if (plan.status !== 'prepared' || canonicalCandidateSerialization(port.readRuntimeGraph()) !== canonicalCandidateSerialization(live.input.committedGraph)) return null;
    const graph = plan.graph;
    return {
      selected: { selection: staged.selection, graph }, semanticContribution: plan.semanticContribution, branch: 'temporal_date_selection' as const,
      prepare(): Receipt | null {
        try {
          const current = port.readCurrent();
          if (!matchingStateLedger(current)) return null;
          const fresh = prepareTemporalDateCommitV5(staged, project(current));
          if (fresh.status !== 'prepared' || current.ledger.lastEpoch !== staged.selection.manifest.binding.selectionEpoch
            || canonicalCandidateSerialization(fresh.graph) !== canonicalCandidateSerialization(graph)
            || canonicalCandidateSerialization(port.readRuntimeGraph()) !== canonicalCandidateSerialization(current.input.committedGraph)) return null;
          const observation = temporalDateObservationV5(current)!;
          const evidence = canonicalCandidateSerialization({ input: current.input, observation, ledger: current.ledger, turnId: current.turnId });
          return port.prepareLocalCandidateReducerCommit({ selection: staged.selection, current: current.current, ledger: current.ledger,
            view: { observation, ledger: project(current).ledger,
              validateLeaf: candidate => canonicalCandidateSerialization(candidate) === canonicalCandidateSerialization(staged.selection.candidate) },
            revalidateFinalized() {
              try {
                const next = port.readCurrent();
                return matchingStateLedger(next) && canonicalCandidateSerialization({ input: next.input, observation: temporalDateObservationV5(next), ledger: next.ledger, turnId: next.turnId }) === evidence
                  && canonicalCandidateSerialization(port.readRuntimeGraph()) === canonicalCandidateSerialization(graph);
              } catch { return false; }
            },
          });
        } catch { return null; }
      },
    };
  } catch { return null; }
}
