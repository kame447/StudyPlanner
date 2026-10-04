import {
  canonicalCandidateSerialization, createCandidateManifest, selectApplicationCandidate,
  type ApplicationCandidate, type CalibratedChoicePolicy, type CandidateBinding, type CandidateChoiceRequest,
  type CandidateObservation, type CandidateTuple, type StagedCandidateSelection,
} from '../application/candidateSelection';
import { createFocusedContextualAnswerDocumentV5, focusedContextualTargetV5 } from './weeklyPlanningFocusedContextualAnswerV5';
import { readWeeklyPlanningPendingQuestionV5 } from './weeklyPlanningPendingQuestionV5';
import type { WeeklyPlanningSemanticNormalizerInputV5, WeeklyPlanningSemanticNormalizerDiagnosticsV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { semanticNormalizerByteLength, type WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';

export interface NumericPendingTupleV5 extends CandidateTuple {
  readonly targetId: string;
  readonly measurement: 'total_duration' | 'duration_per_unit';
  readonly minutes: number;
  readonly precision: 'exact';
  readonly valueUnit: 'minute';
  readonly perUnit: string | null;
  readonly scope: CandidateTuple;
}
/** Explicit application observation, derived live from machine state, never from user text. */
export interface NumericPendingStateV5 {
  readonly binding: CandidateBinding;
  readonly pendingTargetCount: number;
  readonly measurement: NumericPendingTupleV5['measurement'];
  readonly perUnit: string | null;
  readonly sourceAccess: CandidateObservation['sourceAccess'];
  readonly intentProvenance: CandidateObservation['intentProvenance'];
  readonly targetStatus: CandidateObservation['targetStatus'];
  readonly questionPresentation: CandidateObservation['questionPresentation'];
  readonly formalEligibility: CandidateObservation['formalEligibility'];
}
export interface NumericPendingChoicePortV5 {
  /** Fixed before seeing raw text; no buckets and no candidate extraction from user language. */
  readonly domainMinutes: readonly number[];
  readonly domainPolicyVersion: string;
  readonly choicePolicy: CalibratedChoicePolicy;
  readonly maximumChildrenPerMenu: number;
  readonly maximumDecisions: number;
  readCurrent(input: WeeklyPlanningSemanticNormalizerInputV5): NumericPendingStateV5 | null;
  choose(request: CandidateChoiceRequest<NumericPendingTupleV5>, beforeDispatch: () => void): Promise<unknown>;
}
export function numericPendingCandidatesV5(state: NumericPendingStateV5, domain: readonly number[]): readonly ApplicationCandidate<NumericPendingTupleV5>[] {
  if (!domain.length || domain.length > 254 || new Set(domain).size !== domain.length
    || domain.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('Invalid finite numeric domain.');
  return domain.map((minutes, index) => ({
    id: `numeric:${index}`, label: `${minutes} minute; ${state.measurement}; exact; ${state.perUnit ?? 'total'}`,
    tuple: { targetId: state.binding.target.id, measurement: state.measurement, minutes, precision: 'exact', valueUnit: 'minute', perUnit: state.perUnit, scope: state.binding.scope },
  }));
}
export function numericPendingObservationV5(state: NumericPendingStateV5, domain: readonly number[], domainPolicyVersion: string): CandidateObservation<NumericPendingTupleV5> {
  if (!domainPolicyVersion?.trim() || state.binding.sources.some(s => s.id === 'numeric-domain-policy')) throw new Error('Invalid numeric domain policy binding.');
  const binding = { ...state.binding, sources: [...state.binding.sources, { id: 'numeric-domain-policy', revision: canonicalCandidateSerialization({ domainPolicyVersion, domain }) }] };
  return { binding, candidates: numericPendingCandidatesV5(state, domain), sourceAccess: state.sourceAccess,
    intentProvenance: state.intentProvenance, targetStatus: state.targetStatus, questionPresentation: state.questionPresentation, formalEligibility: state.formalEligibility };
}
/** Neither validates raw-language purity nor grants mutation permission. */
export function numericPendingBoundToInputV5(input: WeeklyPlanningSemanticNormalizerInputV5, state: NumericPendingStateV5): boolean {
  const pending = readWeeklyPlanningPendingQuestionV5(input.publicStateSummary);
  const target = focusedContextualTargetV5(input);
  const graph = input.committedGraph;
  if (!pending || !target || !graph || state.pendingTargetCount !== 1 || state.binding.target.kind !== 'workload'
    || pending.questionCode !== 'missing_effort_estimate' || state.binding.question.code !== pending.questionCode
    || pending.actionId !== state.binding.question.id || pending.targetFactId !== state.binding.target.id
    || pending.estimateForWorkloadFactId != null || pending.questionBasis != null
    || state.measurement !== pending.effortMeasurement || !['total_duration', 'duration_per_unit'].includes(state.measurement)
    || state.binding.graphRevision !== pending.graphRevision || graph.revision !== pending.graphRevision
    || state.binding.requestId !== input.traceRequestId || input.supplementalContext?.trim()
    || target.perOccurrence || target.periodExpression !== null || target.unitCode === 'custom') return false;
  const workload = graph.workloads.find(w => w.id === pending.targetFactId);
  if (!workload || !graph.factLifecycles.some(f => f.factId === workload.id && f.status === 'active')
    || workload.taskId !== target.taskPublicId || workload.componentId !== (target.component?.publicId ?? null)) return false;
  if (state.perUnit !== (state.measurement === 'duration_per_unit' ? target.unitCode : null)) return false;
  // Full workload scope is fixed by machine state, not merely an opaque hash or a label.
  const scope = { taskId: workload.taskId, componentId: workload.componentId, amount: workload.amount, unitCode: workload.unitCode,
    quantityRole: workload.quantityRole, rangeStart: workload.rangeStart, rangeEnd: workload.rangeEnd, perOccurrence: workload.perOccurrence, periodExpression: workload.periodExpression };
  return canonicalCandidateSerialization(state.binding.scope) === canonicalCandidateSerialization(scope)
    && canonicalCandidateSerialization(scope) === canonicalCandidateSerialization({ taskId: target.taskPublicId, componentId: target.component?.publicId ?? null,
      amount: target.amount, unitCode: target.unitCode, quantityRole: target.quantityRole, rangeStart: target.rangeStart, rangeEnd: target.rangeEnd, perOccurrence: target.perOccurrence, periodExpression: target.periodExpression });
}

export interface StagedNumericPendingChoiceV5 {
  readonly status: 'staged';
  readonly wholeUtterance: string;
  readonly selection: StagedCandidateSelection<NumericPendingTupleV5>;
  readonly document: WeeklyPlanningSemanticDocumentV5;
  readonly diagnostics: WeeklyPlanningSemanticNormalizerDiagnosticsV5;
}
/** Dormant PoC. Evidence is retained; only a future authoritative atomic consumer may apply it. */
export async function tryNumericPendingChoiceRouteV5(run: WeeklyPlanningSemanticNormalizerRunV5, port: NumericPendingChoicePortV5): Promise<StagedNumericPendingChoiceV5 | null> {
  const input = run.input;
  const wholeUtterance = input.userText;
  const domain = Object.freeze([...port.domainMinutes]);
  let initial: NumericPendingStateV5 | null;
  try { initial = port.readCurrent(input); if (!initial || !numericPendingBoundToInputV5(input, initial)) return null; }
  catch { return null; }
  try {
    const basis = numericPendingObservationV5(initial, domain, port.domainPolicyVersion);
    const manifest = await createCandidateManifest({ binding: basis.binding, candidates: basis.candidates });
    const result = await selectApplicationCandidate({
      manifest, wholeUtterance, policy: port.choicePolicy, maximumChildrenPerMenu: port.maximumChildrenPerMenu, maximumDecisions: port.maximumDecisions,
      readCurrent() {
        const current = port.readCurrent(input);
        if (!current || !numericPendingBoundToInputV5(input, current)) throw new Error('Numeric pending binding no longer current.');
        return numericPendingObservationV5(current, port.domainMinutes, port.domainPolicyVersion);
      },
      async choose(request, beforeDispatch) {
        // Semantic request only. Census, credentials and local owner/permission metadata are excluded.
        const bytes = semanticNormalizerByteLength(request);
        const response = await port.choose(request, () => {
          beforeDispatch();
          run.requestBytes.push(bytes);
          const { wholeUtterance, ...candidateChoiceRequest } = request;
          recordWeeklyPlanningStableV5DebugTrace({ requestId: input.traceRequestId, stage: 'semantic_provider_request', data: { attempt: 'numeric_pending_choice', requestBytes: bytes, request: { purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: wholeUtterance }], candidateChoiceRequest } } });
        });
        const serialized = JSON.stringify(response);
        run.responseLengths.push(serialized.length);
        recordWeeklyPlanningStableV5DebugTrace({ requestId: input.traceRequestId, stage: 'semantic_provider_response', data: { attempt: 'numeric_pending_choice', rawResponse: serialized, responseLength: serialized.length } });
        return response;
      },
    });
    if (result.status !== 'staged' || input.userText !== wholeUtterance) return null;
    const leaf = result.selection.candidate.tuple;
    const document = createFocusedContextualAnswerDocumentV5({ input, decision: { decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: leaf.measurement, minutes: leaf.minutes, precision: leaf.precision, quantityRole: null } });
    const effort = document?.tasks.flatMap(t => t.effortEstimates);
    if (!document || effort?.length !== 1 || effort[0].targetLocalId !== leaf.targetId
      || effort[0].kind !== leaf.measurement || effort[0].minutes !== leaf.minutes || effort[0].precision !== leaf.precision || effort[0].unitCode !== leaf.perUnit) return null;
    return Object.freeze({ status: 'staged', wholeUtterance, selection: result.selection, document, diagnostics: run.diagnostics({ attemptCount: run.requestBytes.length, repairAttempted: false, validationErrors: [], providerError: null }) });
  } catch { return null; }
}
