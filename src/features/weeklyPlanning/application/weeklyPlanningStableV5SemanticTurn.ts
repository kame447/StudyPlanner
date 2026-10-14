import { getAiConfig, getAiConfigValidationMessage } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createCensusObservedWeeklyPlanningNormalizer } from '../trace/weeklyPlanningSemanticCensus';
import { getOrCreateWeeklyPlanningStableV5RuntimeSession } from './weeklyPlanningStableV5RuntimeSession';
import { userPlanningContextPromptSelectionV2 } from '../../userPlanningContext/userPlanningContextPromptSelectionV2';
import { recordWeeklyPlanningStableV5FailureDiagnostics } from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { executeWeeklyPlanningStableV5SemanticTurnCore } from './weeklyPlanningStableV5SemanticTurnCore';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
export type { WeeklyPlanningStableV5SemanticTurnResult } from './weeklyPlanningStableV5SemanticTurnCore';

export function executeWeeklyPlanningStableV5SemanticTurn(input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput) {
  const aiConfig = getAiConfig();
  const configError = getAiConfigValidationMessage(aiConfig);
  recordWeeklyPlanningStableV5DebugTrace({ requestId: input.traceRequestId,
    stage: 'runtime_configuration_evaluated', severity: aiConfig.provider === 'rules' || configError ? 'error' : 'info',
    data: { provider: aiConfig.provider, baseUrl: aiConfig.baseUrl, model: aiConfig.model, configError,
      criteria: { rulesProviderRejected: true, validConfigurationRequired: true } } });
  if (aiConfig.provider === 'rules' || configError) throw new Error(configError ?? 'Stable V5にはAI structured output接続が必要です。');
  return executeWeeklyPlanningStableV5SemanticTurnCore(input, {
    normalizer: createCensusObservedWeeklyPlanningNormalizer(
      input.semanticObservation?.client ?? createOpenAiCompatibleClient(aiConfig),
      createWeeklyPlanningSemanticNormalizerV5, input.semanticObservation,
    ),
    session: getOrCreateWeeklyPlanningStableV5RuntimeSession({ ownerId: input.userId, conversationId: input.conversationId }),
    selectContext: userPlanningContextPromptSelectionV2, recordFailure: recordWeeklyPlanningStableV5FailureDiagnostics,
  });
}
