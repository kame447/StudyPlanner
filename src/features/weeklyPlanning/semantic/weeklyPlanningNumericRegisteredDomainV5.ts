import type { CandidateBinding, CandidateTuple } from '../application/candidateSelection/contracts';
import { canonicalCandidateSerialization } from '../application/candidateSelection/canonical';
import type { ControlledCandidateDomain, ControlledCandidateCaptureContext, ControlledCandidateStageContext } from '../application/weeklyPlanningControlledCandidateDomains';
import { boundC5PresentedQuestion, serializeC5ApplicationState } from '../application/c5LocalSelection/basis';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import { captureNumericPendingQuestionDomainV5, isNumericPendingQuestionDomainCurrentV5, tryFrozenNumericPendingChoiceRouteV5, type NumericPendingQuestionDomainV5 } from './weeklyPlanningNumericPendingDomainV5';
import { numericPendingObservationV5, type NumericPendingStateV5 } from './weeklyPlanningNumericPendingChoiceV5';
import { numericPendingCompleteScopeV5 } from './weeklyPlanningNumericPendingScopeV5';
import { createFrozenNumericPendingControlledAdapterV5 } from './weeklyPlanningNumericPendingCommitV5';
import { numericAnswerProposalV5, numericDigitRunsV5 } from './weeklyPlanningNumericAnswerProposalV5';

function measurement(context: ControlledCandidateCaptureContext): NumericPendingStateV5['measurement'] | null {
  const intent = context.state.intakeState?.lastQuestionContext?.intent;
  return intent === 'total_duration' || intent === 'duration_per_unit' ? intent : null;
}

function presentingEvidence(context: ControlledCandidateCaptureContext): {
  input: WeeklyPlanningSemanticNormalizerInputV5;
  state: NumericPendingStateV5;
} | null {
  const last = context.state.intakeState?.lastQuestionContext;
  const targetId = last?.topicId;
  const kind = measurement(context);
  if (!targetId || !kind || last?.targetSlot !== 'stable_v5:missing_effort_estimate'
    || last.presentation?.graphRevision !== context.graph.revision) return null;
  const summary = createWeeklyPlanningSemanticPublicStateSummaryV5({
    pendingQuestion: {
      actionId: context.question.id,
      questionCode: 'missing_effort_estimate',
      targetFactId: targetId,
      graphRevision: context.graph.revision,
      effortMeasurement: kind,
    },
  }, context.graph);
  const input: WeeklyPlanningSemanticNormalizerInputV5 = {
    userText: '',
    traceRequestId: context.question.presentingTurnId,
    committedGraph: context.graph,
    publicStateSummary: summary,
  };
  const scope = numericPendingCompleteScopeV5(input);
  if (!scope) return null;
  // Only typed evidence is snapshotted. Raw source text and provenance stay in the graph.
  const sources: CandidateBinding['sources'] = [{
    id: 'numeric-pending-source',
    revision: canonicalCandidateSerialization({ graphRevision: context.graph.revision, targetId, scope }),
  }];
  return {
    input,
    state: {
      binding: {
        ownerId: context.ownerId,
        conversationId: context.conversationId,
        requestId: context.question.presentingTurnId,
        inputRevision: context.question.presentationRevision,
        graphRevision: context.graph.revision,
        sources, target: { kind: 'workload', id: targetId },
        scope, question: context.question,
        selectionEpoch: context.selectionEpoch,
      },
      pendingTargetCount: 1,
      measurement: kind,
      perUnit: kind === 'duration_per_unit' ? context.graph.workloads.find(x => x.id === targetId)?.unitCode ?? null : null,
      sourceAccess: 'allowed',
      intentProvenance: 'validated_current_turn',
      targetStatus: 'active',
      questionPresentation: 'fresh',
      formalEligibility: 'eligible',
    },
  };
}

