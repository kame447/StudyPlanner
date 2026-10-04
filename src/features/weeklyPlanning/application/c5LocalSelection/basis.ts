import { canonicalCandidateSerialization, freezeCandidateValue } from '../candidateSelection/canonical';
import { snapshotCandidateBasis } from '../candidateSelection/manifest';
import type { ApplicationCandidate, CandidateBinding, CandidateTuple } from '../candidateSelection/contracts';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveGenericWorkItemEstimate } from '../../semantic/weeklyPlanningGenericWorkEstimation';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';
import { isUserUtteranceSourcedV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../../intake/weeklyPlanningStableV5QuestionSlot';
import { isWeeklyPlanningQuestionPresentationUnaccompanied } from '../../intake/weeklyPlanningQuestionPresentation';
import type { PlanningIntakeState } from '../../intake/weeklyPlanningIntakeTypes';
import type { C5QuestionSnapshot, C5SelectionLedger } from './contracts';
import type { WorkloadFact } from '../../semantic/weeklyPlanningFactGraph';

export { canonicalCandidateSerialization as serializeC5Value };
/** Application state uses optional undefined object fields; compare its existing JSON wire meaning. */
export function serializeC5ApplicationState(value: unknown): string {
  return canonicalCandidateSerialization(JSON.parse(JSON.stringify(value)));
}
export function c5PlanningWorkloads(graph: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>): WorkloadFact[] {
  return graph.workloads.filter((fact): fact is WorkloadFact => fact.quantityRole !== 'scope_total');
}

/** Uses the actual resolver, including its measurement precedence. No raw utterance interpretation. */
export function narrowC5EffortBasis(graph: WeeklyPlanningFactGraphV5, workloadId: string): {
  target: CandidateBinding['target']; scope: CandidateTuple;
  sources: CandidateBinding['sources']; cohort: string[]; candidates: ApplicationCandidate[];
} | null {
  if (!validateWeeklyPlanningFactGraphValueV5(graph).graph) return null;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const workload = active.workloads.find((fact) => fact.id === workloadId);
  if (!workload || (workload.quantityRole !== 'target' && workload.quantityRole !== 'remaining')) return null;
  const task = active.tasks.find((fact) => fact.id === workload.taskId);
  const component = workload.componentId ? active.components.find((fact) => fact.id === workload.componentId) : null;
  if (!task || (workload.componentId && !component)) return null;
  if ([task, workload, ...(component ? [component] : [])].some((fact) => !isUserUtteranceSourcedV5(fact.source))) return null;
  const resolution = resolveGenericWorkItemEstimate({ workload, workloads: c5PlanningWorkloads(active), estimates: active.effortEstimates });
  if (!resolution.ambiguous || resolution.sourceWorkloadFactIds.length || resolution.sourceFactIds.length < 2) return null;
  const cohort = resolution.sourceFactIds;
  const estimates = cohort.map((id) => active.effortEstimates.find((fact) => fact.id === id)!);
  if (estimates.some((fact) => !fact || fact.taskId !== workload.taskId || fact.targetFactId !== workload.id
    || fact.kind !== estimates[0].kind || fact.unitCode !== estimates[0].unitCode || !isUserUtteranceSourcedV5(fact.source))) return null;
  // Direct candidates cannot serve observed pace, and cannot bind another workload.
  const scope = {
    replacement: 'retain_selected_active_fact_supersede_fixed_cohort',
    reference: 'content_addressed_only',
    measurement: estimates[0].kind,
    unitCode: estimates[0].unitCode,
    taskId: task.id, taskLabel: task.title, taskCategory: task.category, taskCreatedRevision: task.createdRevision,
    componentId: workload.componentId, componentLabel: component?.label ?? null,
    componentRole: component?.role ?? null, componentParentId: component?.parentComponentId ?? null,
    componentCreatedRevision: component?.createdRevision ?? null,
    workload: {
      id: workload.id, quantityRole: workload.quantityRole, amount: workload.amount,
      unitCode: workload.unitCode, unitLabel: workload.unitLabel,
      rangeStart: workload.rangeStart, rangeEnd: workload.rangeEnd,
      perOccurrence: workload.perOccurrence, periodExpression: workload.periodExpression,
      createdRevision: workload.createdRevision,
    },
  } satisfies CandidateTuple;
  const candidates = estimates.map((fact) => ({
    id: fact.id,
    label: `${task.title}: ${fact.kind}, ${fact.minutes}, ${fact.unitCode ?? 'minute'}, ${fact.precision}`,
    tuple: {
      estimateId: fact.id, taskId: fact.taskId, targetFactId: fact.targetFactId,
      measurement: fact.kind, minutes: fact.minutes, unitCode: fact.unitCode,
      precision: fact.precision, createdRevision: fact.createdRevision, scope,
    },
  }));
  // Source text and access metadata stay internal; Unit 2 never projects binding.sources to a provider.
  const sources = [task, ...(component ? [component] : []), workload, ...estimates]
    .map((fact) => ({ id: fact.id, revision: canonicalCandidateSerialization({ source: fact.source, createdRevision: fact.createdRevision }) }));
  return { target: { kind: 'workload', id: workload.id }, scope, sources, cohort, candidates };
}

export function decodeC5Ledger(value: unknown, ownerId: string, conversationId: string): C5SelectionLedger | null {
  try {
    const v = freezeCandidateValue(value) as unknown as C5SelectionLedger;
    if (!v || Object.keys(v).sort().join() !== 'consumed,conversationId,lastEpoch,ownerId,version'
      || v.version !== 1 || v.ownerId !== ownerId || v.conversationId !== conversationId
      || !Number.isSafeInteger(v.lastEpoch) || v.lastEpoch < 0 || !Array.isArray(v.consumed)
      || v.consumed.some((e) => !e || Object.keys(e).sort().join() !== 'candidateId,candidateSetHash,requestKey,selectionKey'
        || Object.values(e).some((s) => typeof s !== 'string' || !s))
      || new Set(v.consumed.map((e) => e.selectionKey)).size !== v.consumed.length
      || new Set(v.consumed.map((e) => e.requestKey)).size !== v.consumed.length) return null;
    return v;
  } catch { return null; }
}

export function decodeC5Snapshot(value: unknown, ownerId: string, conversationId: string): C5QuestionSnapshot | null {
  try {
    const v = freezeCandidateValue(value) as unknown as C5QuestionSnapshot;
    if (!v || Object.keys(v).sort().join() !== 'candidates,cohort,conversationId,graphRevision,ownerId,payloadSerialization,question,scope,selectionEpoch,sources,target,version'
      || v.version !== 1 || v.ownerId !== ownerId || v.conversationId !== conversationId
      || !Number.isSafeInteger(v.selectionEpoch) || v.selectionEpoch < 1 || !Number.isSafeInteger(v.graphRevision) || v.graphRevision < 0
      || v.question?.code !== 'ambiguous_effort_estimate' || v.target?.kind !== 'workload'
      || !Array.isArray(v.cohort) || !Array.isArray(v.candidates) || v.candidates.length < 2
      || v.candidates.some((candidate, index) => candidate?.id !== v.cohort[index])
      || v.candidates.length !== v.cohort.length || new Set(v.cohort).size !== v.cohort.length) return null;
    const { payloadSerialization, ...payload } = v;
    snapshotCandidateBasis({ binding: { ownerId, conversationId, requestId: 'snapshot-validation',
      inputRevision: v.question.presentationRevision, graphRevision: v.graphRevision, selectionEpoch: v.selectionEpoch,
      question: v.question, target: v.target, scope: v.scope, sources: v.sources }, candidates: v.candidates });
    if (v.scope.reference !== 'content_addressed_only'
      || v.scope.replacement !== 'retain_selected_active_fact_supersede_fixed_cohort'
      || v.candidates.some((candidate) => candidate.tuple.estimateId !== candidate.id
        || candidate.tuple.targetFactId !== v.target.id
        || candidate.tuple.measurement !== v.scope.measurement || candidate.tuple.unitCode !== v.scope.unitCode
        || canonicalCandidateSerialization(candidate.tuple.scope) !== canonicalCandidateSerialization(v.scope))) return null;
    return canonicalCandidateSerialization(payload) === payloadSerialization ? v : null;
  } catch { return null; }
}

/** Called only at the presenting controller commit; a reload never enumerates a replacement payload. */
export function captureC5Question(params: {
  state: PlanningIntakeState; graph: WeeklyPlanningFactGraphV5; ownerId: string; conversationId: string;
}): PlanningIntakeState {
  const context = params.state.lastQuestionContext;
  const presentation = context?.presentation;
  if (params.state.questions.length !== 1 || !presentation || presentation.content.responseSource !== 'deterministic_fallback'
    || !isWeeklyPlanningQuestionPresentationUnaccompanied(presentation.content)
    || decodeWeeklyPlanningStableV5QuestionSlot(context?.targetSlot) !== 'ambiguous_effort_estimate'
    || !context?.actionId || !context.topicId || presentation.graphRevision !== params.graph.revision) return params.state;
  const basis = narrowC5EffortBasis(params.graph, context.topicId);
  if (!basis) return params.state;
  const old = params.state.c5SelectionLedger;
  const ledger = old === undefined ? { version: 1 as const, ownerId: params.ownerId, conversationId: params.conversationId, lastEpoch: 0, consumed: [] }
    : decodeC5Ledger(old, params.ownerId, params.conversationId);
  if (!ledger || !Number.isSafeInteger(ledger.lastEpoch + 1)) return params.state;
  const selectionEpoch = ledger.lastEpoch + 1;
  const payload = {
    version: 1 as const, ownerId: params.ownerId, conversationId: params.conversationId,
    graphRevision: params.graph.revision, selectionEpoch,
    question: { id: context.actionId, code: 'ambiguous_effort_estimate', presentingTurnId: presentation.turnId,
      presentingMessageId: presentation.assistantMessageId, presentationRevision: presentation.planningStateRevision },
    ...basis,
  };
  const snapshot = freezeCandidateValue({ ...payload, payloadSerialization: canonicalCandidateSerialization(payload) }) as unknown as C5QuestionSnapshot;
  return { ...params.state, c5SelectionLedger: { ...ledger, lastEpoch: selectionEpoch }, lastQuestionContext: { ...context, c5: snapshot } };
}

/** Old sessions have neither record and remain ineligible until a new presenting commit. */
export function validC5SessionRecords(state: PlanningIntakeState | undefined, ownerId: string, conversationId: string): boolean {
  if (!state) return true;
  if (state.c5SelectionLedger !== undefined && !decodeC5Ledger(state.c5SelectionLedger, ownerId, conversationId)) return false;
  const snapshot = state.lastQuestionContext?.c5;
  if (snapshot === undefined) return true;
  const decoded = decodeC5Snapshot(snapshot, ownerId, conversationId);
  const ledger = decodeC5Ledger(state.c5SelectionLedger, ownerId, conversationId);
  const context = state.lastQuestionContext;
  return Boolean(decoded && ledger && decoded.selectionEpoch === ledger.lastEpoch
    && context?.actionId === decoded.question.id && context.topicId === decoded.target.id
    && context.presentation?.graphRevision === decoded.graphRevision
    && context.presentation.turnId === decoded.question.presentingTurnId
    && context.presentation.assistantMessageId === decoded.question.presentingMessageId
    && context.presentation.planningStateRevision === decoded.question.presentationRevision);
}
