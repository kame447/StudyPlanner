import { canonicalCandidateSerialization } from '../application/candidateSelection/canonical';
import type { CandidateBinding, CandidateTuple } from '../application/candidateSelection/contracts';
import type {
  ControlledCandidateCaptureContext, ControlledCandidateDomain, ControlledCandidateStageContext,
} from '../application/weeklyPlanningControlledCandidateDomains';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import {
  createTemporalDateBasisV5, selectTemporalDateChoiceV5, temporalDateObservationV5,
  type TemporalDateViewV5,
} from './weeklyPlanningTemporalDateChoiceV5';
import { createTemporalDateControlledAdapterV5 } from './weeklyPlanningTemporalDateCommitV5';
import { serializeC5ApplicationState } from '../application/c5LocalSelection/basis';

export const TEMPORAL_DATE_DOMAIN_POLICY_VERSION = 'availability-single-date-20261015-v1';

/** One date for an already typed fixed availability interval; never derive a date from raw Japanese. */
function presentedBasis(context: ControlledCandidateCaptureContext) {
  const targetId = context.state.intakeState?.lastQuestionContext?.topicId;
  if (!targetId || context.state.intakeState?.lastQuestionContext?.targetSlot
    !== 'stable_v5:missing_availability_date_scope') return null;
  const calendar = {
    referenceDate: context.requestContext.currentDate, timeZone: context.requestContext.timeZone,
    weekStartsOn: context.requestContext.weekStartsOn,
  } as const;
  const input: WeeklyPlanningSemanticNormalizerInputV5 = {
    userText: '', traceRequestId: context.question.presentingTurnId, committedGraph: context.graph,
    publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5({
      pendingQuestion: { actionId: context.question.id, questionCode: 'missing_availability_date_scope',
        targetFactId: targetId, graphRevision: context.graph.revision },
    }, context.graph),
  };
  const binding: CandidateBinding = {
    ownerId: context.ownerId, conversationId: context.conversationId,
    requestId: context.question.presentingTurnId,
    inputRevision: context.question.presentationRevision,
    graphRevision: context.graph.revision, sources: [],
    target: { kind: 'availability_declaration', id: targetId },
    scope: {}, question: context.question, selectionEpoch: context.selectionEpoch,
  };
  const basis = createTemporalDateBasisV5({
    input, binding, calendar, domainPolicyVersion: TEMPORAL_DATE_DOMAIN_POLICY_VERSION,
  });
  return basis ? { basis, calendar } : null;
}

interface FrozenDateDomainData extends CandidateTuple {
  readonly calendar: TemporalDateViewV5['calendar'];
  readonly questionBasis: NonNullable<TemporalDateViewV5['questionBasis']>;
}

function isDateDomainData(value: unknown): value is FrozenDateDomainData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).sort().join() === 'calendar,questionBasis'
    && Boolean(candidate.calendar && candidate.questionBasis);
}

function currentView(context: ControlledCandidateStageContext, frozen: FrozenDateDomainData): TemporalDateViewV5 | null {
  try {
    const clock = context.readRequestContext();
    const calendar = { referenceDate: clock.currentDate, timeZone: clock.timeZone,
      weekStartsOn: clock.weekStartsOn };
    if (canonicalCandidateSerialization(calendar) !== canonicalCandidateSerialization(frozen.calendar)) return null;
    const observed = context.observeCurrentBasis(context.basis);
    if (context.sourceAccess() !== 'allowed' || observed.sourceAccess !== 'allowed'
      || observed.questionPresentation !== 'fresh' || observed.formalEligibility !== 'eligible'
      || observed.targetStatus !== 'active'
      || canonicalCandidateSerialization({
        binding: observed.binding, candidates: observed.candidates,
      }) !== canonicalCandidateSerialization(context.basis)) return null;
    return {
      input: context.normalizerInput, binding: context.basis.binding,
      calendar: frozen.calendar, domainPolicyVersion: TEMPORAL_DATE_DOMAIN_POLICY_VERSION,
      questionBasis: frozen.questionBasis, sourceAccess: observed.sourceAccess,
      intentProvenance: observed.intentProvenance,
      questionPresentation: observed.questionPresentation,
    };
  } catch { return null; }
}

export function createTemporalDateRegisteredDomainV5(): ControlledCandidateDomain {
  return {
    domainId: 'availability_date', questionCode: 'missing_availability_date_scope',
    domainPolicyVersion: TEMPORAL_DATE_DOMAIN_POLICY_VERSION,
    rejectsCoPresentedFacts({ targetId, facts }) {
      // A co-acknowledged availability, date or day rule would let a bare date correct that fact
      // instead of scoping the target. The planning window stays allowed: leaves lie inside it.
      return facts.some(fact => (fact.kind === 'availability_declaration' && fact.factId !== targetId)
        || (fact.kind === 'temporal_constraint' && fact.data.dateExpression != null)
        || fact.kind === 'task_date_rule' || fact.kind === 'recurrence');
    },
    capture(context) {
      const source = presentedBasis(context);
      if (!source) return null;
      return {
        target: source.basis.binding.target,
        scope: source.basis.binding.scope, sources: source.basis.binding.sources,
        candidates: source.basis.candidates,
        domainData: { calendar: source.calendar,
          questionBasis: { scope: source.basis.binding.scope, sources: source.basis.binding.sources } },
      };
    },
    async stage(context) {
      const frozen = context.frozen.domainData;
      if (!isDateDomainData(frozen)) return null;
      const initial = currentView(context, frozen);
      if (!initial || !temporalDateObservationV5(initial)) return null;
      const beforeState = serializeC5ApplicationState(context.readCurrentState());
      const beforeLedger = serializeC5ApplicationState(context.readLedger());
      const beforeInput = serializeC5ApplicationState(context.normalizerInput);
      const beforeDate = serializeC5ApplicationState(context.readRequestContext());
      const choose = await selectTemporalDateChoiceV5({
        choicePolicy: context.policy,
        readCurrent: () => {
          const view = currentView(context, frozen);
          if (!view) throw new Error('Stale date-question binding.');
          return view;
        },
        choose: context.choose,
      });
      if (!choose) return null;
      let finalizedGraph: string | null = null;
      const adapter = createTemporalDateControlledAdapterV5(choose, {
        readCurrent() {
          const ledger = context.readLedger();
          if (!ledger || context.sourceAccess() !== 'allowed'
            || serializeC5ApplicationState(context.readCurrentState()) !== beforeState
            || serializeC5ApplicationState(ledger) !== beforeLedger
            || serializeC5ApplicationState(context.normalizerInput) !== beforeInput
            || serializeC5ApplicationState(context.readRequestContext()) !== beforeDate)
            throw new Error('Date selection is stale.');
          const graphBytes = serializeC5ApplicationState(context.readCommittedGraph());
          const afterFinalization = finalizedGraph !== null && graphBytes === finalizedGraph;
          const view = afterFinalization ? initial : currentView(context, frozen);
          if (!view) throw new Error('Date question changed.');
          return { ...view, ledger, turnId: context.pending.requestId,
            current: context.readCurrentState() };
        },
        readRuntimeGraph: context.readCommittedGraph,
        prepareLocalCandidateReducerCommit: context.prepareLocalCandidateReducerCommit,
      });
      finalizedGraph = adapter ? serializeC5ApplicationState(adapter.selected.graph) : null;
      return adapter;
    },
  };
}
