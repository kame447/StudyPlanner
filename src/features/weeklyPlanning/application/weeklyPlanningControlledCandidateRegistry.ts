import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { decodeWeeklyPlanningStableV5QuestionSlot } from '../intake/weeklyPlanningStableV5QuestionSlot';
import { isWeeklyPlanningQuestionPresentationControlledDirect } from '../intake/weeklyPlanningQuestionPresentation';
import { weeklyPlanningStableV5AcceptedFactsForTurn } from '../dialogue/weeklyPlanningStableV5CurrentTurnGrounding';
import type { PlanningState, WeeklyPlanningMessage, WeeklyPlanningPendingTurn } from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';
import type { CandidateBasis, StagedCandidateSelection } from './candidateSelection/contracts';
import { canonicalCandidateSerialization } from './candidateSelection/canonical';
import { controlledCandidateTurnGates, type ControlledCandidateGateInput } from './weeklyPlanningControlledCandidateGates';
import { boundC5PresentedQuestion, captureC5Question, decodeC5Ledger } from './c5LocalSelection/basis';
import { prepareC5TurnCommit, prepareLocalCandidateReducerCommit, selectC5Turn } from './c5LocalSelection/selection';
import type { C5LocalSelectionOptions } from './c5LocalSelection/contracts';
import type { ControlledCandidateAdapter, ControlledCandidateDomain, ControlledCandidateSemanticContribution } from './weeklyPlanningControlledCandidateDomains';
import { decodeControlledCandidateQuestion, freezeControlledCandidateQuestion } from './weeklyPlanningControlledCandidateQuestion';

export interface ControlledCandidateCaptureTurn {
  ownerId: string; conversationId: string; state: PlanningIntakeState; graph: WeeklyPlanningFactGraphV5;
  messages: readonly WeeklyPlanningMessage[]; planningState: PlanningState; pending: WeeklyPlanningPendingTurn;
}
export interface ControlledCandidateStageTurn extends ControlledCandidateGateInput {
  ownerId: string; readCommittedGraph(): WeeklyPlanningFactGraphV5;
}
export interface RegisteredControlledCandidateDomain {
  readonly domainId: string;
  readonly questionCode: string;
  capture(turn: ControlledCandidateCaptureTurn): PlanningIntakeState;
  stage(turn: ControlledCandidateStageTurn): Promise<RegisteredControlledCandidateAdapter | null>;
}
export interface RegisteredControlledCandidateAdapter extends Omit<ControlledCandidateAdapter, 'semanticContribution' | 'branch'> {
  readonly branch: 'c5_local_selection' | 'd5_pending_selection' | 'temporal_date_selection';
  readonly semanticContribution: ControlledCandidateSemanticContribution | null;
  continueSelectedTurn(turn: { snapshot: PlanningState; pending: WeeklyPlanningPendingTurn; userText: string }): Promise<WeeklyPlanningTurnExecutionResult>;
}
export interface ControlledCandidateDomainOptions extends Pick<C5LocalSelectionOptions, 'policy' | 'maximumChildrenPerMenu' | 'maximumDecisions' | 'choose' | 'sourceAccess'> {
  inputForTurn(turn: { snapshot: PlanningState; pending: WeeklyPlanningPendingTurn; userText: string }): WeeklyPlanningSemanticNormalizerInputV5;
  requestContextForTurn(pending: WeeklyPlanningPendingTurn): WeeklyPlanningTurnRequestContext;
  continueSelectedTurn(turn: { snapshot: PlanningState; pending: WeeklyPlanningPendingTurn; userText: string;
    graph: WeeklyPlanningFactGraphV5; semanticContribution: ControlledCandidateSemanticContribution }): Promise<WeeklyPlanningTurnExecutionResult>;
}
export type ControlledCandidateRegistry = readonly RegisteredControlledCandidateDomain[];

export function controlledCandidateQuestionCode(state: PlanningIntakeState | undefined) {
  return decodeWeeklyPlanningStableV5QuestionSlot(state?.lastQuestionContext?.targetSlot);
}

