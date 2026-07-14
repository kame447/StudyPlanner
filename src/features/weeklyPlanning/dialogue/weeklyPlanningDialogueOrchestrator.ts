export type DialogueRequestPhase =
  | 'idle'
  | 'interpreting'
  | 'applying'
  | 'calculating'
  | 'planning_response'
  | 'validating_response'
  | 'rendering'
  | 'failed';

export interface DialogueTurnEnvelope {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
}

export type StaleAsyncResultReason =
  | 'request_id_mismatch'
  | 'turn_id_mismatch'
  | 'conversation_id_mismatch'
  | 'state_revision_mismatch'
  | 'cancelled'
  | 'mode_reset'
  | 'unmounted';

export interface StaleAsyncResult {
  kind: 'stale_async_result';
  reason: StaleAsyncResultReason;
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
}

export interface DialogueOrchestratorState {
  phase: DialogueRequestPhase;
  activeEnvelope?: DialogueTurnEnvelope;
  openingCompleted: boolean;
  cancelledRequestIds: string[];
  requestSequence: number;
  lastFailure?: string;
}

export type BeginDialogueRequestResult =
  | { accepted: true; state: DialogueOrchestratorState; envelope: DialogueTurnEnvelope }
  | { accepted: false; state: DialogueOrchestratorState; reason: 'active-request' | 'duplicate-opening' | 'invalid-envelope' };

const PHASE_TRANSITIONS: Record<DialogueRequestPhase, readonly DialogueRequestPhase[]> = {
  idle: ['interpreting'],
  interpreting: ['applying', 'failed'],
  applying: ['calculating', 'failed'],
  calculating: ['planning_response', 'failed'],
  planning_response: ['validating_response', 'failed'],
  validating_response: ['rendering', 'failed'],
  rendering: ['idle', 'failed'],
  failed: ['idle', 'interpreting'],
};

function validIdentifier(value: string): boolean {
  return value.trim().length > 0 && value.length <= 200;
}

function cloneEnvelope(envelope: DialogueTurnEnvelope): DialogueTurnEnvelope {
  return { ...envelope };
}

export function createDialogueOrchestratorState(): DialogueOrchestratorState {
  return {
    phase: 'idle',
    openingCompleted: false,
    cancelledRequestIds: [],
    requestSequence: 0,
  };
}

export function createDialogueTurnEnvelope(params: {
  conversationId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
  requestSequence: number;
}): DialogueTurnEnvelope {
  const sequence = Math.max(1, Math.trunc(params.requestSequence));
  return {
    conversationId: params.conversationId,
    turnId: `${params.conversationId}:turn:${sequence}`,
    requestId: `${params.conversationId}:request:${sequence}`,
    inputStateRevision: params.inputStateRevision,
    userText: params.userText,
    createdAt: params.createdAt,
  };
}

export function beginDialogueRequest(params: {
  state: DialogueOrchestratorState;
  envelope: DialogueTurnEnvelope;
  opening?: boolean;
}): BeginDialogueRequestResult {
  const envelope = params.envelope;
  if (!validIdentifier(envelope.conversationId)
    || !validIdentifier(envelope.turnId)
    || !validIdentifier(envelope.requestId)
    || !Number.isInteger(envelope.inputStateRevision)
    || envelope.inputStateRevision < 0
    || !envelope.createdAt.trim()) {
    return { accepted: false, state: params.state, reason: 'invalid-envelope' };
  }
  if (params.state.activeEnvelope || params.state.phase !== 'idle') {
    return { accepted: false, state: params.state, reason: 'active-request' };
  }
  if (params.opening && params.state.openingCompleted) {
    return { accepted: false, state: params.state, reason: 'duplicate-opening' };
  }

  return {
    accepted: true,
    envelope: cloneEnvelope(envelope),
    state: {
      ...params.state,
      phase: 'interpreting',
      activeEnvelope: cloneEnvelope(envelope),
      openingCompleted: params.state.openingCompleted || Boolean(params.opening),
      requestSequence: params.state.requestSequence + 1,
      lastFailure: undefined,
    },
  };
}

