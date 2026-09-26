import { isFocusedAuthorizationDecisionContext } from '../../../../../shared/focusedAuthorizationDecision';
import type { DecisionEvaluation, DecisionProvider } from '../decisionProvider';
import {
  gateOutcomeForEvaluation,
  summarizeFocusedAuthorizationEvaluation,
  type FocusedAuthorizationEvaluationMetrics,
  type GateOutcome,
} from './focusedAuthorizationEvaluationMetrics';
import type { FocusedAuthorizationSyntheticCandidate } from './focusedAuthorizationSyntheticCandidates';

export interface FocusedAuthorizationCaseVerdict {
  id: string;
  conversationGroupId: string;
  layer: FocusedAuthorizationSyntheticCandidate['layer'];
  split: FocusedAuthorizationSyntheticCandidate['split'];
  reviewStatus: FocusedAuthorizationSyntheticCandidate['reviewStatus'];
  expected: FocusedAuthorizationSyntheticCandidate['expected'];
  gateOutcome: GateOutcome | 'rejected_before_provider';
  acceptedDecision: FocusedAuthorizationSyntheticCandidate['expected'] | null;
  correct: boolean | null;
  falseAutoCreatePlan: boolean;
  preProviderRejectionReason: 'invalid_focused_authorization_context' | null;
  unavailableReason: string | null;
  latencyMs: number | null;
  reportedCostUsd: number | null;
}

export interface FocusedAuthorizationEvaluationReport {
  fixtureStatus: 'synthetic_unreviewed';
  cases: FocusedAuthorizationCaseVerdict[];
  metrics: FocusedAuthorizationEvaluationMetrics;
}

export async function evaluateFocusedAuthorizationCandidates(
  candidates: readonly FocusedAuthorizationSyntheticCandidate[],
  provider: DecisionProvider,
  onCase?: (verdict: FocusedAuthorizationCaseVerdict) => void,
): Promise<FocusedAuthorizationEvaluationReport> {
  const samples: Array<{ id: string; expected: FocusedAuthorizationSyntheticCandidate['expected']; evaluation: DecisionEvaluation }> = [];
  const verdicts: FocusedAuthorizationCaseVerdict[] = [];
  let rejectedBeforeProviderCount = 0;
  for (const value of candidates) {
    const context = {
      purpose: 'focused_authorization',
      requestId: `jev-shadow-evaluation:${value.id}`,
      inputRevision: 0,
      previousStatus: 'needs_scope',
      hasTasks: true,
      hasPendingQuestion: false,
      state: { currentUserText: value.currentUserText, lastAssistantMessage: value.lastAssistantMessage },
    } as const;
    if (!isFocusedAuthorizationDecisionContext(context)) {
      rejectedBeforeProviderCount += 1;
      const verdict: FocusedAuthorizationCaseVerdict = {
        id: value.id,
        conversationGroupId: value.conversationGroupId,
        layer: value.layer,
        split: value.split,
        reviewStatus: value.reviewStatus,
        expected: value.expected,
        gateOutcome: 'rejected_before_provider',
        acceptedDecision: null,
        correct: null,
        falseAutoCreatePlan: false,
        preProviderRejectionReason: 'invalid_focused_authorization_context',
        unavailableReason: null,
        latencyMs: null,
        reportedCostUsd: null,
      };
      verdicts.push(verdict);
      onCase?.(verdict);
      continue;
    }
    const evaluation = await provider.evaluate(context.state);
    samples.push({ id: value.id, expected: value.expected, evaluation });
    const gateOutcome = gateOutcomeForEvaluation(evaluation);
    const acceptedDecision = gateOutcome === 'accepted_create_plan' ? 'create_plan'
      : gateOutcome === 'accepted_fallback' ? 'fallback' : null;
    const verdict: FocusedAuthorizationCaseVerdict = {
      id: value.id,
      conversationGroupId: value.conversationGroupId,
      layer: value.layer,
      split: value.split,
      reviewStatus: value.reviewStatus,
      expected: value.expected,
      gateOutcome,
      acceptedDecision,
      correct: acceptedDecision === null ? null : acceptedDecision === value.expected,
      falseAutoCreatePlan: acceptedDecision === 'create_plan' && value.expected === 'fallback',
      preProviderRejectionReason: null,
      unavailableReason: evaluation.status === 'unavailable' ? evaluation.reason : null,
      latencyMs: evaluation.metadata.latencyMs,
      reportedCostUsd: evaluation.metadata.costUsd,
    };
    verdicts.push(verdict);
    onCase?.(verdict);
  }
  return {
    fixtureStatus: 'synthetic_unreviewed',
    cases: verdicts,
    metrics: summarizeFocusedAuthorizationEvaluation(samples, rejectedBeforeProviderCount),
  };
}
