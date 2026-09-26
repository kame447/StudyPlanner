import { isFocusedAuthorizationDecisionContext } from '../../../../../shared/focusedAuthorizationDecision';
import type { DecisionEvaluation, DecisionProvider } from '../decisionProvider';
import { JEV_CATALOG_VERSION, JEV_GATE_VERSION } from '../decisionPolicy';
import {
  gateOutcomeForEvaluation,
  summarizeFocusedAuthorizationEvaluation,
  type FocusedAuthorizationEvaluationSample,
  type FocusedAuthorizationEvaluationMetrics,
  type GateOutcome,
} from './focusedAuthorizationEvaluationMetrics';
import {
  FOCUSED_AUTHORIZATION_EVALUATION_LAYERS,
  FOCUSED_AUTHORIZATION_SYNTHETIC_FIXTURE_SET_VERSION,
  type FocusedAuthorizationEvaluationLayer,
  type FocusedAuthorizationEvaluationSplit,
  type FocusedAuthorizationSyntheticCandidate,
} from './focusedAuthorizationSyntheticCandidates';

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
  choice: FocusedAuthorizationSyntheticCandidate['expected'] | null;
  confidence: number | null;
  probabilities: Record<FocusedAuthorizationSyntheticCandidate['expected'], number> | null;
  conditionChange: number | null;
  independentMeaning: number | null;
  requestedModel: string | null;
  servedModel: string | null;
}

export interface FocusedAuthorizationSegmentedMetrics {
  global: FocusedAuthorizationEvaluationMetrics;
  bySplit: Record<FocusedAuthorizationEvaluationSplit, FocusedAuthorizationEvaluationMetrics>;
  byLayer: Record<FocusedAuthorizationEvaluationLayer, FocusedAuthorizationEvaluationMetrics>;
}

export interface FocusedAuthorizationEvaluationReport {
  fixtureStatus: 'synthetic_unreviewed';
  fixtureSetVersion: typeof FOCUSED_AUTHORIZATION_SYNTHETIC_FIXTURE_SET_VERSION;
  catalogVersion: typeof JEV_CATALOG_VERSION;
  gateVersion: typeof JEV_GATE_VERSION;
  cases: FocusedAuthorizationCaseVerdict[];
  metrics: FocusedAuthorizationSegmentedMetrics;
}

export async function evaluateFocusedAuthorizationCandidates(
  candidates: readonly FocusedAuthorizationSyntheticCandidate[],
  provider: DecisionProvider,
  onCase?: (verdict: FocusedAuthorizationCaseVerdict) => void,
): Promise<FocusedAuthorizationEvaluationReport> {
  type TaggedSample = FocusedAuthorizationEvaluationSample & {
    layer: FocusedAuthorizationEvaluationLayer;
    split: FocusedAuthorizationEvaluationSplit;
  };
  const samples: TaggedSample[] = [];
  const rejectedCandidates: FocusedAuthorizationSyntheticCandidate[] = [];
  const verdicts: FocusedAuthorizationCaseVerdict[] = [];
  for (const value of candidates) {
    const context = {
      purpose: 'focused_authorization',
      requestId: `jev-shadow-evaluation:${value.id}`,
      inputRevision: 0,
      previousStatus: 'needs_scope',
      hasTasks: true,
      // Assistant confirmation prose is conversation data, not the typed
      // pendingQuestion flag. Fixtures assume deterministic eligibility passed.
      hasPendingQuestion: false,
      state: { currentUserText: value.currentUserText, lastAssistantMessage: value.lastAssistantMessage },
    } as const;
    if (!isFocusedAuthorizationDecisionContext(context)) {
      rejectedCandidates.push(value);
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
        choice: null,
        confidence: null,
        probabilities: null,
        conditionChange: null,
        independentMeaning: null,
        requestedModel: null,
        servedModel: null,
      };
      verdicts.push(verdict);
      onCase?.(verdict);
      continue;
    }
    const evaluation = await provider.evaluate(context.state);
    samples.push({
      id: value.id, expected: value.expected, evaluation,
      layer: value.layer, split: value.split,
    });
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
      choice: evaluation.status === 'evaluated' ? evaluation.decision : null,
      confidence: evaluation.status === 'evaluated' ? evaluation.confidence : null,
      probabilities: evaluation.status === 'evaluated' ? evaluation.probabilities : null,
      conditionChange: evaluation.status === 'evaluated' ? evaluation.conditionChange : null,
      independentMeaning: evaluation.status === 'evaluated' ? evaluation.independentMeaning : null,
      requestedModel: evaluation.metadata.requestedModel,
      servedModel: evaluation.metadata.servedModel,
    };
    verdicts.push(verdict);
    onCase?.(verdict);
  }
  const summarizeSegment = (
    predicate: (value: { layer: FocusedAuthorizationEvaluationLayer; split: FocusedAuthorizationEvaluationSplit }) => boolean,
  ) => summarizeFocusedAuthorizationEvaluation(
    samples.filter(predicate),
    rejectedCandidates.filter(predicate).length,
  );
  const bySplit: FocusedAuthorizationSegmentedMetrics['bySplit'] = {
    tuning: summarizeSegment((value) => value.split === 'tuning'),
    holdout: summarizeSegment((value) => value.split === 'holdout'),
  };
  const byLayer = Object.fromEntries(FOCUSED_AUTHORIZATION_EVALUATION_LAYERS.map((layer) => [
    layer,
    summarizeSegment((value) => value.layer === layer),
  ])) as unknown as FocusedAuthorizationSegmentedMetrics['byLayer'];
  return {
    fixtureStatus: 'synthetic_unreviewed',
    fixtureSetVersion: FOCUSED_AUTHORIZATION_SYNTHETIC_FIXTURE_SET_VERSION,
    catalogVersion: JEV_CATALOG_VERSION,
    gateVersion: JEV_GATE_VERSION,
    cases: verdicts,
    metrics: {
      global: summarizeFocusedAuthorizationEvaluation(samples, rejectedCandidates.length),
      bySplit,
      byLayer,
    },
  };
}
