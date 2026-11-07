// Lazy-loaded VNext runtime: everything a turn needs beyond the hook's light state (isolated turn
// execution, provider/option-choice interpreter, dialogue renderer, AI client). The entry chunk keeps
// only the hook; weeklyPlanningVNextRuntimeLoader.ts is the single dynamic import of this module.
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import { getAiConfig, getCloudflareAiProxyUrl } from '../../../../lib/aiConfig';
import { createWeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoiceBrowserPort';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY, VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';

export { executeIsolatedWeeklyPlanningVNextTurn } from './weeklyPlanningVNextIsolatedTurn';
// The persisted "saved" mark of confirmed study records lives with the session; the hook reaches it only through this lazy module.
export { markWeeklyPlanningVNextActualRecordsSaved } from './weeklyPlanningVNextExperimentalSession';

/** Frozen VNext dev calibration (luna-holdout-fallback-a25c9899); no V5 settings or retuning.
 * The native reader remains the complete fallback for both narrow Jev purposes.
 */
export const weeklyPlanningVNextRuntimeFactories = {
  client: (): WeeklyPlanningVNextExperimentalPorts['client'] => {
    if (!getCloudflareAiProxyUrl()) throw new Error('VNext requires the authenticated Worker proxy.');
    return createOpenAiCompatibleClient({ ...getAiConfig(), provider: 'openai' });
  },
  interpret: (scope: { ownerId: string; conversationId: string }): WeeklyPlanningVNextExperimentalPorts['interpret'] =>
    createWeeklyPlanningVNextRuntimeInterpreter(scope, { choice: createWeeklyPlanningVNextOptionChoicePort({
      policy: VNEXT_OPTION_CHOICE_POLICY, client: { semanticPolicy: VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } }) }),
  createRenderer: (client: WeeklyPlanningVNextExperimentalPorts['client'], options: { canDispatchRecovery: () => boolean }) =>
    createWeeklyPlanningStableV5DialogueRendererCore(client, options),
};
