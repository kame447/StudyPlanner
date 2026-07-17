from pathlib import Path

ROOT = Path('.')


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


controller = ROOT / 'src/features/weeklyPlanning/weeklyPlanningTurnController.ts'
controller.write_text("""import { createDialogueTurnEnvelope } from './dialogue/weeklyPlanningDialogueOrchestrator';
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
  weekStartDate: string,
  conversationId = createIdentity('weekly-conversation'),
): WeeklyPlanningControllerSession {
  return { conversationId, weekStartDate, requestSequence: 0 };
}

export function resetWeeklyPlanningControllerSession(
  session: WeeklyPlanningControllerSession,
  weekStartDate: string,
  conversationId = createIdentity('weekly-conversation'),
): void {
  session.conversationId = conversationId;
  session.weekStartDate = weekStartDate;
  session.requestSequence = 0;
}

function ensureSessionWeek(
  session: WeeklyPlanningControllerSession,
  weekStartDate: string,
): void {
  if (session.weekStartDate !== weekStartDate) {
    resetWeeklyPlanningControllerSession(session, weekStartDate);
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
  envelope: { conversationId: string; turnId: string },
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

  ensureSessionWeek(params.session, snapshot.weekStartDate);
  params.session.requestSequence += 1;
  const createdAt = (params.now ?? (() => new Date().toISOString()))();
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
      (params.now ?? (() => new Date().toISOString()))(),
    );
    const committed = params.dispatch({
      type: 'commit_turn',
      pending,
      intakeState: result.state,
      assistantMessage,
      draftCandidates: result.draftCandidates,
    });
    const accepted = committed.messages.some((message) => message.id === assistantMessage.id)
      && committed.pendingTurn === undefined
      && committed.weekStartDate === pending.weekStartDate;
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
      assistantMessage: createTurnMessage(
        envelope,
        'assistant',
        message,
        (params.now ?? (() => new Date().toISOString()))(),
      ),
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
  conversationId?: string;
}): PlanningState {
  const current = params.getState();
  resetWeeklyPlanningControllerSession(
    params.session,
    current.weekStartDate,
    params.conversationId,
  );
  return params.dispatch({ type: 'reset_session' });
}
""", encoding='utf-8')

controller_test = ROOT / 'src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts'
controller_test.write_text("""import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { PlanningState, WeeklyPlanningAction } from './types';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import {
  cancelWeeklyPlanningControlledTurn,
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  resetWeeklyPlanningControlledSession,
  submitWeeklyPlanningControlledTurn,
} from './weeklyPlanningTurnController';

function harness() {
  let state = createInitialPlanningState('2026-07-13');
  return {
    getState: () => state,
    dispatch: (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const result = {
  state: createInitialPlanningIntakeState(),
  message: '確認しました。',
  draftCandidates: [],
};

describe('weeklyPlanningTurnController', () => {
  it('creates one envelope with conversation, turn, request, revision and week identity', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession('2026-07-13', 'conversation-1');
    let captured: Parameters<Parameters<typeof submitWeeklyPlanningControlledTurn>[0]['execute']>[0] | undefined;
    const submission = await submitWeeklyPlanningControlledTurn({
      session,
      userText: '来週の予定を作りたい',
      getState: store.getState,
      dispatch: store.dispatch,
      now: () => '2026-07-17T10:00:00.000Z',
      async execute(input) {
        captured = input;
        return result;
      },
    });

    expect(submission.accepted).toBe(true);
    expect(captured?.pending).toMatchObject({
      conversationId: 'conversation-1',
      turnId: 'conversation-1:turn:1',
      requestId: 'conversation-1:request:1',
      weekStartDate: '2026-07-13',
      baseRevision: 0,
    });
    expect(store.getState().messages.map((message) => message.id)).toEqual([
      'conversation-1:turn:1:user',
      'conversation-1:turn:1:assistant',
    ]);
  });

  it('rejects a second active submission and silently discards a cancelled result', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession('2026-07-13', 'conversation-1');
    const pendingResult = deferred<typeof result>();
    const first = submitWeeklyPlanningControlledTurn({
      session,
      userText: '来週の予定を作りたい',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: () => pendingResult.promise,
    });
    const second = await submitWeeklyPlanningControlledTurn({
      session,
      userText: '二重送信',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: async () => result,
    });
    expect(second.accepted).toBe(false);
    expect(cancelWeeklyPlanningControlledTurn(store)).toBe(true);
    pendingResult.resolve(result);
    await expect(first).resolves.toEqual({ accepted: false, draftCandidates: [] });
    expect(store.getState().messages).toHaveLength(1);
    expect(store.getState().messages[0].role).toBe('user');
  });

  it('reset invalidates the current result and retry uses new conversation and turn identities', async () => {
    const store = harness();
    const session = createWeeklyPlanningControllerSession('2026-07-13', 'conversation-1');
    const pendingResult = deferred<typeof result>();
    const first = submitWeeklyPlanningControlledTurn({
      session,
      userText: '最初の送信',
      getState: store.getState,
      dispatch: store.dispatch,
      execute: () => pendingResult.promise,
    });
    const reset = resetWeeklyPlanningControlledSession({
      session,
      ...store,
      conversationId: 'conversation-2',
    });
    expect(reset.pendingTurn).toBeUndefined();
    expect(reset.messages).toEqual([]);
    pendingResult.resolve(result);
    await expect(first).resolves.toEqual({ accepted: false, draftCandidates: [] });

    let retryPending: PlanningState['pendingTurn'];
    const retry = await submitWeeklyPlanningControlledTurn({
      session,
      userText: '再送信',
      getState: store.getState,
      dispatch: store.dispatch,
      async execute(input) {
        retryPending = input.pending;
        return result;
      },
    });
    expect(retry.accepted).toBe(true);
    expect(retryPending).toMatchObject({
      conversationId: 'conversation-2',
      turnId: 'conversation-2:turn:1',
      requestId: 'conversation-2:request:1',
    });
  });

  it('clears history only while idle and preserves draft ownership', () => {
    const store = harness();
    store.dispatch({
      type: 'append_message',
      message: { id: 'message', role: 'user', content: '予定', createdAt: '2026-07-17T10:00:00Z' },
    });
    expect(clearWeeklyPlanningControlledConversation(store)).toBe(true);
    expect(store.getState().messages).toEqual([]);
  });
});
""", encoding='utf-8')

