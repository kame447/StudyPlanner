import { createCandidateManifest } from '../candidateSelection/manifest';
import { selectApplicationCandidate, prepareCandidateSelectionCommit } from '../candidateSelection/transaction';
import type { AtomicSelectionView, CandidateBasis, CandidateObservation, StagedCandidateSelection } from '../candidateSelection/contracts';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../../intake/weeklyPlanningQuestionPresentation';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from '../../semantic/weeklyPlanningFactLifecycleEngineV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveGenericWorkItemEstimate } from '../../semantic/weeklyPlanningGenericWorkEstimation';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';
import type { WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningPendingTurn } from '../../types';
import { c5PlanningWorkloads, decodeC5Ledger, decodeC5Snapshot, narrowC5EffortBasis, serializeC5Value, serializeC5ApplicationState } from './basis';
import type { C5LocalSelectionOptions, C5ReducerCommit, C5SelectedTurn, C5SelectionLedger } from './contracts';
import type { WorkloadFact } from '../../semantic/weeklyPlanningFactGraph';

interface TurnBasis {
  ownerId: string; snapshot: PlanningState; pending: WeeklyPlanningPendingTurn; userText: string;
  options: C5LocalSelectionOptions; getState(): PlanningState; getGraph(): WeeklyPlanningFactGraphV5;
}
const reducerCommits = new WeakSet<object>();
const commitGuards = new WeakMap<object, () => boolean>();

function answerBasis(input: TurnBasis): CandidateBasis | null {
  const frozen = decodeC5Snapshot(input.snapshot.intakeState?.lastQuestionContext?.c5, input.ownerId, input.pending.conversationId);
  const ledger = decodeC5Ledger(input.snapshot.intakeState?.c5SelectionLedger, input.ownerId, input.pending.conversationId);
  if (!frozen || !ledger || ledger.lastEpoch !== frozen.selectionEpoch) return null;
  const selectionKey = serializeC5Value([input.ownerId, input.pending.conversationId, frozen.question.id, frozen.selectionEpoch]);
  if (ledger.consumed.some((entry) => entry.selectionKey === selectionKey)) return null;
  return {
    binding: {
      ownerId: input.ownerId, conversationId: input.pending.conversationId, requestId: input.pending.requestId,
      inputRevision: input.pending.baseRevision, graphRevision: frozen.graphRevision,
      sources: frozen.sources, target: frozen.target, scope: frozen.scope, question: frozen.question,
      selectionEpoch: frozen.selectionEpoch,
    },
    candidates: frozen.candidates,
  };
}

/** Frozen turn-start #348 binding + exactly the expected begin_turn transition. */
function observe(input: TurnBasis, expected: CandidateBasis): CandidateObservation {
  const current = input.getState();
  const graph = input.getGraph();
  const original = input.snapshot.intakeState;
  const p = current.pendingTurn;
  const beginMatches = current.revision === input.pending.baseRevision + 1
    && current.weekStartDate === input.pending.weekStartDate
    && p?.requestId === input.pending.requestId && p.turnId === input.pending.turnId
    && p.conversationId === input.pending.conversationId && p.baseRevision === input.pending.baseRevision
    && current.messages.length === input.snapshot.messages.length + 1
    && serializeC5Value(current.messages.slice(0, -1)) === serializeC5Value(input.snapshot.messages)
    && current.messages[current.messages.length - 1]?.id === `${input.pending.turnId}:user`
    && current.messages[current.messages.length - 1]?.content === input.userText
    && serializeC5ApplicationState(current.intakeState ?? null) === serializeC5ApplicationState(original ?? null);
  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: original, inputStateRevision: input.pending.baseRevision,
    messages: input.snapshot.messages, graphRevision: graph.revision,
  });
  const live = narrowC5EffortBasis(graph, expected.binding.target.id);
  const frozen = decodeC5Snapshot(original?.lastQuestionContext?.c5, input.ownerId, input.pending.conversationId);
  const matchingQuestion = freshness.status === 'fresh' && frozen
    && freshness.questionContext.actionId === frozen.question.id
    && freshness.questionContext.topicId === frozen.target.id
    && freshness.presentation.turnId === frozen.question.presentingTurnId
    && freshness.presentation.assistantMessageId === frozen.question.presentingMessageId
    && freshness.presentation.planningStateRevision === frozen.question.presentationRevision;
  return {
    binding: live ? { ...expected.binding, graphRevision: graph.revision, sources: live.sources, target: live.target, scope: live.scope } : expected.binding,
    candidates: live?.candidates ?? [],
    sourceAccess: input.options.sourceAccess(),
    intentProvenance: 'validated_current_turn',
    targetStatus: live ? 'active' : 'inactive',
    questionPresentation: beginMatches && matchingQuestion ? 'fresh' : 'stale',
    formalEligibility: beginMatches && live ? 'eligible' : 'ineligible',
  };
}

