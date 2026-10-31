// A presented VNext question whose answer is one of its own options is a closed
// set. Such a reply may be chosen by the existing candidate-choice route (Jev)
// instead of the full reading, against the text and option labels the user was
// shown. The menu is only that question's options plus `none`; the existing
// selection machinery owns the manifest, hash, freshness, calibrated gate and
// decision limit. A selection becomes `{ kind: 'option' }` for the existing
// binder and nothing else: no fact, save or mutation authority. Every other
// outcome (none, not selected, unavailable, low probability, extra meaning,
// stale, any other question) sends the whole utterance, unchanged, to the full
// reading.
import {
  createCandidateManifest,
  selectApplicationCandidate,
  type CalibratedChoicePolicy,
  type CandidateBasis,
  type CandidateChoiceRequest,
} from '../../application/candidateSelection';
import { createCandidateChoiceClient, type CandidateSemanticGatePolicy } from '../../../../services/ai/candidateChoiceClient';
import type { CandidateChoiceEvaluation } from '../../../../../shared/candidateChoiceDecision';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpreter,
  WeeklyPlanningVNextOptionChoiceDiagnostic,
} from '../weeklyPlanningVNextInterpretationContract';
import type { VNextQuestion, VNextQuestionCode } from '../weeklyPlanningVNextTypes';
import { presentWeeklyPlanningVNextQuestion, type WeeklyPlanningVNextQuestionPresentation } from './weeklyPlanningVNextQuestionText';

/** The VNext questions whose options are the complete answer set. Every other code asks for an open value. */
export const VNEXT_OPTION_CHOICE_CODES = ['remaining_inconsistent', 'same_or_distinct_work'] as const satisfies readonly VNextQuestionCode[];

export interface WeeklyPlanningVNextOptionChoicePort {
  /** Calibrated per menu shape; an uncalibrated menu is never chosen from. */
  policy: CalibratedChoicePolicy;
  choose(request: CandidateChoiceRequest, beforeDispatch: () => void,
    observe?: (evaluation: CandidateChoiceEvaluation, policy: CandidateSemanticGatePolicy) => void): Promise<unknown>;
}

/** Reuse the authenticated client's validated observation, without widening its strict gate response.
 * A client per invocation keeps diagnostics local even when turns overlap. Diagnostics tests guard
 * the existing gate outcomes and full-input fallback; extend those when adding an outcome reason.
 */
export function createWeeklyPlanningVNextOptionChoicePort(params: {
  policy: CalibratedChoicePolicy;
  client: Omit<Parameters<typeof createCandidateChoiceClient>[0], 'onEvaluation'>;
}): WeeklyPlanningVNextOptionChoicePort {
  const semanticPolicy = Object.freeze({ ...params.client.semanticPolicy });
  return { policy: params.policy, choose: (request, beforeDispatch, observe) =>
    createCandidateChoiceClient({ ...params.client, semanticPolicy,
      onEvaluation: (_request, evaluation) => observe?.(evaluation, semanticPolicy),
    }).choose(request, beforeDispatch) };
}

export type WeeklyPlanningVNextOptionChoiceOutcome =
  | { route: 'option_choice'; optionId: string }
  | { route: 'full_reading'; reason: string };

/**
 * A wire id for a VNext identity. Question and owner keys are built from fact lineage ids and grow
 * with them; the candidate wire bounds ids at 160 characters. A digest of the whole identity is
 * bounded and as distinct as the identity itself.
 */