function answerState(context: ControlledCandidateStageContext, domain: NumericPendingQuestionDomainV5): NumericPendingStateV5 | null {
  try {
    const live = context.observeCurrentBasis(context.basis);
    if (live.sourceAccess !== 'allowed' || live.questionPresentation !== 'fresh'
      || live.formalEligibility !== 'eligible' || live.targetStatus !== 'active'
      || canonicalCandidateSerialization({ binding: live.binding, candidates: live.candidates })
        !== canonicalCandidateSerialization(context.basis)) return null;
    const baseSources = context.basis.binding.sources.filter(source => source.id !== 'numeric-domain-policy');
    const state: NumericPendingStateV5 = {
      binding: { ...context.basis.binding, sources: baseSources },
      pendingTargetCount: 1,
      measurement: domain.measurement,
      perUnit: domain.perUnit,
      sourceAccess: live.sourceAccess,
      intentProvenance: live.intentProvenance,
      targetStatus: live.targetStatus,
      questionPresentation: live.questionPresentation,
      formalEligibility: live.formalEligibility,
    };
    const shown = boundC5PresentedQuestion(context.basis.binding.question, context.readCurrentState().messages);
    return isNumericPendingQuestionDomainCurrentV5(domain, {
      input: context.normalizerInput, state,
      domainMinutes: domain.domainMinutes,
      domainPolicyVersion: domain.domainPolicyVersion,
      presentedQuestion: shown,
    }) ? state : null;
  } catch { return null; }
}