/** Ambiguous registrations fail closed independently of registration order. */
function routeFor(registry: ControlledCandidateRegistry, code: string | null): RegisteredControlledCandidateDomain | null {
  if (!code || new Set(registry.map(route => route.domainId)).size !== registry.length
    || new Set(registry.map(route => route.questionCode)).size !== registry.length) return null;
  const matching = registry.filter(route => route.questionCode === code);
  return matching.length === 1 ? matching[0] : null;
}
export function captureRegisteredCandidateQuestion(registry: ControlledCandidateRegistry, turn: ControlledCandidateCaptureTurn): PlanningIntakeState {
  try { return routeFor(registry, decodeWeeklyPlanningStableV5QuestionSlot(turn.state.lastQuestionContext?.targetSlot))?.capture(turn) ?? turn.state; }
  catch { return turn.state; }
}
export async function stageRegisteredCandidateTurn(registry: ControlledCandidateRegistry, turn: ControlledCandidateStageTurn): Promise<RegisteredControlledCandidateAdapter | null> {
  try { return await routeFor(registry, decodeWeeklyPlanningStableV5QuestionSlot(turn.snapshot.intakeState?.lastQuestionContext?.targetSlot))?.stage(turn) ?? null; }
  catch { return null; }
}
/** Native C5 delegation preserves its exact snapshot, ID, manifest and request wire representation. */
export function registerC5CandidateDomain(options: C5LocalSelectionOptions): RegisteredControlledCandidateDomain {
  return {
    domainId: 'c5_effort', questionCode: 'ambiguous_effort_estimate',
    capture: turn => captureC5Question(turn),
    async stage(turn) {
      const input = { ...turn, options, getGraph: turn.readCommittedGraph };
      const selected = await selectC5Turn(input);
      return selected ? { selected, branch: 'c5_local_selection', semanticContribution: null,
        prepare: () => prepareC5TurnCommit(input, selected),
        continueSelectedTurn: next => options.continueSelectedTurn({ ...next, graph: structuredClone(selected.graph) }),
      } : null;
    },
  };
}
/** Producers interpret an already bounded typed domain; this host supplies machine and live gates. */
export function registerControlledCandidateDomain(domain: ControlledCandidateDomain, options: ControlledCandidateDomainOptions): RegisteredControlledCandidateDomain {
  const policyVersion = domain.domainPolicyVersion;
  return {
    domainId: domain.domainId, questionCode: domain.questionCode,
    capture(turn) {
      const context = turn.state.lastQuestionContext; const p = context?.presentation;
      if (!p || turn.state.questions.length !== 1 || !context?.topicId
        || !isWeeklyPlanningQuestionPresentationControlledDirect(p.content) || p.graphRevision !== turn.graph.revision
        || domain.domainPolicyVersion !== policyVersion || options.sourceAccess() !== 'allowed') return turn.state;
      // Facts carry the presenting request ID (not the presentation's turn ID): exactly what the
      // rendered acknowledgement may echo. Never re-run at answer time.
      if (domain.rejectsCoPresentedFacts({ targetId: context.topicId,
        facts: weeklyPlanningStableV5AcceptedFactsForTurn(turn.graph, turn.pending.requestId) }) !== false) return turn.state;
      const old = turn.state.c5SelectionLedger;
      const ledger = old === undefined ? { version: 1 as const, ownerId: turn.ownerId, conversationId: turn.conversationId, lastEpoch: 0, consumed: [] }
        : decodeC5Ledger(old, turn.ownerId, turn.conversationId);
      if (!ledger || !Number.isSafeInteger(ledger.lastEpoch + 1)) return turn.state;
      const question = { id: ['candidate-question', domain.domainId, p.turnId, context.topicId].join(':'),
        code: domain.questionCode, presentingTurnId: p.turnId, presentingMessageId: p.assistantMessageId,
        presentationRevision: p.planningStateRevision };
      const presentedQuestion = boundC5PresentedQuestion(question, turn.messages);
      if (!presentedQuestion || presentedQuestion.text !== turn.state.questions[0]) return turn.state;
      const state = { ...turn.state, lastQuestionContext: { ...context, actionId: question.id } };
      const captureContext = { ...turn, state: { ...turn.planningState, intakeState: state }, question: { ...question, presentedQuestion },
        selectionEpoch: ledger.lastEpoch + 1, domainPolicyVersion: policyVersion,
        requestContext: options.requestContextForTurn(turn.pending) };
      const payload = domain.capture(captureContext);
      if (!payload || payload.target.id !== context.topicId) return turn.state;
      const snapshot = freezeControlledCandidateQuestion(domain, { binding: {
        ownerId: turn.ownerId, conversationId: turn.conversationId, requestId: p.turnId,
        inputRevision: p.planningStateRevision, graphRevision: turn.graph.revision,
        question: captureContext.question, target: payload.target, scope: payload.scope, sources: payload.sources,
        selectionEpoch: captureContext.selectionEpoch,
      }, candidates: payload.candidates }, payload.domainData);
      return { ...state, controlledCandidateProtocolVersion: 1, c5SelectionLedger: { ...ledger, lastEpoch: captureContext.selectionEpoch },
        lastQuestionContext: { ...state.lastQuestionContext, controlledCandidate: snapshot } };
    },
    async stage(turn) {
      const frozen = decodeControlledCandidateQuestion(turn.snapshot.intakeState?.lastQuestionContext?.controlledCandidate, turn.ownerId, turn.pending.conversationId);
      const ledger = decodeC5Ledger(turn.snapshot.intakeState?.c5SelectionLedger, turn.ownerId, turn.pending.conversationId);
      if (!frozen || frozen.domainId !== domain.domainId || frozen.domainPolicyVersion !== policyVersion
        || domain.domainPolicyVersion !== policyVersion || ledger?.lastEpoch !== frozen.basis.binding.selectionEpoch) return null;
      const basis = { ...frozen.basis, binding: { ...frozen.basis.binding, requestId: turn.pending.requestId, inputRevision: turn.pending.baseRevision } };
      const input = structuredClone(options.inputForTurn(turn));
      if (input.userText !== turn.userText || input.traceRequestId !== turn.pending.requestId || !input.committedGraph
        || input.supplementalContext || input.selectedStarterTarget
        || canonicalCandidateSerialization(input.committedGraph) !== canonicalCandidateSerialization(turn.readCommittedGraph())) return null;
      let selectedCapability: StagedCandidateSelection | undefined;
      const currentBasis = (expected: CandidateBasis): ReturnType<typeof domain.capture> => domain.capture({
        ownerId: turn.ownerId, conversationId: turn.pending.conversationId,
        graph: turn.readCommittedGraph(), state: turn.getState(), messages: turn.getState().messages,
        question: { ...expected.binding.question, presentedQuestion: boundC5PresentedQuestion(expected.binding.question, turn.getState().messages) ?? undefined },
        selectionEpoch: frozen.basis.binding.selectionEpoch, domainPolicyVersion: policyVersion,
        requestContext: options.requestContextForTurn(turn.pending),
      });
      const observeCurrentBasis = (expected: CandidateBasis) => {
        const graph = turn.readCommittedGraph(); const gates = controlledCandidateTurnGates(turn, graph, frozen.basis.binding);
        const live = currentBasis(expected);
        return { binding: { ...expected.binding, graphRevision: graph.revision,
          ...(live ? { target: live.target, scope: live.scope, sources: live.sources } : {}),
          question: { ...expected.binding.question, presentedQuestion: boundC5PresentedQuestion(expected.binding.question, turn.getState().messages) ?? undefined } },
          candidates: live?.candidates ?? [], sourceAccess: options.sourceAccess(), intentProvenance: 'validated_current_turn' as const,
          targetStatus: live ? 'active' as const : 'inactive' as const,
          questionPresentation: gates.beginMatches && gates.matchingQuestion ? 'fresh' as const : 'stale' as const,
          formalEligibility: gates.beginMatches && live && domain.domainPolicyVersion === policyVersion ? 'eligible' as const : 'ineligible' as const };
      };
      const current = () => {
        const observation = observeCurrentBasis(basis);
        return observation.sourceAccess === 'allowed' && observation.questionPresentation === 'fresh'
          && observation.formalEligibility === 'eligible' && canonicalCandidateSerialization({ binding: observation.binding, candidates: observation.candidates }) === canonicalCandidateSerialization(basis)
          && canonicalCandidateSerialization(currentBasis(basis)?.domainData) === canonicalCandidateSerialization(frozen.domainData);
      };
      if (!current()) return null;
      const adapter = await domain.stage({ snapshot: turn.snapshot, pending: turn.pending, frozen, basis, userText: turn.userText,
        normalizerInput: input, policy: options.policy, maximumChildrenPerMenu: options.maximumChildrenPerMenu, maximumDecisions: options.maximumDecisions,
        readRequestContext: () => options.requestContextForTurn(turn.pending), observeCurrentBasis,
        readCurrentState: turn.getState, readCommittedGraph: turn.readCommittedGraph,
        readLedger: () => decodeC5Ledger(turn.getState().intakeState?.c5SelectionLedger, turn.ownerId, turn.pending.conversationId),
        sourceAccess: options.sourceAccess,
        choose: async (request, beforeDispatch) => {
          const check = () => { if (!current() || request.wholeUtterance !== turn.userText) throw new Error('Stale registered candidate.'); beforeDispatch(); };
          const result = await options.choose(request, check); if (!current()) throw new Error('Stale registered candidate response.'); return result;
        },
        prepareLocalCandidateReducerCommit: receipt => canonicalCandidateSerialization({ binding: receipt.selection.manifest.binding,
          candidates: receipt.selection.manifest.candidates }) !== canonicalCandidateSerialization(basis) ? null : prepareLocalCandidateReducerCommit({ ...receipt,
          revalidateFinalized: () => receipt.selection === selectedCapability && domain.domainPolicyVersion === policyVersion
            && options.sourceAccess() === 'allowed'
            && (() => { const gates = controlledCandidateTurnGates(turn, input.committedGraph!, frozen.basis.binding); return gates.beginMatches && gates.matchingQuestion; })()
            && boundC5PresentedQuestion(basis.binding.question, turn.getState().messages)?.text === basis.binding.question.presentedQuestion?.text
            && receipt.revalidateFinalized(),
        }),
      });
      if (!adapter || !current() || canonicalCandidateSerialization({ binding: adapter.selected.selection.manifest.binding, candidates: adapter.selected.selection.manifest.candidates }) !== canonicalCandidateSerialization(basis)
        || adapter.semanticContribution.canonicalization.status !== 'applied'
        || canonicalCandidateSerialization(adapter.semanticContribution.canonicalization.graph) !== canonicalCandidateSerialization(adapter.selected.graph)) return null;
      selectedCapability = adapter.selected.selection;
      return { ...adapter, prepare: () => current() ? adapter.prepare() : null,
        continueSelectedTurn: next => options.continueSelectedTurn({ ...next, graph: structuredClone(adapter.selected.graph), semanticContribution: adapter.semanticContribution }) };
    },
  };
}
