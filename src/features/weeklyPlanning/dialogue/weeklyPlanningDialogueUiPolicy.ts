import {
  createDialogueTurnEnvelope,
  decideDialogueKeyboardAction,
  type DialogueKeyboardEventLike,
  type DialogueKeyboardDecision,
  type DialogueOrchestratorState,
  type DialogueRequestPhase,
  type DialogueTurnEnvelope,
} from './weeklyPlanningDialogueOrchestrator';

export const WEEKLY_DIALOGUE_TAB_ORDER = [
  'mode-chat',
  'mode-weekly-planning',
  'conversation-history',
  'message-input',
  'submit-button',
  'reset-button',
  'preview-list',
  'preview-approve-button',
] as const;

export type WeeklyDialogueControlId = typeof WEEKLY_DIALOGUE_TAB_ORDER[number];

export interface WeeklyDialogueSubmitPolicyInput {
  event: DialogueKeyboardEventLike;
  phase: DialogueRequestPhase;
  hasText: boolean;
}

export function decideWeeklyDialogueSubmit(
  input: WeeklyDialogueSubmitPolicyInput,
): DialogueKeyboardDecision {
  if (input.phase !== 'idle' || !input.hasText) return 'ignore';
  return decideDialogueKeyboardAction(input.event);
}

export function shouldRestoreWeeklyDialogueFocus(params: {
  previousPhase: DialogueRequestPhase;
  nextPhase: DialogueRequestPhase;
  mounted: boolean;
  modeActive: boolean;
}): boolean {
  return params.mounted
    && params.modeActive
    && params.previousPhase !== 'idle'
    && (params.nextPhase === 'idle' || params.nextPhase === 'failed');
}

export function validateWeeklyDialogueTabOrder(
  ids: readonly WeeklyDialogueControlId[],
): boolean {
  if (ids.length !== WEEKLY_DIALOGUE_TAB_ORDER.length) return false;
  if (new Set(ids).size !== ids.length) return false;
  return ids.every((id, index) => id === WEEKLY_DIALOGUE_TAB_ORDER[index]);
}

export function createRetryDialogueEnvelope(params: {
  state: DialogueOrchestratorState;
  previousEnvelope: DialogueTurnEnvelope;
  currentStateRevision: number;
  createdAt: string;
}): DialogueTurnEnvelope {
  return createDialogueTurnEnvelope({
    conversationId: params.previousEnvelope.conversationId,
    inputStateRevision: params.currentStateRevision,
    userText: params.previousEnvelope.userText,
    createdAt: params.createdAt,
    requestSequence: params.state.requestSequence + 1,
  });
}
