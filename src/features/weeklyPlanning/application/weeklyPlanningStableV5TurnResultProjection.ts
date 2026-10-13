import { projectWeeklyPlanningStableV5TurnResultCore } from './weeklyPlanningStableV5TurnResultProjectionCore';
import { takeWeeklyPlanningStableV5FailureDiagnostics } from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
import { getAiConfig } from '../../../lib/aiConfig';
import { createAiWeeklyPlanningStableV5DialogueRenderer } from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import { getWeeklyPlanningStableV5RuntimeSession } from './weeklyPlanningStableV5RuntimeSession';
export const weeklyPlanningStableV5TurnResultProjector = {
  begin(traceRequestId: string) { takeWeeklyPlanningStableV5FailureDiagnostics(traceRequestId); },
  project(params: Parameters<typeof projectWeeklyPlanningStableV5TurnResultCore>[0]) {
    return projectWeeklyPlanningStableV5TurnResultCore(params, {
      takeFailure: takeWeeklyPlanningStableV5FailureDiagnostics,
      dialogue: {
        createRenderer: (options) => createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig(), undefined, options),
        getSession: getWeeklyPlanningStableV5RuntimeSession,
      },
    });
  },
} as const;
