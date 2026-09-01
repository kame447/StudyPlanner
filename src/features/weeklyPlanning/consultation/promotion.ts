import type {
  PromotionDisposition,
  PromotionRecommendation,
} from './contracts';

export type PromotionCoverageResult =
  | { promotable: true; dispositions: readonly PromotionDisposition[] }
  | { promotable: false; dispositions: readonly PromotionDisposition[]; reason: string };

export function evaluatePromotionCoverage(
  recommendations: readonly PromotionRecommendation[],
  dispositions: readonly PromotionDisposition[],
): PromotionCoverageResult {
  const recommendationKeys = new Set<string>();
  for (const recommendation of recommendations) {
    if (recommendationKeys.has(recommendation.recommendationKey)) {
      return { promotable: false, dispositions, reason: 'duplicate_recommendation_key' };
    }
    recommendationKeys.add(recommendation.recommendationKey);
  }

  const dispositionKeys = new Set<string>();
  for (const disposition of dispositions) {
    if (!recommendationKeys.has(disposition.recommendationKey)) {
      return { promotable: false, dispositions, reason: 'unknown_recommendation_disposition' };
    }
    if (dispositionKeys.has(disposition.recommendationKey)) {
      return { promotable: false, dispositions, reason: 'duplicate_recommendation_disposition' };
    }
    dispositionKeys.add(disposition.recommendationKey);
  }

  if (dispositionKeys.size !== recommendationKeys.size) {
    return { promotable: false, dispositions, reason: 'incomplete_promotion_coverage' };
  }

  for (const recommendation of recommendations) {
    const disposition = dispositions.find(
      (candidate) => candidate.recommendationKey === recommendation.recommendationKey,
    );
    if (!disposition) {
      return { promotable: false, dispositions, reason: 'incomplete_promotion_coverage' };
    }
    if (recommendation.planningRelevant && disposition.disposition === 'blocked') {
      return { promotable: false, dispositions, reason: 'planning_relevant_recommendation_blocked' };
    }
  }

  return { promotable: true, dispositions };
}
