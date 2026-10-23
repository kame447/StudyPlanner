import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import { rememberWeeklyPlanningDialogueRendererPromptContext } from '../trace/weeklyPlanningDialogueRendererTrace';
import { createWeeklyPlanningStableV5DialogueRendererCore } from './weeklyPlanningStableV5AiDialogueRendererCore';
export {
  WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
} from './weeklyPlanningStableV5DialogueContracts';
export type {
  WeeklyPlanningStableV5DialogueActionKind,
  WeeklyPlanningStableV5DialogueConversationTurn,
  WeeklyPlanningStableV5DialogueFallbackReason,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
  WeeklyPlanningStableV5DialogueRenderer,
} from './weeklyPlanningStableV5DialogueContracts';
export {
  createWeeklyPlanningStableV5DialoguePrompt,
  createWeeklyPlanningStableV5DialogueStateSummary,
} from './weeklyPlanningStableV5DialoguePrompt';


export function createAiWeeklyPlanningStableV5DialogueRenderer(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
  options: { canDispatchRecovery?: () => boolean } = {},
) {
  return createWeeklyPlanningStableV5DialogueRendererCore(client, {
    ...options, rememberPrompt: rememberWeeklyPlanningDialogueRendererPromptContext,
  });
}
