import { canonicalCandidateSerialization, createCandidateManifest, selectApplicationCandidate,
  type ApplicationCandidate, type CandidateBasis, type CandidateBinding, type CandidateChoiceRequest,
  type CandidateObservation, type CandidateTuple, type CalibratedChoicePolicy, type StagedCandidateSelection,
} from '../application/candidateSelection';
import { listCalendarDatesInclusive } from './weeklyPlanningCalendarResolver';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { readWeeklyPlanningPendingQuestionV5 } from './weeklyPlanningPendingQuestionV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

export interface TemporalDateTupleV5 extends CandidateTuple {
  readonly dateExpression: string;
  readonly scope: CandidateTuple;
}
export interface TemporalDateViewV5 {
  readonly input: WeeklyPlanningSemanticNormalizerInputV5;
  readonly binding: CandidateBinding;
  readonly domainPolicyVersion: string;
  readonly calendar: { readonly referenceDate: string; readonly timeZone: string; readonly weekStartsOn: 'monday' | 'sunday' };
  /** Frozen by the application when the exact question is presented; absent legacy snapshots are ineligible. */
  readonly questionBasis: { readonly scope: CandidateTuple; readonly sources: CandidateBinding['sources'] } | null;
  readonly sourceAccess: CandidateObservation['sourceAccess'];
  readonly intentProvenance: CandidateObservation['intentProvenance'];
  readonly questionPresentation: CandidateObservation['questionPresentation'];
}

/** Application-owned closure only. No language parsing, domain extraction or current-intent inference. */
export function createTemporalDateBasisV5(params: Pick<TemporalDateViewV5, 'input' | 'binding' | 'calendar' | 'domainPolicyVersion'>): CandidateBasis<TemporalDateTupleV5> | null {
  try {
    const { input, binding, calendar, domainPolicyVersion } = params;
    if (typeof domainPolicyVersion !== 'string' || !domainPolicyVersion.trim() || domainPolicyVersion.length > 128) return null;
    if (!calendar || listCalendarDatesInclusive(calendar.referenceDate, calendar.referenceDate)?.length !== 1
      || !calendar.timeZone || calendar.timeZone.length > 64 || !['monday','sunday'].includes(calendar.weekStartsOn)) return null;
    try { new Intl.DateTimeFormat('en', { timeZone: calendar.timeZone }).format(); } catch { return null; }
    const graph = input.committedGraph;
    const pending = readWeeklyPlanningPendingQuestionV5(input.publicStateSummary);
    if (!graph || !validateWeeklyPlanningFactGraphValueV5(graph).graph || input.supplementalContext?.trim()
      || !pending || pending.questionCode !== 'missing_availability_date_scope'
      || binding.question.code !== pending.questionCode || binding.question.id !== pending.actionId
      || binding.target.kind !== 'availability_declaration' || binding.target.id !== pending.targetFactId
      || graph.revision !== pending.graphRevision || binding.graphRevision !== graph.revision
      || binding.requestId !== input.traceRequestId || binding.selectionEpoch < 1
      || !binding.ownerId || !binding.conversationId || !binding.question.presentingTurnId || !binding.question.presentingMessageId
      || !Number.isSafeInteger(binding.inputRevision) || binding.inputRevision < 0
      // The frozen presentation revision can precede the answer-turn revision; the live
      // controller separately checks exact question, graph, owner and pending-turn freshness.
      || binding.question.presentationRevision > binding.inputRevision) return null;
    const source = graph.availabilityDeclarations.find(fact => fact.id === binding.target.id);
    if (!source || !isWeeklyPlanningFactActiveV5(graph, source.id)
      || !['available', 'unavailable'].includes(source.kind) || source.constraintLevel !== 'hard'
      || source.dateExpression !== null || source.recurrenceKind !== null || source.days.length !== 0
      || source.namedTimePeriod !== null || source.capacityMinutes != null
      || !source.startTime || !source.endTime || source.startTime === '24:00' || source.endTime === '24:00') return null;
    // One pending date target: a bare date cannot say which of several plan-wide undated declarations it scopes.
    if (graph.availabilityDeclarations.some(fact => fact.id !== source.id && isWeeklyPlanningFactActiveV5(graph, fact.id)
      && fact.dateExpression === null && fact.recurrenceKind === null && fact.days.length === 0)) return null;
    // Canonical graph value validator already checks clock syntax; compare interpreted clock values only.
    const minutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
    if (minutes(source.startTime) >= minutes(source.endTime)) return null;
    const windows = graph.planningWindows.filter(fact => isWeeklyPlanningFactActiveV5(graph, fact.id));
    if (windows.length !== 1 || windows[0].kind !== 'absolute' || !windows[0].start || !windows[0].end) return null;
    // Reject wide interpreted horizons before materializing the date list.
    const spanDays = (Date.parse(`${windows[0].end}T00:00:00Z`) - Date.parse(`${windows[0].start}T00:00:00Z`)) / 86_400_000;
    if (!Number.isSafeInteger(spanDays) || spanDays < 1 || spanDays > 6) return null;
    const dates = listCalendarDatesInclusive(windows[0].start, windows[0].end);
    if (!dates || dates.length < 2 || dates.length > 7) return null;
    const scope: CandidateTuple = {
      meaning: 'one_absolute_date_for_existing_plan_wide_availability',
      answerKind: 'one_explicit_absolute_calendar_date', retainFixedInterval: true,
      kind: source.kind, constraintLevel: source.constraintLevel,
      startTime: source.startTime, endTime: source.endTime,
      namedTimePeriod: null, recurrenceKind: null, days: [],
      planningStartDate: windows[0].start, planningEndDate: windows[0].end,
      referenceDate: calendar.referenceDate, timeZone: calendar.timeZone, weekStartsOn: calendar.weekStartsOn,
    };
    // Source evidence remains local. Provider projection contains only question, target and scope.
    const sources = [source, windows[0]].map(fact => ({ id: fact.id, revision: canonicalCandidateSerialization(fact) }));
    sources.push({ id: 'temporal-date-domain-policy', revision: domainPolicyVersion });
    const completeBinding = { ...binding, sources, scope };
    const candidates: readonly ApplicationCandidate<TemporalDateTupleV5>[] = dates.map((dateExpression, index) => ({
      id: `temporal-date:${index}`, label: `${dateExpression}; ${source.kind}; ${source.startTime}–${source.endTime}`,
      tuple: { dateExpression, scope },
    }));
    return { binding: completeBinding, candidates };
  } catch { return null; }
}

