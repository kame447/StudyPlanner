import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createSemanticTurnCensusScope, productionSemanticCensusOptions } from '../../productObservability/semanticTurnCensus';
import { projectSemanticCensusMetadata } from '../../../../shared/semanticTurnCensus';
import { readWeeklyPlanningPendingQuestionV5 } from '../semantic/weeklyPlanningPendingQuestionV5';
import type { WeeklyPlanningSemanticNormalizerV5, WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';

/** Only machine-state metadata; never reads utterance, graph labels or generated semantic content. */
export function weeklyPlanningSemanticCensusMetadata(input: WeeklyPlanningSemanticNormalizerInputV5) {
  const pending = readWeeklyPlanningPendingQuestionV5(input.publicStateSummary);
  return projectSemanticCensusMetadata({
    questionCode: pending?.questionCode ?? null,
    targetCount: pending ? pending.targetFactId ? 1 : 0 : null,
    freshness: pending && input.committedGraph ? pending.graphRevision === input.committedGraph.revision ? 'matched' : 'stale' : 'unknown',
    binding: 'unknown',
  });
}
export function createCensusObservedWeeklyPlanningNormalizer(
  client: OpenAiCompatibleClient,
  createNormalizer: (observedClient: OpenAiCompatibleClient) => WeeklyPlanningSemanticNormalizerV5,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(input) {
      const scope = createSemanticTurnCensusScope({ client, domain: 'weekly-planning', metadata: weeklyPlanningSemanticCensusMetadata(input), ...productionSemanticCensusOptions() });
      let resolution: 'success' | 'failure' = 'failure';
      try {
        const result = await createNormalizer(scope.client).normalize(input);
        resolution = result.status === 'accepted' ? 'success' : 'failure';
        return result;
      } finally { scope.finish(resolution); }
    },
  };
}
