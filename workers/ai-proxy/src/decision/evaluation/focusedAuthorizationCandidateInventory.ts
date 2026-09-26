import type { AuthorizationDecision } from '../decisionProvider';
import {
  FOCUSED_AUTHORIZATION_EVALUATION_LAYERS,
  FOCUSED_AUTHORIZATION_EVALUATION_SPLITS,
  validateFocusedAuthorizationSyntheticCandidates,
  type FocusedAuthorizationEvaluationLayer,
  type FocusedAuthorizationEvaluationSplit,
  type FocusedAuthorizationSyntheticCandidate,
} from './focusedAuthorizationSyntheticCandidates';

type ExpectedCounts = Record<AuthorizationDecision, number>;

export interface FocusedAuthorizationCandidateInventory {
  totalCandidateCount: number;
  countsBySplitExpected: Record<FocusedAuthorizationEvaluationSplit, ExpectedCounts>;
  countsByLayerSplitExpected: Record<
    FocusedAuthorizationEvaluationLayer,
    Record<FocusedAuthorizationEvaluationSplit, ExpectedCounts>
  >;
  conversationGroupsBySplit: Record<FocusedAuthorizationEvaluationSplit, {
    count: number;
    groupIds: string[];
  }>;
  duplicateCurrentUserTexts: Array<{
    currentUserText: string;
    candidateIds: string[];
  }>;
  reviewStatusDistribution: Record<FocusedAuthorizationSyntheticCandidate['reviewStatus'], number>;
}

function emptyExpectedCounts(): ExpectedCounts {
  return { create_plan: 0, fallback: 0 };
}

export function inventoryFocusedAuthorizationCandidates(
  candidates: readonly FocusedAuthorizationSyntheticCandidate[],
): FocusedAuthorizationCandidateInventory {
  validateFocusedAuthorizationSyntheticCandidates(candidates);
  const countsByLayerSplitExpected = Object.fromEntries(
    FOCUSED_AUTHORIZATION_EVALUATION_LAYERS.map((layer) => [layer, {
      tuning: emptyExpectedCounts(),
      holdout: emptyExpectedCounts(),
    }]),
  ) as Record<
    FocusedAuthorizationEvaluationLayer,
    Record<FocusedAuthorizationEvaluationSplit, ExpectedCounts>
  >;
  const conversationGroups = {
    tuning: new Set<string>(),
    holdout: new Set<string>(),
  };
  const countsBySplitExpected = {
    tuning: emptyExpectedCounts(),
    holdout: emptyExpectedCounts(),
  };
  const candidateIdsByCurrentUserText = new Map<string, string[]>();
  const reviewStatusDistribution = { synthetic_unreviewed: 0 };

  for (const value of candidates) {
    countsBySplitExpected[value.split][value.expected] += 1;
    countsByLayerSplitExpected[value.layer][value.split][value.expected] += 1;
    conversationGroups[value.split].add(value.conversationGroupId);
    const ids = candidateIdsByCurrentUserText.get(value.currentUserText) ?? [];
    ids.push(value.id);
    candidateIdsByCurrentUserText.set(value.currentUserText, ids);
    reviewStatusDistribution[value.reviewStatus] += 1;
  }

  return {
    totalCandidateCount: candidates.length,
    countsBySplitExpected,
    countsByLayerSplitExpected,
    conversationGroupsBySplit: Object.fromEntries(
      FOCUSED_AUTHORIZATION_EVALUATION_SPLITS.map((split) => [split, {
        count: conversationGroups[split].size,
        groupIds: [...conversationGroups[split]],
      }]),
    ) as FocusedAuthorizationCandidateInventory['conversationGroupsBySplit'],
    duplicateCurrentUserTexts: [...candidateIdsByCurrentUserText]
      .filter(([, candidateIds]) => candidateIds.length > 1)
      .map(([currentUserText, candidateIds]) => ({ currentUserText, candidateIds })),
    reviewStatusDistribution,
  };
}