export function temporalDateObservationV5(view: TemporalDateViewV5): CandidateObservation<TemporalDateTupleV5> | null {
  const basis = createTemporalDateBasisV5(view);
  if (!basis || !view.questionBasis || canonicalCandidateSerialization(view.questionBasis) !== canonicalCandidateSerialization({ scope: basis.binding.scope, sources: basis.binding.sources })) return null;
  return basis ? { ...basis, sourceAccess: view.sourceAccess, intentProvenance: view.intentProvenance,
    questionPresentation: view.questionPresentation, targetStatus: 'active', formalEligibility: 'eligible' } : null;
}
export interface TemporalDateChoicePortV5 {
  readonly choicePolicy: CalibratedChoicePolicy;
  readCurrent(): TemporalDateViewV5;
  choose(request: CandidateChoiceRequest<TemporalDateTupleV5>, beforeDispatch: () => void): Promise<unknown>;
}
export interface StagedTemporalDateChoiceV5 {
  readonly wholeUtterance: string;
  readonly selection: StagedCandidateSelection<TemporalDateTupleV5>;
}
/** No default policy: the application supplies a frozen independently calibrated artifact. */
export async function selectTemporalDateChoiceV5(port: TemporalDateChoicePortV5): Promise<StagedTemporalDateChoiceV5 | null> {
  try {
    const initial = port.readCurrent();
    const wholeUtterance = initial.input.userText;
    const observation = temporalDateObservationV5(initial);
    if (!observation) return null;
    const manifest = await createCandidateManifest({ binding: observation.binding, candidates: observation.candidates });
    const selected = await selectApplicationCandidate({ manifest, wholeUtterance, policy: port.choicePolicy,
      maximumChildrenPerMenu: 7, maximumDecisions: 1,
      readCurrent() {
        const live = port.readCurrent();
        const current = temporalDateObservationV5(live);
        if (!current || live.input.userText !== wholeUtterance) throw new Error('Temporal date source changed.');
        return current;
      },
      choose: port.choose,
    });
    return selected.status === 'staged' ? { wholeUtterance, selection: selected.selection } : null;
  } catch { return null; }
}
