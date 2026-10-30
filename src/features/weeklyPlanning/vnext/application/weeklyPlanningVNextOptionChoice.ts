// A presented VNext question whose answer is one of its own options is a closed
// set. Such a reply may be chosen by the existing candidate-choice route (Jev)
// instead of the full reading. The menu is only that question's options plus
// `none`; the existing selection machinery owns the manifest, hash, freshness,
// calibrated gate and decision limit. A selection becomes `{ kind: 'option' }`
// for the existing binder and nothing else: no fact, save or mutation authority.
// Every other outcome (none, not selected, unavailable, low probability, extra
// meaning, stale, any other question) sends the whole utterance, unchanged, to
// the full reading.
import {
  createCandidateManifest,
  selectApplicationCandidate,
  type CalibratedChoicePolicy,
  type CandidateBasis,
  type CandidateChoiceRequest,
} from '../../application/candidateSelection';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpreter,
} from '../weeklyPlanningVNextInterpretationContract';
import type { VNextQuestion, VNextQuestionCode } from '../weeklyPlanningVNextTypes';

/** The VNext questions whose options are the complete answer set. Every other code asks for an open value. */
export const VNEXT_OPTION_CHOICE_CODES = ['remaining_inconsistent', 'same_or_distinct_work'] as const satisfies readonly VNextQuestionCode[];

export interface WeeklyPlanningVNextOptionChoicePort {
  /** Calibrated per menu shape; an uncalibrated menu is never chosen from. */
  policy: CalibratedChoicePolicy;
  choose(request: CandidateChoiceRequest, beforeDispatch: () => void): Promise<unknown>;
}

export type WeeklyPlanningVNextOptionChoiceOutcome =
  | { route: 'option_choice'; optionId: string }
  | { route: 'full_reading'; reason: string };

const OPTION_LABELS: Record<string, (value: number) => string> = {
  remaining_follows_progress: (value) => `残りを進捗から計算した ${value} にする`,
  completed_follows_remaining: (value) => `完了を残りに合わせて ${value} にする`,
  distinct: () => '別々の作業として両方を予定する',
  same: () => '同じ作業として一つにまとめる',
};

function optionLabel(optionId: string, value: number): string {
  if (optionId.startsWith('keep:')) return `量 ${value} の方だけを残し、もう一方を取り消す`;
  return OPTION_LABELS[optionId]?.(value) ?? optionId;
}

/** The selection basis: the presented question's own options at the current revision. */
export function vnextOptionChoiceBasis(params: {
  ownerId: string;
  conversationId: string;
  graphRevision: number;
  question: VNextQuestion;
}): CandidateBasis {
  const { question, graphRevision } = params;
  return {
    binding: {
      ownerId: params.ownerId,
      conversationId: params.conversationId,
      requestId: `${params.conversationId}:${question.key}:${graphRevision}`,
      inputRevision: graphRevision,
      graphRevision,
      sources: [],
      target: { kind: 'vnext_question_owner', id: question.ownerKey },
      scope: { questionCode: question.code },
      question: {
        id: question.key, code: question.code, presentingTurnId: question.key,
        presentingMessageId: question.key, presentationRevision: graphRevision,
      },
      selectionEpoch: graphRevision,
    },
    candidates: question.options.map((option) => ({
      id: option.optionId,
      label: optionLabel(option.optionId, option.value),
      tuple: { optionId: option.optionId, value: option.value },
    })),
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
    const toFullReading = async (reason: string): Promise<WeeklyPlanningVNextInterpretation> => {
      params.onOutcome?.({ route: 'full_reading', reason });
      const reading = await params.fullReading(input);
      return { ...reading, metrics: { ...reading.metrics, calls: reading.metrics.calls + dispatched,
        latencyMs: Math.max(0, Date.now() - started) } };
    };
    if (!question || !(VNEXT_OPTION_CHOICE_CODES as readonly string[]).includes(question.code) || question.options.length === 0) {
      return params.fullReading(input);
    }
    const basis = vnextOptionChoiceBasis({ ...params.scope, graphRevision: input.state.graph.revision, question });
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
      choose: (request, beforeDispatch) => params.choice.choose(request, () => { dispatched += 1; beforeDispatch(); }),
    });
    if (result.status !== 'staged') return toFullReading(result.reason);
    const optionId = result.selection.candidate.id;
    params.onOutcome?.({ route: 'option_choice', optionId });
    return {
      status: 'interpreted',
      delta: { add: [], patch: [], remove: [], relate: [], defer: [] },
      answer: { kind: 'option', optionId },
      metrics: { calls: dispatched, repairs: 0, latencyMs: Math.max(0, Date.now() - started) },
    };
  };
}