# Pending turn identity and reset invalidation.
types = ROOT / 'src/features/weeklyPlanning/types.ts'
replace_once(types,
"""export interface WeeklyPlanningPendingTurn {
  requestId: string;
""",
"""export interface WeeklyPlanningPendingTurn {
  conversationId: string;
  turnId: string;
  requestId: string;
""",
'pending turn identity')

reducer = ROOT / 'src/features/weeklyPlanning/weeklyPlanningReducer.ts'
replace_once(reducer,
"""} from './types';
""",
"""} from './types';
import { isSameWeeklyPlanningPendingTurn } from './weeklyPlanningTurnController';
""",
'reducer controller import')
replace_once(reducer,
"""function samePendingTurn(
  current: WeeklyPlanningPendingTurn | undefined,
  expected: WeeklyPlanningPendingTurn,
): boolean {
  return Boolean(
    current
      && current.requestId === expected.requestId
      && current.weekStartDate === expected.weekStartDate
      && current.baseRevision === expected.baseRevision,
  );
}

""",
""",
'remove duplicate pending matcher')
replace_once(reducer,
"""  return samePendingTurn(state.pendingTurn, pending)
""",
"""  return isSameWeeklyPlanningPendingTurn(state.pendingTurn, pending)
""",
'commit pending matcher')
replace_once(reducer,
"""    && action.type !== 'fail_approval'
  ) {
""",
"""    && action.type !== 'fail_approval'
    && action.type !== 'reset_session'
  ) {
""",
'approval reset invalidator')
replace_once(reducer,
"""    && action.type !== 'cancel_turn'
  ) {
""",
"""    && action.type !== 'cancel_turn'
    && action.type !== 'reset_session'
  ) {
""",
'turn reset invalidator')
replace_once(reducer,
"""      if (!samePendingTurn(state.pendingTurn, action.pending)) return state;
""",
"""      if (!isSameWeeklyPlanningPendingTurn(state.pendingTurn, action.pending)) return state;
""",
'cancel pending matcher')
replace_once(reducer,
"""        pendingTurn: undefined,
        lastAssistantMessage: undefined,
      });
""",
"""        pendingTurn: undefined,
        pendingApproval: undefined,
        lastAssistantMessage: undefined,
      });