/** A finite complete-candidate producer. All mutation remains with the existing controller and reducer. */
export function createNumericPendingRegisteredDomainV5(
  domainMinutes: readonly number[],
  domainPolicyVersion: string,
  options: { readonly candidateSource: 'question_menu' | 'answer_proposal' } = { candidateSource: 'question_menu' },
): ControlledCandidateDomain {
  const answerProposal = options.candidateSource === 'answer_proposal';
  return {
    domainId: 'd5_numeric',
    questionCode: 'missing_effort_estimate',
    domainPolicyVersion,
    ...(answerProposal ? {
      proposeAnswerPayload(payload, userText) {
        const proposal = numericAnswerProposalV5(userText);
        if (!proposal) return null;
        const frozen = payload.domainData as unknown as NumericPendingQuestionDomainV5;
        // Only a question-time placeholder written by this domain's capture may be widened.
        if (canonicalCandidateSerialization(frozen.domainMinutes) !== canonicalCandidateSerialization(domainMinutes)) return null;
        const observation = numericPendingObservationV5({ binding: { ...frozen.binding,
          requestId: frozen.binding.question.presentingTurnId, inputRevision: frozen.binding.question.presentationRevision },
          measurement: frozen.measurement, perUnit: frozen.perUnit, pendingTargetCount: 1,
          sourceAccess: 'allowed', intentProvenance: 'validated_current_turn', targetStatus: 'active',
          questionPresentation: 'fresh', formalEligibility: 'eligible' },
        proposal.minutes, domainPolicyVersion);
        return { target: observation.binding.target, scope: observation.binding.scope,
          sources: observation.binding.sources, candidates: observation.candidates,
          domainData: { ...frozen, domainMinutes: proposal.minutes } as unknown as CandidateTuple };
      },
    } satisfies Pick<ControlledCandidateDomain, 'proposeAnswerPayload'> : {}),
    rejectsCoPresentedFacts({ targetId, facts }) {
      // An acknowledged sibling quantity or estimate would make a bare minute answer
      // ambiguous (an estimate or target switch). The target's own task/components/amount are inherent.
      return facts.some(fact => fact.kind === 'effort_estimate' || (fact.kind === 'workload' && fact.factId !== targetId));
    },
    capture(context) {
      const evidence = presentingEvidence(context);
      if (!evidence) return null;
      const presented = context.question.presentedQuestion;
      if (!presented) return null;
      const frozen = captureNumericPendingQuestionDomainV5({
        ...evidence,
        domainMinutes, domainPolicyVersion,
        presentedQuestion: presented,
      });
      if (!frozen) return null;
      const observation = numericPendingObservationV5(evidence.state, domainMinutes, domainPolicyVersion);
      return { target: observation.binding.target,
        scope: observation.binding.scope,
        sources: observation.binding.sources,
        candidates: observation.candidates,
        domainData: frozen as unknown as CandidateTuple };
    },
    async stage(context) {
      const frozen = context.frozen.domainData as unknown as NumericPendingQuestionDomainV5;
      const initial = answerState(context, frozen);
      if (!initial) return null;
      const presented = () => boundC5PresentedQuestion(context.basis.binding.question, context.readCurrentState().messages);
      const port = {
        domainMinutes: frozen.domainMinutes,
        domainPolicyVersion: frozen.domainPolicyVersion,
        choicePolicy: context.policy,
        maximumChildrenPerMenu: context.maximumChildrenPerMenu,
        maximumDecisions: context.maximumDecisions,
        readCurrent: () => answerState(context, frozen),
        readPresentedQuestion: presented,
        choose: context.choose,
      };
      const run = new WeeklyPlanningSemanticNormalizerRunV5({
        async createChatCompletion() { throw new Error('Numeric candidate route has no generative interpreter.'); },
      }, context.normalizerInput);
      const staged = await tryFrozenNumericPendingChoiceRouteV5(run, port, frozen);
      if (!staged) return null;
      if (answerProposal) {
        const minutes = staged.selection.candidate.tuple.minutes;
        const integers = numericAnswerProposalV5(context.userText)?.sourceIntegers.get(minutes);
        if (!integers) return null;
        const values = new Set([minutes, ...integers]);
        // Range labels are compared by every digit run they contain; over-blocking falls back to Luna.
        const collides = (value: number | string | null | undefined) => value != null
          && (typeof value === 'number' ? values.has(value) : numericDigitRunsV5(value).some(n => values.has(n)));
        const graph = context.readCommittedGraph();
        const active = new Set(graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
        if (graph.workloads.some(f => active.has(f.id) && [f.amount, f.rangeStart, f.rangeEnd].some(collides))
          || graph.effortEstimates.some(f => active.has(f.id) && collides(f.minutes))
          || graph.availabilityDeclarations.some(f => active.has(f.id) && collides(f.capacityMinutes))
          || graph.recurrences.some(f => active.has(f.id) && collides(f.count))) return null;
      }
      const priorState = serializeC5ApplicationState(context.readCurrentState());
      const priorInput = serializeC5ApplicationState(context.normalizerInput);
      const priorLedger = serializeC5ApplicationState(context.readLedger());
      const priorPresentation = serializeC5ApplicationState(presented());
      let finalizedGraph: string | null = null;
      const adapter = createFrozenNumericPendingControlledAdapterV5(staged, {
        readCurrent() {
          const current = context.readCurrentState();
          const ledger = context.readLedger();
          const liveGraph = serializeC5ApplicationState(context.readCommittedGraph());
          const isFinalized = finalizedGraph !== null && liveGraph === finalizedGraph;
          // Before finalization the original domain is re-derived. Afterwards the
          // selected graph replaces it, so validate the unchanged begin-turn state,
          // access and receipt against the exact selected graph.
          const state = isFinalized
            && context.sourceAccess() === 'allowed'
            && serializeC5ApplicationState(current) === priorState
            && serializeC5ApplicationState(context.normalizerInput) === priorInput
            && serializeC5ApplicationState(ledger) === priorLedger
            && serializeC5ApplicationState(presented()) === priorPresentation
            ? initial : answerState(context, frozen);
          if (!state || !ledger) throw new Error('Numeric state or selection ledger stale.');
          return { input: context.normalizerInput, state,
            domainMinutes: frozen.domainMinutes, domainPolicyVersion: frozen.domainPolicyVersion,
            current, ledger, turnId: context.pending.requestId };
        },
        readRuntimeGraph: context.readCommittedGraph,
        readPresentedQuestion: presented,
        prepareLocalCandidateReducerCommit: context.prepareLocalCandidateReducerCommit,
      }, frozen);
      finalizedGraph = adapter ? serializeC5ApplicationState(adapter.selected.graph) : null;
      return adapter;
    },
  };
}
