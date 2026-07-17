import { createDialogueTurnEnvelope } from './dialogue/weeklyPlanningDialogueOrchestrator';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PlanningState,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
  WeeklyPlanningPendingTurn,
} from './types';
import type { WeeklyPlanningTurnSubmissionResult } from './weeklyPlanningTurnExecutor';

export interface WeeklyPlanningControllerSession {
  ownerId: string;
  conversationId: string;
  weekStartDate: string;
  requestSequence: number;
}

export interface WeeklyPlanningControlledTurnResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
}

export interface SubmitWeeklyPlanningControlledTurnParams {
  session: WeeklyPlanningControllerSession;
  ownerId: string;
  userText: string;
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
  execute(params: {
    snapshot: PlanningState;
    pending: WeeklyPlanningPendingTurn;
    userText: string;
  }): Promise<WeeklyPlanningControlledTurnResult>;
  now?: () => string;
}

function createIdentity(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWeeklyPlanningControllerSession(
  ownerId: string,
  weekStartDate: string,
  conversationId = createIdentity('weekly-conversation'),
): WeeklyPlanningControllerSession {
  return { ownerId, conversationId, weekStartDate, requestSequence: 0 };
}

export function resetWeeklyPlanningControllerSession(
  session: WeeklyPlanningControllerSession,
  ownerId: string,
  weekStartDate: string,
  conversationId = createIdentity('weekly-conversation'),
): void {
  session.ownerId = ownerId;
  session.conversationId = conversationId;
  session.weekStartDate = weekStartDate;
  session.requestSequence = 0;
}

function ensureSessionScope(
  session: WeeklyPlanningControllerSession,
  ownerId: string,
  weekStartDate: string,
): void {
  if (session.ownerId !== ownerId || session.weekStartDate !== weekStartDate) {
    resetWeeklyPlanningControllerSession(session, ownerId, weekStartDate);
  }
}

export function isSameWeeklyPlanningPendingTurn(
  current: WeeklyPlanningPendingTurn | undefined,
  expected: WeeklyPlanningPendingTurn,
): boolean {
  return Boolean(
    current
      && current.conversationId === expected.conversationId
      && current.turnId === expected.turnId
      && current.requestId === expected.requestId
      && current.weekStartDate === expected.weekStartDate
      && current.baseRevision === expected.baseRevision,
  );
}

function createTurnMessage(
  envelope: { turnId: string },
  role: WeeklyPlanningMessage['role'],
  content: string,
  createdAt: string,
): WeeklyPlanningMessage {
  return {
    id: `${envelope.turnId}:${role}`,
    role,
    content,
    createdAt,
  };
}

export async function submitWeeklyPlanningControlledTurn(
  params: SubmitWeeklyPlanningControlledTurnParams,
): Promise<WeeklyPlanningTurnSubmissionResult> {
  const userText = params.userText.trim();
  const snapshot = params.getState();
  if (!userText || snapshot.pendingTurn || snapshot.pendingApproval) {
    return { accepted: false, draftCandidates: [] };
  }

  ensureSessionScope(params.session, params.ownerId, snapshot.weekStartDate);
  params.session.requestSequence += 1;
  const now = params.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const envelope = createDialogueTurnEnvelope({
    conversationId: params.session.conversationId,
    inputStateRevision: snapshot.revision,
    userText,
    createdAt,
    requestSequence: params.session.requestSequence,
  });
  const pending: WeeklyPlanningPendingTurn = {
    conversationId: envelope.conversationId,
    turnId: envelope.turnId,
    requestId: envelope.requestId,
    weekStartDate: snapshot.weekStartDate,
    baseRevision: snapshot.revision,
    startedAt: createdAt,
  };
  const begun = params.dispatch({
    type: 'begin_turn',
    pending,
    userMessage: createTurnMessage(envelope, 'user', userText, createdAt),
  });
  if (!isSameWeeklyPlanningPendingTurn(begun.pendingTurn, pending)) {
    return { accepted: false, draftCandidates: [] };
  }

  try {
    const result = await params.execute({ snapshot, pending, userText });
    if (!isSameWeeklyPlanningPendingTurn(params.getState().pendingTurn, pending)) {
      return { accepted: false, draftCandidates: [] };
    }
    const assistantMessage = createTurnMessage(
      envelope,
      'assistant',
      result.message,
      now(),
    );
    const committed = params.dispatch({
      type: 'commit_turn',
      pending,
      intakeState: result.state,
      assistantMessage,
      draftCandidates: result.draftCandidates,
    });
    const accepted = committed.pendingTurn === undefined
      && committed.weekStartDate === pending.weekStartDate
      && committed.revision === pending.baseRevision + 2;
    return {
      accepted,
      draftCandidates: accepted ? result.draftCandidates : [],
    };
  } catch (error) {
    if (!isSameWeeklyPlanningPendingTurn(params.getState().pendingTurn, pending)) {
      return { accepted: false, draftCandidates: [] };
    }
    const message = '週間計画の会話状態を更新できませんでした。';
    params.dispatch({
      type: 'fail_turn',
      pending,
      assistantMessage: createTurnMessage(envelope, 'assistant', message, now()),
    });
    throw error instanceof Error ? error : new Error(message);
  }
}

export function cancelWeeklyPlanningControlledTurn(params: {
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
}): boolean {
  const pending = params.getState().pendingTurn;
  if (!pending) return false;
  const next = params.dispatch({ type: 'cancel_turn', pending });
  return next.pendingTurn === undefined;
}

export function clearWeeklyPlanningControlledConversation(params: {
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
}): boolean {
  const current = params.getState();
  if (current.pendingTurn || current.pendingApproval) return false;
  const next = params.dispatch({ type: 'clear_conversation' });
  return next !== current;
}

export function resetWeeklyPlanningControlledSession(params: {
  session: WeeklyPlanningControllerSession;
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
  ownerId: string;
  conversationId?: string;
}): PlanningState {
  const current = params.getState();
  resetWeeklyPlanningControllerSession(
    params.session,
    params.ownerId,
    current.weekStartDate,
    params.conversationId,
  );
  return params.dispatch({ type: 'reset_session' });
}
