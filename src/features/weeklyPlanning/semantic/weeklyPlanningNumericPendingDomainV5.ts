import { numericPendingCompleteScopeV5 } from './weeklyPlanningNumericPendingScopeV5';
import { canonicalCandidateSerialization } from '../application/candidateSelection';
import { snapshotCandidateBasis } from '../application/candidateSelection/manifest';
import { freezeCandidateValue } from '../application/candidateSelection/canonical';
import type { CandidateBinding } from '../application/candidateSelection';
import { numericPendingBoundToInputV5, numericPendingCandidatesV5, tryNumericPendingChoiceRouteV5, type NumericPendingChoicePortV5, type NumericPendingStateV5 } from './weeklyPlanningNumericPendingChoiceV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import type { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

export interface NumericPendingPresentedQuestionV5 {
  readonly assistantMessageId: string;
  readonly text: string;
}
/** Local question-time record. It grants neither selection nor mutation authority. */
export interface NumericPendingQuestionDomainV5 {
  readonly version: 1;
  readonly domainMinutes: readonly number[];
  readonly domainPolicyVersion: string;
  readonly binding: Omit<CandidateBinding, 'requestId' | 'inputRevision'>;
  readonly measurement: NumericPendingStateV5['measurement'];
  readonly perUnit: string | null;
  readonly presentedQuestion: NumericPendingPresentedQuestionV5;
}

/** Called by the presenting commit; never creates a question ID or derives minutes from text. */
export function captureNumericPendingQuestionDomainV5(params: {
  readonly input: WeeklyPlanningSemanticNormalizerInputV5;
  readonly state: NumericPendingStateV5;
  readonly domainMinutes: readonly number[];
  readonly domainPolicyVersion: string;
  readonly presentedQuestion: NumericPendingPresentedQuestionV5 | null;
}): NumericPendingQuestionDomainV5 | null {
  try {
    const state = freezeCandidateValue(params.state) as unknown as NumericPendingStateV5;
    const graph = params.input.committedGraph;
    const shown = freezeCandidateValue(params.presentedQuestion) as unknown as NumericPendingPresentedQuestionV5 | null;
    const domain = freezeCandidateValue(params.domainMinutes) as unknown as readonly number[];
    const policy = params.domainPolicyVersion;
    if (!graph || !validateWeeklyPlanningFactGraphValueV5(graph).graph || !numericPendingBoundToInputV5(params.input, state)
      || typeof policy !== 'string' || !policy.trim() || new TextEncoder().encode(policy).length > 128
      || !shown || Object.keys(shown).length !== 2 || typeof shown.assistantMessageId !== 'string'
      || shown.assistantMessageId !== state.binding.question.presentingMessageId
      || typeof shown.text !== 'string' || !shown.text.trim() || new TextEncoder().encode(shown.text).length > 4000
      || state.binding.selectionEpoch < 1 || state.binding.question.presentationRevision !== state.binding.inputRevision
      || !state.binding.question.id || !state.binding.question.presentingTurnId
      || state.sourceAccess !== 'allowed' || state.intentProvenance !== 'validated_current_turn'
      || state.questionPresentation !== 'fresh' || state.targetStatus !== 'active' || state.formalEligibility !== 'eligible') return null;
    const boundMessage = (state.binding.question as typeof state.binding.question & {
      presentedQuestion?: NumericPendingPresentedQuestionV5;
    }).presentedQuestion;
    if (boundMessage && canonicalCandidateSerialization(boundMessage) !== canonicalCandidateSerialization(shown)) return null;
    // Reuse the finite-domain rules, including 254 complete leaves and exact positive safe integers.
    snapshotCandidateBasis({ binding: state.binding, candidates: numericPendingCandidatesV5(state, domain) });
    const target = graph.workloads.find(fact => fact.id === state.binding.target.id)!;
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    if (graph.workloads.filter(fact => active.has(fact.id)).length !== 1) return null;
    if (graph.effortEstimates.some(fact => fact.targetFactId === target.id && active.has(fact.id))) return null;
    const scope = numericPendingCompleteScopeV5(params.input);
    if (!scope) return null;
    const { requestId: _request, inputRevision: _inputRevision, ...binding } = state.binding;
    const record: NumericPendingQuestionDomainV5 = {
      version: 1, domainMinutes: domain, domainPolicyVersion: policy, binding: { ...binding, scope },
      measurement: state.measurement, perUnit: state.perUnit, presentedQuestion: shown,

    };
    if (new TextEncoder().encode(canonicalCandidateSerialization(record)).length > 32_768) return null;
    return freezeCandidateValue(record) as unknown as NumericPendingQuestionDomainV5;
  } catch { return null; }
}

/** Used at answer entry, after selection/auth awaits, and synchronous commit preparation. */
export function isNumericPendingQuestionDomainCurrentV5(
  snapshot: NumericPendingQuestionDomainV5 | null,
  current: Parameters<typeof captureNumericPendingQuestionDomainV5>[0],
): boolean {
  try {
    if (!snapshot) return false;
    const observed = captureNumericPendingQuestionDomainV5(current);
    return observed !== null && canonicalCandidateSerialization(snapshot) === canonicalCandidateSerialization(observed);
  } catch { return false; }
}

export interface FrozenNumericPendingChoicePortV5 extends NumericPendingChoicePortV5 {
  /** Shared registry supplies the actual currently bound message, never a renderer-text parser. */
  readPresentedQuestion(input: WeeklyPlanningSemanticNormalizerInputV5): NumericPendingPresentedQuestionV5 | null;
}

/** Existing D5 selector, guarded by the question-time domain at every live observation. */
export async function tryFrozenNumericPendingChoiceRouteV5(
  run: WeeklyPlanningSemanticNormalizerRunV5,
  port: FrozenNumericPendingChoicePortV5,
  snapshot: NumericPendingQuestionDomainV5 | null,
) {
  if (!snapshot) return null;
  const answer = run.input.userText;
  const guarded: NumericPendingChoicePortV5 = {
    ...port, domainMinutes: snapshot.domainMinutes, domainPolicyVersion: snapshot.domainPolicyVersion,
    readCurrent(input) {
      const state = port.readCurrent(input); const shown = port.readPresentedQuestion(input);
      if (!state || input.userText !== answer || !isNumericPendingQuestionDomainCurrentV5(snapshot, {
        input, state, domainMinutes: port.domainMinutes, domainPolicyVersion: port.domainPolicyVersion, presentedQuestion: shown,
      })) return null;
      // The new shared reader projects this exact bound text. An old reader fails closed,
      // rather than dropping the message and reviving the dormant legacy semantic path.
      const question = { ...state.binding.question, presentedQuestion: shown! };
      return { ...state, binding: { ...state.binding, scope: numericPendingCompleteScopeV5(input)!, question } };
    },
  };
  return tryNumericPendingChoiceRouteV5(run, guarded);
}
