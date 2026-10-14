import { getAiConfig } from '../../../lib/aiConfig';
import { getWeeklyPlanningStableV5RuntimeSession } from '../application/weeklyPlanningStableV5RuntimeSession';
import { createAiWeeklyPlanningStableV5DialogueRenderer } from './weeklyPlanningStableV5AiDialogueRenderer';
import { renderWeeklyPlanningStableV5AssistantMessageCore, renderWeeklyPlanningStableV5RecoveryMessageCore,
  type WeeklyPlanningTurnDialoguePorts } from './weeklyPlanningStableV5TurnDialogueCore';
export { createWeeklyPlanningSystemDialogueRendererTrace, WEEKLY_PLANNING_RECOVERY_TECHNICAL_STOP,
  isWeeklyPlanningStableV5SystemResult, fallbackTextForStableV5TypedIntent } from './weeklyPlanningStableV5TurnDialogueCore';
const ports: WeeklyPlanningTurnDialoguePorts = {
  createRenderer: (options) => createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig(), undefined, options),
  getSession: getWeeklyPlanningStableV5RuntimeSession,
};
export function renderWeeklyPlanningStableV5AssistantMessage(params: Parameters<typeof renderWeeklyPlanningStableV5AssistantMessageCore>[0]) {
  return renderWeeklyPlanningStableV5AssistantMessageCore(params, ports);
}
export function renderWeeklyPlanningStableV5RecoveryMessage(params: Parameters<typeof renderWeeklyPlanningStableV5RecoveryMessageCore>[0]) {
  return renderWeeklyPlanningStableV5RecoveryMessageCore(params, ports);
}