/** Pure local lifecycle plan; all writes happen later in the synchronous controller commit. */
export function planC5LocalReplacement(graph: WeeklyPlanningFactGraphV5, selection: StagedCandidateSelection): WeeklyPlanningFactGraphV5 | null {
  const live = narrowC5EffortBasis(graph, selection.manifest.binding.target.id);
  if (!live || graph.revision !== selection.manifest.binding.graphRevision
    || serializeC5Value(live.candidates) !== serializeC5Value(selection.manifest.candidates)
    || serializeC5Value(live.scope) !== serializeC5Value(selection.manifest.binding.scope)
    || serializeC5Value(live.sources) !== serializeC5Value(selection.manifest.binding.sources)
    || !live.cohort.includes(selection.candidate.id)) return null;
  let next = graph;
  for (const targetFactId of live.cohort) {
    if (targetFactId === selection.candidate.id) continue;
    const result = applyWeeklyPlanningFactLifecycleOperationV5({
      graph: next, expectedRevision: next.revision,
      operation: { kind: 'supersede', targetFactId, replacementFactId: selection.candidate.id,
        operationKey: serializeC5Value(['c5', selection.manifest.binding.requestId, selection.manifest.candidateSetHash, targetFactId]) },
    });
    if (result.status !== 'applied') return null;
    next = result.graph;
  }
  const before = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const after = createWeeklyPlanningActiveSchedulerGraphViewV5(next);
  const resolutions = (view: typeof before, workload: WorkloadFact) =>
    resolveGenericWorkItemEstimate({ workload, workloads: c5PlanningWorkloads(view), estimates: view.effortEstimates });
  if (c5PlanningWorkloads(before).some((workload) => workload.id !== live.target.id
    && serializeC5Value(resolutions(before, workload)) !== serializeC5Value(resolutions(after, workload)))) return null;
  const selectedWorkload = c5PlanningWorkloads(after).find((workload) => workload.id === live.target.id)!;
  const resolved = resolutions(after, selectedWorkload);
  if (resolved.ambiguous || resolved.estimatedMinutes === null || resolved.sourceFactIds.length !== 1
    || resolved.sourceFactIds[0] !== selection.candidate.id) return null;
  const turnKey = `${selection.manifest.binding.conversationId}:${selection.manifest.binding.requestId}`;
  if (graph.appliedTurnKeys.includes(turnKey)) return null;
  next = { ...next, appliedTurnKeys: [...next.appliedTurnKeys, turnKey] };
  return validateWeeklyPlanningFactGraphValueV5(next).graph ? next : null;
}

export async function selectC5Turn(input: TurnBasis): Promise<C5SelectedTurn | null> {
  const basis = answerBasis(input);
  if (!basis) return null;
  try {
    const manifest = await createCandidateManifest(basis);
    const result = await selectApplicationCandidate({
      manifest, wholeUtterance: input.userText, policy: input.options.policy,
      maximumChildrenPerMenu: input.options.maximumChildrenPerMenu, maximumDecisions: input.options.maximumDecisions,
      readCurrent: () => observe(input, basis), choose: (request, beforeDispatch) => input.options.choose(request, beforeDispatch),
    });
    if (result.status !== 'staged') return null;
    const graph = planC5LocalReplacement(input.getGraph(), result.selection);
    return graph ? { selection: result.selection, graph } : null;
  } catch { return null; }
}