""",
'reset pending ownership')

# App controller connection.
app = ROOT / 'src/App.tsx'
replace_once(app,
"""import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
""",
"""import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
""",
'App useRef')
replace_once(app,
"""import type {
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './features/weeklyPlanning/types';
""",
"""import type {
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
} from './features/weeklyPlanning/types';
""",
'App pending turn type removal')
replace_once(app,
"""import { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';
""",
"""import { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';
import {
  cancelWeeklyPlanningControlledTurn,
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  resetWeeklyPlanningControlledSession,
  submitWeeklyPlanningControlledTurn,
} from './features/weeklyPlanning/weeklyPlanningTurnController';
""",
'App controller imports')
replace_once(app,
"""  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(
    planningUserId,
    selectedDate,
  );
""",
"""  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(
    planningUserId,
    selectedDate,
  );
  const weeklyPlanningControllerSessionRef = useRef(
    createWeeklyPlanningControllerSession(planningState.weekStartDate),
  );
""",
'App controller session')
replace_once(app,
"""  useEffect(() => {
    if (typeof window === 'undefined') return;
""",
"""  useEffect(() => {
    if (weeklyPlanningControllerSessionRef.current.weekStartDate !== planningState.weekStartDate) {
      weeklyPlanningControllerSessionRef.current = createWeeklyPlanningControllerSession(
        planningState.weekStartDate,
      );
    }
  }, [planningState.weekStartDate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
""",
'App session week sync')
old_submit_start = """  async function submitWeeklyPlanningTurn(
    userText: string,
  ): Promise<WeeklyPlanningTurnSubmissionResult> {
"""
start = app.read_text(encoding='utf-8').find(old_submit_start)
end_marker = """  async function approveWeeklyDraftBlocks() {
"""
text = app.read_text(encoding='utf-8')
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('App submit function markers not found')
new_submit = """  async function submitWeeklyPlanningTurn(
    userText: string,
  ): Promise<WeeklyPlanningTurnSubmissionResult> {
    if (!user) return { accepted: false, draftCandidates: [] };
    return submitWeeklyPlanningControlledTurn({
      session: weeklyPlanningControllerSessionRef.current,
      userText,
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
      execute: async ({ snapshot, pending, userText: acceptedText }) => executeWeeklyPlanningTurn({
        previousState: snapshot.intakeState,
        messages: snapshot.messages,
        userText: acceptedText,
        selectedDate,
        userId: user.id,
        plans,
        scheduleTemplates,
        timetableTermId: activeTimetableTermId,
        traceRequestId: pending.requestId,
      }),
    });
  }

  function cancelWeeklyPlanningTurn() {
    cancelWeeklyPlanningControlledTurn({
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    });
  }

  function clearWeeklyPlanningConversation() {
    clearWeeklyPlanningControlledConversation({
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    });
  }

  function resetWeeklyPlanningSession() {
    resetWeeklyPlanningControlledSession({
      session: weeklyPlanningControllerSessionRef.current,
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    });
  }

"""
app.write_text(text[:start] + new_submit + text[end:], encoding='utf-8')
replace_once(app,
"""               onResetWeeklyPlanningSession={() =>
                 dispatchPlanningAction({ type: 'reset_session' })
               }
""",
"""               onCancelWeeklyPlanningTurn={cancelWeeklyPlanningTurn}
               onClearWeeklyPlanningConversation={clearWeeklyPlanningConversation}
               onResetWeeklyPlanningSession={resetWeeklyPlanningSession}
""",
'App UI controller callbacks')

# QuickEntry callback plumbing.
quick = ROOT / 'src/components/QuickEntryModal.tsx'
replace_once(quick,
"""  onAppendWeeklyPlanningMessage: (message: WeeklyPlanningMessage) => void;
  onResetWeeklyPlanningSession: () => void;
""",
"""  onAppendWeeklyPlanningMessage: (message: WeeklyPlanningMessage) => void;
  onCancelWeeklyPlanningTurn: () => void;
  onClearWeeklyPlanningConversation: () => void;
  onResetWeeklyPlanningSession: () => void;
""",
'QuickEntry prop types')
replace_once(quick,
"""  onAppendWeeklyPlanningMessage,
  onResetWeeklyPlanningSession,
""",
"""  onAppendWeeklyPlanningMessage,
  onCancelWeeklyPlanningTurn,
  onClearWeeklyPlanningConversation,
  onResetWeeklyPlanningSession,
""",
'QuickEntry destructuring')
replace_once(quick,
"""                 onAppendWeeklyPlanningMessage={onAppendWeeklyPlanningMessage}
                 onResetWeeklyPlanningSession={onResetWeeklyPlanningSession}
""",
"""                 onAppendWeeklyPlanningMessage={onAppendWeeklyPlanningMessage}
                 onCancelWeeklyPlanningTurn={onCancelWeeklyPlanningTurn}
                 onClearWeeklyPlanningConversation={onClearWeeklyPlanningConversation}
                 onResetWeeklyPlanningSession={onResetWeeklyPlanningSession}
""",
'QuickEntry assistant callbacks')

# UI policy supports legacy IME keyCode 229 and complete tab order.
ui_policy = ROOT / 'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueOrchestrator.ts'
replace_once(ui_policy,
"""  isComposing?: boolean;
}
""",
"""  isComposing?: boolean;
  keyCode?: number;
}
""",
'keyboard keyCode type')
replace_once(ui_policy,
"""  if (event.isComposing) return 'ignore';
""",
"""  if (event.isComposing || event.keyCode === 229) return 'ignore';
""",
'keyboard composition guard')
ui_tab = ROOT / 'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueUiPolicy.ts'
replace_once(ui_tab,
"""  'submit-button',
  'reset-button',
""",
"""  'submit-button',
  'cancel-button',
  'clear-conversation-button',
  'reset-button',
""",
'tab order controls')
ui_test = ROOT / 'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueUiPolicy.test.ts'
replace_once(ui_test,
"""    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', metaKey: true, isComposing: true },
""",
"""    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', metaKey: true, keyCode: 229 },
      phase: 'idle',
      hasText: true,
    })).toBe('ignore');
    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', metaKey: true, isComposing: true },
""",
'UI policy keyCode test')

# NaturalLanguageAssistant production keyboard/focus/cancel/clear connection.
nla = ROOT / 'src/components/NaturalLanguageAssistant.tsx'
replace_once(nla,
"""import { type CSSProperties, useState } from 'react';
""",
"""import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
""",
'NLA React imports')
replace_once(nla,
"""import { resolveInitialAiInputMode } from './weeklyPlanningConversationMode';
""",
"""import { resolveInitialAiInputMode } from './weeklyPlanningConversationMode';
import {
  decideWeeklyDialogueSubmit,
  shouldRestoreWeeklyDialogueFocus,
} from '../features/weeklyPlanning/dialogue/weeklyPlanningDialogueUiPolicy';
import type { DialogueRequestPhase } from '../features/weeklyPlanning/dialogue/weeklyPlanningDialogueOrchestrator';
""",
'NLA UI policy imports')
replace_once(nla,
"""  onAppendWeeklyPlanningMessage: (message: WeeklyPlanningMessage) => void;
  onResetWeeklyPlanningSession: () => void;
""",
"""  onAppendWeeklyPlanningMessage: (message: WeeklyPlanningMessage) => void;
  onCancelWeeklyPlanningTurn: () => void;
  onClearWeeklyPlanningConversation: () => void;
  onResetWeeklyPlanningSession: () => void;
""",
'NLA prop types')
replace_once(nla,
"""  onAppendWeeklyPlanningMessage,
  onResetWeeklyPlanningSession,
""",
"""  onAppendWeeklyPlanningMessage,
  onCancelWeeklyPlanningTurn,
  onClearWeeklyPlanningConversation,
  onResetWeeklyPlanningSession,
""",
'NLA destructuring')
replace_once(nla,
"""  const [selectedWeeklyDraftDate, setSelectedWeeklyDraftDate] = useState('');
  const runtimeInfo = getPlannerAiRuntimeInfo();
  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);
""",
"""  const [selectedWeeklyDraftDate, setSelectedWeeklyDraftDate] = useState('');
  const weeklyPlanningInputRef = useRef<HTMLTextAreaElement>(null);
  const runtimeInfo = getPlannerAiRuntimeInfo();
  const isWeeklyPlanningBusy = Boolean(weeklyPlanningPendingTurn || weeklyPlanningPendingApproval);
  const weeklyDialoguePhase: DialogueRequestPhase = weeklyPlanningPendingTurn
    ? 'interpreting'
    : weeklyPlanningPendingApproval
      ? 'applying'
      : 'idle';
  const previousWeeklyDialoguePhaseRef = useRef<DialogueRequestPhase>(weeklyDialoguePhase);
""",
'NLA phase refs')
replace_once(nla,
"""  void weeklyPlanningWeekStartDate;
  void weeklyPlanningRevision;

  function appendWeeklyPlanningMessage(
""",
"""  void weeklyPlanningWeekStartDate;
  void weeklyPlanningRevision;

  useEffect(() => {
    const previousPhase = previousWeeklyDialoguePhaseRef.current;
    previousWeeklyDialoguePhaseRef.current = weeklyDialoguePhase;
    if (shouldRestoreWeeklyDialogueFocus({
      previousPhase,
      nextPhase: weeklyDialoguePhase,
      mounted: Boolean(weeklyPlanningInputRef.current),
      modeActive: aiInputMode === 'weekly_planning',
    })) {
      weeklyPlanningInputRef.current?.focus();
    }
  }, [aiInputMode, weeklyDialoguePhase]);

  function appendWeeklyPlanningMessage(
""",
'NLA focus effect')
replace_once(nla,
"""  async function handleCreateWeeklyDrafts() {
""",
"""  function handleWeeklyPlanningKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const decision = decideWeeklyDialogueSubmit({
      event: {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.nativeEvent.keyCode,
      },
      phase: weeklyDialoguePhase,
      hasText: text.trim().length > 0,
    });
    if (decision !== 'submit') return;
    event.preventDefault();
    void handleCreateWeeklyDrafts();
  }

  function cancelWeeklyPlanningTurn() {
    onCancelWeeklyPlanningTurn();
    setError('');
    setStatus('送信をキャンセルしました。');
  }

  function clearWeeklyPlanningConversation() {
    onClearWeeklyPlanningConversation();
    setError('');
    setStatus('会話履歴と入力済み条件を消去しました。仮予定は保持しています。');
  }

  async function handleCreateWeeklyDrafts() {
""",
'NLA handlers')
# Attach ref/key to both weekly textareas.
text = nla.read_text(encoding='utf-8')
needle = """                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
"""
if text.count(needle) != 2:
    raise SystemExit(f'NLA weekly textarea anchor count: {text.count(needle)}')
text = text.replace(needle,
"""                <textarea
                  ref={weeklyPlanningInputRef}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={handleWeeklyPlanningKeyDown}
""
)
nla.write_text(text, encoding='utf-8')
# Preview history controls.
replace_once(nla,
"""          {renderWeeklyPlanningHistory()}

          {error || status ? (
""",
"""          {renderWeeklyPlanningHistory()}

          <div className="row-actions">
            {weeklyPlanningPendingTurn ? (
              <button className="ghost-button" onClick={cancelWeeklyPlanningTurn} type="button">
                送信をキャンセル
              </button>
            ) : null}
            {weeklyPlanningMessages.length > 0 && !isWeeklyPlanningBusy ? (
              <button className="ghost-button" onClick={clearWeeklyPlanningConversation} type="button">
                履歴だけ消す
              </button>
            ) : null}
          </div>

          {error || status ? (
""",
'NLA preview controls')
# Base history controls.
replace_once(nla,
"""          {renderWeeklyPlanningHistory()}

          {!isWeeklyPlanningBusy ? (
""",
"""          {renderWeeklyPlanningHistory()}

          {weeklyPlanningPendingTurn ? (
            <div className="row-actions">
              <button className="ghost-button" onClick={cancelWeeklyPlanningTurn} type="button">
                送信をキャンセル
              </button>
            </div>
          ) : null}

          {!isWeeklyPlanningBusy ? (
""",
'NLA base cancel')
replace_once(nla,
"""                {weeklyPlanningMessages.length > 0
                   || weeklyPlanningIntakeState
                   || weeklyDraftBlocks.length > 0
                   || weeklyPlanningPreviewBlocks.length > 0 ? (
                  <button
                    className="ghost-button"
                    onClick={resetWeeklyPlanningSession}
                    type="button"
                  >
                    この週の相談をリセット
                  </button>
                ) : null}
""",
"""                {weeklyPlanningMessages.length > 0 ? (
                  <button
                    className="ghost-button"
                    onClick={clearWeeklyPlanningConversation}
                    type="button"
                  >
                    履歴だけ消す
                  </button>
                ) : null}
                {weeklyPlanningMessages.length > 0
                   || weeklyPlanningIntakeState
                   || weeklyDraftBlocks.length > 0
                   || weeklyPlanningPreviewBlocks.length > 0 ? (
                  <button
                    className="ghost-button"
                    onClick={resetWeeklyPlanningSession}
                    type="button"
                  >
                    この週の相談をリセット
                  </button>
                ) : null}
""",
'NLA base clear/reset')

# Known test fixture identity fields.
property_test = ROOT / 'src/features/weeklyPlanning/weeklyPlanningSessionState.property.test.ts'
replace_once(property_test,
"""  return {
    requestId: 'request-current',
""",
"""  return {
    conversationId: 'conversation-current',
    turnId: 'turn-current',
    requestId: 'request-current',
""",
'property pending identity')

# Extend orchestrator unit coverage for keyCode 229.
orch_test = ROOT / 'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueOrchestrator.test.ts'
replace_once(orch_test,
"""    expect(decideDialogueKeyboardAction({ key: 'Enter', isComposing: true, ctrlKey: true })).toBe('ignore');
""",
"""    expect(decideDialogueKeyboardAction({ key: 'Enter', isComposing: true, ctrlKey: true })).toBe('ignore');
    expect(decideDialogueKeyboardAction({ key: 'Enter', keyCode: 229, metaKey: true })).toBe('ignore');
""",
'orchestrator keyCode test')