async function wireId(identity: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  return `vnext:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** The selection basis: the presented question's own options, as displayed, at the current revision. */
export async function vnextOptionChoiceBasis(params: {
  ownerId: string;
  conversationId: string;
  graphRevision: number;
  question: VNextQuestion;
  presentation: WeeklyPlanningVNextQuestionPresentation;
}): Promise<CandidateBasis> {
  const { question, graphRevision, presentation } = params;
  const questionId = await wireId([params.conversationId, question.key]);
  return {
    binding: {
      ownerId: params.ownerId,
      conversationId: params.conversationId,
      requestId: await wireId([params.conversationId, question.key, graphRevision]),
      inputRevision: graphRevision,
      graphRevision,
      sources: [],
      target: { kind: 'vnext_question_owner', id: await wireId([params.conversationId, question.ownerKey]) },
      scope: { questionCode: question.code },
      question: {
        id: questionId, code: question.code, presentingTurnId: questionId,
        presentingMessageId: questionId, presentationRevision: graphRevision,
        presentedQuestion: { assistantMessageId: questionId, text: presentation.text },
      },
      selectionEpoch: graphRevision,
    },
    // An option id names a work lineage (`keep:<lineage>`), so it is not bounded either; the tuple carries it.
    candidates: await Promise.all(question.options.map(async (option) => ({
      id: await wireId([option.optionId]),
      label: presentation.optionLabels[option.optionId],
      tuple: { optionId: option.optionId, value: option.value },
    }))),
  };
}

/**
 * Tries the closed-set route for a presented option question, then the full reading.
 * The full reading always receives the original input, so no clause of the reply is lost.
 */
export function createWeeklyPlanningVNextOptionChoiceInterpreter(params: {
  fullReading: WeeklyPlanningVNextInterpreter;
  choice: WeeklyPlanningVNextOptionChoicePort;
  scope: { ownerId: string; conversationId: string };
  onOutcome?: (outcome: WeeklyPlanningVNextOptionChoiceOutcome) => void;
}): WeeklyPlanningVNextInterpreter {
  return async (input) => {
    const question = input.presentedQuestion;
    const started = Date.now();
    let dispatched = 0;
    let evaluation: CandidateChoiceEvaluation | null = null;
    let semanticPolicy: CandidateSemanticGatePolicy | null = null;
    let choiceRequest: CandidateChoiceRequest | null = null;
    const diagnostic = (gateReason: string): WeeklyPlanningVNextOptionChoiceDiagnostic => {
      const sorted = evaluation?.probabilities.map(({ probability }) => probability).sort((a, b) => b - a);
      const margin = sorted && sorted.length > 1 ? sorted[0] - sorted[1] : null;
      const rule = choiceRequest && params.choice.policy.rules.find((entry) => entry.menuKind === choiceRequest!.menu.kind
        && entry.depth === choiceRequest!.menu.depth && entry.optionCount === choiceRequest!.menu.options.length);
      const extraMeaning: WeeklyPlanningVNextOptionChoiceDiagnostic['extraMeaning'] = [];
      if (evaluation && semanticPolicy) {
        if (evaluation.conditionChange > semanticPolicy.maximumConditionChange) extraMeaning.push('conditionChange');
        if (evaluation.independentMeaning > semanticPolicy.maximumIndependentMeaning) extraMeaning.push('independentMeaning');
      }
      return { questionKey: question!.key, graphRevision: input.state.graph.revision, policyId: params.choice.policy.id,
        gateReason, reason: gateReason === 'selected' || gateReason === 'none' || gateReason === 'extra_meaning' ? gateReason
          : gateReason === 'low_probability' && rule && sorted
            ? sorted[0] < rule.minimumTopProbability ? 'below_threshold' : 'margin'
            : gateReason === 'provider_error' || gateReason === 'invalid_response' ? 'schema_or_transport' : 'unavailable',
        probabilities: evaluation ? evaluation.probabilities.map((entry) => ({ ...entry })) : null,
        margin, conditionChange: evaluation?.conditionChange ?? null, independentMeaning: evaluation?.independentMeaning ?? null,
        extraMeaning };
    };
    const toFullReading = async (reason: string): Promise<WeeklyPlanningVNextInterpretation> => {
      params.onOutcome?.({ route: 'full_reading', reason });
      const reading = await params.fullReading(input);
      return { ...reading, metrics: { ...reading.metrics, calls: reading.metrics.calls + dispatched,
        latencyMs: Math.max(0, Date.now() - started), optionChoice: diagnostic(reason) } };
    };
    // Jev chooses only against the reply the user actually saw; without it, the full reading reads the words.
    if (!question || input.presentedText === null || !(VNEXT_OPTION_CHOICE_CODES as readonly string[]).includes(question.code)
      || question.options.length === 0) {
      return params.fullReading(input);
    }
    const basis = await vnextOptionChoiceBasis({ ...params.scope, graphRevision: input.state.graph.revision, question,
      presentation: { ...presentWeeklyPlanningVNextQuestion(input.state, question), text: input.presentedText } });
    const manifest = await createCandidateManifest(basis);
    const result = await selectApplicationCandidate({
      manifest,
      wholeUtterance: input.userText,
      policy: params.choice.policy,
      maximumChildrenPerMenu: question.options.length,
      maximumDecisions: 1,
      // The interpreter's input is fixed for this call; the binder re-checks freshness when applying.
      readCurrent: () => ({ ...basis, sourceAccess: 'allowed', intentProvenance: 'validated_current_turn',
        targetStatus: 'active', questionPresentation: 'fresh', formalEligibility: 'eligible' }),
      choose: (request, beforeDispatch) => {
        choiceRequest = request;
        return params.choice.choose(request, () => { dispatched += 1; beforeDispatch(); }, (value, policy) => {
          evaluation = structuredClone(value);
          semanticPolicy = { ...policy };
        });
      },
    });
    if (result.status !== 'staged') return toFullReading(result.reason);
    const optionId = String(result.selection.candidate.tuple.optionId);
    params.onOutcome?.({ route: 'option_choice', optionId });
    return {
      status: 'interpreted',
      delta: { add: [], patch: [], remove: [], relate: [], defer: [] },
      answer: { kind: 'option', optionId },
      metrics: { calls: dispatched, repairs: 0, latencyMs: Math.max(0, Date.now() - started), optionChoice: diagnostic('selected') },
    };
  };
}