/** No await from this re-read through runtime finalization and reducer dispatch. */
export function prepareC5TurnCommit(input: TurnBasis, selected: C5SelectedTurn): C5ReducerCommit | null {
  const ledger = decodeC5Ledger(input.getState().intakeState?.c5SelectionLedger, input.ownerId, input.pending.conversationId);
  const basis = answerBasis(input);
  if (!ledger || !basis) return null;
  const nextGraph = planC5LocalReplacement(input.getGraph(), selected.selection);
  if (!nextGraph || serializeC5Value(nextGraph) !== serializeC5Value(selected.graph)) return null;
  return prepareLocalCandidateReducerCommit({ selection: selected.selection, current: input.getState(), ledger,
    view: {
      observation: observe(input, basis),
      ledger: { ownerId: ledger.ownerId, conversationId: ledger.conversationId, consumed: ledger.consumed },
      validateLeaf: (candidate) => candidate.id === selected.selection.candidate.id,
    }, revalidateFinalized: () => input.options.sourceAccess() === 'allowed'
      && serializeC5Value(input.getGraph()) === serializeC5Value(selected.graph) });
}

/** Shared consumer boundary. The Unit 2 staged capability and full fresh view remain mandatory. */
export function prepareLocalCandidateReducerCommit(input: {
  selection: StagedCandidateSelection; current: PlanningState; ledger: C5SelectionLedger;
  view: AtomicSelectionView; revalidateFinalized(): boolean;
}): C5ReducerCommit | null {
  const { selection, current, view } = input;
  const ledger = decodeC5Ledger(input.ledger, selection.manifest.binding.ownerId, selection.manifest.binding.conversationId);
  if (!ledger || ledger.lastEpoch !== selection.manifest.binding.selectionEpoch
    || serializeC5Value(current.intakeState?.c5SelectionLedger ?? null) !== serializeC5Value(ledger)
    || serializeC5Value(view.ledger) !== serializeC5Value({ ownerId: ledger.ownerId,
      conversationId: ledger.conversationId, consumed: ledger.consumed })) return null;
  const decision = prepareCandidateSelectionCommit(selection, view);
  if (decision.status !== 'prepared') return null;
  const commit = Object.freeze({
    previousStateSerialization: serializeC5ApplicationState(current),
    nextLedger: Object.freeze({ ...ledger, consumed: decision.nextLedger.consumed }),
  });
  reducerCommits.add(commit);
  commitGuards.set(commit, input.revalidateFinalized);
  return commit;
}

export function validateC5ReducerCommit(commit: C5ReducerCommit, current: PlanningState, next: PlanningState['intakeState']): boolean {
  try {
    const valid = reducerCommits.has(commit) && commitGuards.get(commit)?.() === true
    && serializeC5ApplicationState(current) === commit.previousStateSerialization
    && serializeC5Value(next?.c5SelectionLedger ?? null) === serializeC5Value(commit.nextLedger);
    // An opaque reducer capability is single-use, including commit-then-throw recovery.
    if (valid) reducerCommits.delete(commit);
    return valid;
  } catch { return false; }
}

/** Controller-created next presentation may advance the epoch while retaining this exact receipt. */
export function bindC5CommitNextLedger(commit: C5ReducerCommit, nextLedger: C5ReducerCommit['nextLedger']): C5ReducerCommit | null {
  const decoded = decodeC5Ledger(nextLedger, commit.nextLedger.ownerId, commit.nextLedger.conversationId);
  if (!reducerCommits.has(commit) || !decoded
    || (decoded.lastEpoch !== commit.nextLedger.lastEpoch && decoded.lastEpoch !== commit.nextLedger.lastEpoch + 1)
    || serializeC5Value(decoded.consumed) !== serializeC5Value(commit.nextLedger.consumed)) return null;
  const next = Object.freeze({ ...commit, nextLedger: decoded });
  reducerCommits.add(next);
  commitGuards.set(next, commitGuards.get(commit)!);
  return next;
}
