import {
  beginDialogueRequest,
  createDialogueTurnEnvelope,
  transitionDialoguePhase,
  validateDialogueAsyncResult,
  type DialogueOrchestratorState,
  type DialogueTurnEnvelope,
  type StaleAsyncResult,
} from '../dialogue/weeklyPlanningDialogueOrchestrator';
import type { WeeklyPlanningBehaviorAwarePipelineOutput } from './weeklyPlanningBehaviorAwareIntakePipeline';

export type WeeklyPlanningDialogueTurnResult =
  | {
      accepted: true;
      orchestratorState: DialogueOrchestratorState;
      envelope: DialogueTurnEnvelope;
      output: WeeklyPlanningBehaviorAwarePipelineOutput;
    }
  | {
      accepted: false;
      orchestratorState: DialogueOrchestratorState;
      reason: 'active-request' | 'duplicate-opening' | 'invalid-envelope';
    }
  | {
      accepted: false;
      orchestratorState: DialogueOrchestratorState;
      stale: StaleAsyncResult;
    };

export async function runWeeklyPlanningDialogueTurn(params: {
  orchestratorState: DialogueOrchestratorState;
  conversationId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
  opening?: boolean;
  runPipeline(): Promise<WeeklyPlanningBehaviorAwarePipelineOutput>;
  currentStateRevision(): number;
  modeReset?: () => boolean;
  unmounted?: () => boolean;
}): Promise<WeeklyPlanningDialogueTurnResult> {
  const envelope = createDialogueTurnEnvelope({
    conversationId: params.conversationId,
    inputStateRevision: params.inputStateRevision,
    userText: params.userText,
    createdAt: params.createdAt,
    requestSequence: params.orchestratorState.requestSequence + 1,
  });
  const begin = beginDialogueRequest({
    state: params.orchestratorState,
    envelope,
    opening: params.opening,
  });
  if (!begin.accepted) {
    return {
      accepted: false,
      orchestratorState: begin.state,
      reason: begin.reason,
    };
  }

  let state = begin.state;
  const output = await params.runPipeline();
  const stale = validateDialogueAsyncResult({
    state,
    envelope,
    currentStateRevision: params.currentStateRevision(),
    modeReset: params.modeReset?.(),
    unmounted: params.unmounted?.(),
  });
  if (stale) {
    return { accepted: false, orchestratorState: state, stale };
  }

  state = transitionDialoguePhase(state, 'applying');
  state = transitionDialoguePhase(state, 'calculating');
  state = transitionDialoguePhase(state, 'planning_response');
  state = transitionDialoguePhase(state, 'validating_response');
  state = transitionDialoguePhase(state, 'rendering');
  state = transitionDialoguePhase(state, 'idle');

  return {
    accepted: true,
    orchestratorState: state,
    envelope,
    output,
  };
}