export function transitionDialoguePhase(
  state: DialogueOrchestratorState,
  nextPhase: DialogueRequestPhase,
): DialogueOrchestratorState {
  if (!PHASE_TRANSITIONS[state.phase].includes(nextPhase)) {
    return state;
  }
  if (nextPhase === 'idle') {
    return { ...state, phase: 'idle', activeEnvelope: undefined, lastFailure: undefined };
  }
  return { ...state, phase: nextPhase };
}

export function failDialogueRequest(
  state: DialogueOrchestratorState,
  failureCode: string,
): DialogueOrchestratorState {
  return {
    ...state,
    phase: 'failed',
    lastFailure: failureCode.trim().slice(0, 200) || 'unknown-failure',
  };
}

export function cancelDialogueRequest(
  state: DialogueOrchestratorState,
): DialogueOrchestratorState {
  const requestId = state.activeEnvelope?.requestId;
  return {
    ...state,
    phase: 'idle',
    activeEnvelope: undefined,
    cancelledRequestIds: requestId
      ? Array.from(new Set([...state.cancelledRequestIds, requestId])).slice(-32)
      : [...state.cancelledRequestIds],
  };
}

export function resetDialogueOrchestrator(
  state: DialogueOrchestratorState,
): DialogueOrchestratorState {
  const cancelled = state.activeEnvelope?.requestId
    ? Array.from(new Set([...state.cancelledRequestIds, state.activeEnvelope.requestId])).slice(-32)
    : [...state.cancelledRequestIds];
  return {
    phase: 'idle',
    openingCompleted: false,
    cancelledRequestIds: cancelled,
    requestSequence: state.requestSequence,
  };
}

export function validateDialogueAsyncResult(params: {
  state: DialogueOrchestratorState;
  envelope: DialogueTurnEnvelope;
  currentStateRevision: number;
  modeReset?: boolean;
  unmounted?: boolean;
}): StaleAsyncResult | null {
  const active = params.state.activeEnvelope;
  let reason: StaleAsyncResultReason | null = null;
  if (params.unmounted) reason = 'unmounted';
  else if (params.modeReset) reason = 'mode_reset';
  else if (params.state.cancelledRequestIds.includes(params.envelope.requestId)) reason = 'cancelled';
  else if (!active || active.requestId !== params.envelope.requestId) reason = 'request_id_mismatch';
  else if (active.turnId !== params.envelope.turnId) reason = 'turn_id_mismatch';
  else if (active.conversationId !== params.envelope.conversationId) reason = 'conversation_id_mismatch';
  else if (params.envelope.inputStateRevision !== params.currentStateRevision) reason = 'state_revision_mismatch';

  return reason
    ? {
        kind: 'stale_async_result',
        reason,
        conversationId: params.envelope.conversationId,
        turnId: params.envelope.turnId,
        requestId: params.envelope.requestId,
        inputStateRevision: params.envelope.inputStateRevision,
      }
    : null;
}

export function dialogueCallBudget(kind: 'opening' | 'normal'): number {
  return kind === 'opening' ? 1 : 2;
}

export function canIssueDialogueCall(params: {
  kind: 'opening' | 'normal';
  issuedCalls: number;
}): boolean {
  return Number.isInteger(params.issuedCalls)
    && params.issuedCalls >= 0
    && params.issuedCalls < dialogueCallBudget(params.kind);
}

export interface DialogueKeyboardEventLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export type DialogueKeyboardDecision = 'submit' | 'newline' | 'ignore';

export function decideDialogueKeyboardAction(
  event: DialogueKeyboardEventLike,
): DialogueKeyboardDecision {
  if (event.isComposing) return 'ignore';
  if (event.key !== 'Enter') return 'ignore';
  if (event.ctrlKey || event.metaKey) return 'submit';
  return 'newline';
}
