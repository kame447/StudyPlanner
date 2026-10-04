import { createAiPlanningChatSession, type AiPlanningChatSession } from '../chat/aiPlanningChatSession';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlannerDataAvailability } from '../../../domain/plannerDataReadAuthority';
import type {
  Actual,
  MonthEvent,
  Plan,
  PlanDraft,
  ScheduleTemplate,
  StudyMaterial,
  TimetableTerm,
} from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { useWeeklyPlanningPersonalization } from '../personalization/WeeklyPlanningPersonalizationContext';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
} from '../types';
import { useWeeklyPlanningState } from '../useWeeklyPlanningState';
import type { WeeklyPlanningTurnSubmissionResult } from '../weeklyPlanningTurnExecutor';
import type { WeeklyPlanningSelectedStarterTargetV5 } from '../semantic/weeklyPlanningTurnEvidenceV5';
import {
  cancelWeeklyPlanningControlledTurn,
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  inferWeeklyPlanningControllerRequestSequence,
  resetWeeklyPlanningControllerSession,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
import { saveOwnedWeeklyPlanningState } from '../weeklyPlanningOwnedStorage';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';
import {
  classifyWeeklyPlanningApprovalAvailability,
  type WeeklyPlanningApprovalAvailability,
} from './weeklyPlanningApprovalAvailability';
import {
  loadWeeklyPlanningApprovalOperations,
  saveWeeklyPlanningApprovalOperations,
} from './weeklyPlanningApprovalLedgerStorage';
import {
  resetWeeklyPlanningApplicationSession,
  restoreWeeklyPlanningApplicationSession,
  synchronizeWeeklyPlanningApplicationSession,
} from './weeklyPlanningSessionLifecycle';
import {
  getWeeklyPlanningStableV5RuntimeSession,
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  hydrateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  prepareWeeklyPlanningStableV5Checkpoint,
  validateWeeklyPlanningStableV5SessionSnapshot,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
  type WeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionCodec';
import { submitWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnApplication';

export interface UseWeeklyPlanningApplicationInput {
  userId: string | null | undefined;
  selectedDate: string;
  plans: Plan[];
  monthEvents?: MonthEvent[];
  actuals?: Actual[];
  studyMaterials?: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  plannerDataAvailability: PlannerDataAvailability;
  saveWeeklyApprovedPlan: (draft: PlanDraft) => Promise<Plan>;
  completeWeeklyApprovalOperation?: (operation: WeeklyDraftApprovalOperation) => Promise<void>;
}

export interface WeeklyPlanningApplication {
  chat: AiPlanningChatSession;
  state: PlanningState;
  pendingDraftBlocks: WeeklyPlanDraftBlock[];
  approvalAvailability: WeeklyPlanningApprovalAvailability;
  canEditDraftBlocks: boolean;
  submitTurn: (
    userText: string,
    supplementalContext?: string,
    selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5,
  ) => Promise<WeeklyPlanningTurnSubmissionResult>;
  cancelTurn: () => boolean;
  clearConversation: () => boolean;
  appendMessage: (message: WeeklyPlanningMessage) => void;
  resetSession: () => void;
  startConversation: () => void;
  exportConversationSnapshot: (options?: { includeEmpty?: boolean }) => WeeklyPlanningStableV5PersistedSession | null;
  loadConversationSnapshot: (snapshot: unknown) => boolean;
  createDraftBlocks: (blocks: WeeklyPlanDraftBlock[]) => void;
  removePreviewCandidate: (candidateId: string) => void;
  removeDraftBlock: (blockId: string) => void;
  clearDraftBlocks: () => void;
  approveDraftBlocks: () => Promise<void>;
}

interface ApprovalLedgerState {
  ownerId: string;
  operations: WeeklyDraftApprovalOperation[];
}

export function useWeeklyPlanningApplication({
  userId,
  selectedDate,
  plans,
  monthEvents = [],
  actuals = [],
  studyMaterials = [],
  scheduleTemplates,
  timetableTermId,
  timetableTerm,
  timetableTerms = [],
  plannerDataAvailability,
  saveWeeklyApprovedPlan,
  completeWeeklyApprovalOperation,
}: UseWeeklyPlanningApplicationInput): WeeklyPlanningApplication {
  const ownerId = userId?.trim() || 'anonymous';
  const { weekStartsOn } = useWeeklyPlanningPersonalization();
  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(
    ownerId,
    selectedDate,
    weekStartsOn,
  );
  const controllerSessionRef = useRef<WeeklyPlanningControllerSession | null>(null);
  const applicationActiveRef = useRef(true);
  useLayoutEffect(() => {
    applicationActiveRef.current = true;
    return () => { applicationActiveRef.current = false; };
  }, []);
  const [approvalLedger, setApprovalLedger] = useState<ApprovalLedgerState>(() => ({
    ownerId,
    operations: loadWeeklyPlanningApprovalOperations(ownerId),
  }));

  if (!controllerSessionRef.current) {
    const restored = restoreWeeklyPlanningApplicationSession(
      ownerId,
      planningState.weekStartDate,
    );
    controllerSessionRef.current = createWeeklyPlanningControllerSession(
      ownerId,
      planningState.weekStartDate,
      restored?.conversationId,
    );
  }

  const dispatchAndPersist = useCallback((action: WeeklyPlanningAction): PlanningState => {
    const next = dispatchPlanningAction(action);
    if (action.type !== 'commit_turn') {
      saveOwnedWeeklyPlanningState(ownerId, next);
    }
    return next;
  }, [dispatchPlanningAction, ownerId]);

  useEffect(() => {
    const session = controllerSessionRef.current;
    if (!session) return;
    synchronizeWeeklyPlanningApplicationSession({
      session,
      ownerId,
      weekStartDate: planningState.weekStartDate,
    });
    saveOwnedWeeklyPlanningState(ownerId, getPlanningState());
  }, [getPlanningState, ownerId, planningState.weekStartDate]);

  useEffect(() => {
    if (approvalLedger.ownerId === ownerId) return;
    setApprovalLedger({
      ownerId,
      operations: loadWeeklyPlanningApprovalOperations(ownerId),
    });
  }, [approvalLedger.ownerId, ownerId]);

  useEffect(() => {
    if (approvalLedger.ownerId !== ownerId) return;
    saveWeeklyPlanningApprovalOperations(ownerId, approvalLedger.operations);
  }, [approvalLedger, ownerId]);

  const approvalOperations = approvalLedger.ownerId === ownerId
    ? approvalLedger.operations
    : [];
  const pendingDraftBlocks = useMemo(
    () => planningState.draftBlocks.filter((block) => block.status === 'draft'),
    [planningState.draftBlocks],
  );
  const approvalAvailability = classifyWeeklyPlanningApprovalAvailability({
    blocks: pendingDraftBlocks,
    userId: ownerId,
  });
  const canEditDraftBlocks = !planningState.pendingTurn && !planningState.pendingApproval
    && !planningState.approvalRecovery;

  async function submitTurn(
    userText: string,
    supplementalContext?: string,
    selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5,
  ): Promise<WeeklyPlanningTurnSubmissionResult> {
    const session = controllerSessionRef.current;
    if (!userId || !session || getPlanningState().approvalRecovery || chat.requiresInitialization) return { accepted: false, draftCandidates: [] };
    return submitWeeklyPlanningApplicationTurn({
      session,
      userId,
      ownerId,
      userText,
      supplementalContext,
      selectedStarterTarget,
      selectedDate,
      plans,
      monthEvents,
      actuals,
      studyMaterials,
      scheduleTemplates,
      timetableTermId,
      timetableTerm,
      timetableTerms,
      plannerDataAvailability,
      weekStartsOn,
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
    });
  }

  function resetSession(): void {
    if (chat.requiresInitialization) return;
    const session = controllerSessionRef.current;
    if (!session) return;
    resetWeeklyPlanningApplicationSession({
      session,
      ownerId,
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
    });
  }

  function clearConversation(): boolean {
    if (chat.requiresInitialization) return false;
    return clearWeeklyPlanningControlledConversation({
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
    });
  }

  function prepareNewConversation(): (() => void) | null {
    const session = controllerSessionRef.current;
    const current = getPlanningState();
    if (!session || current.pendingTurn || current.pendingApproval) return null;
    const next = createWeeklyPlanningControllerSession(ownerId, current.weekStartDate);
    if (getWeeklyPlanningStableV5RuntimeSession(next.conversationId)) return null;
    return () => {
      resetWeeklyPlanningControllerSession(session, ownerId, current.weekStartDate, next.conversationId);
      bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId, weekStartDate: current.weekStartDate, conversationId: next.conversationId });
      dispatchAndPersist({ type: 'load_state', state: createInitialPlanningState(current.weekStartDate) });
    };
  }

  function startConversation(): void {
    if (chat.requiresInitialization) return;
    prepareNewConversation()?.();
  }

  function exportConversationSnapshot(
    options: { includeEmpty?: boolean } = {},
  ): WeeklyPlanningStableV5PersistedSession | null {
    const session = controllerSessionRef.current;
    const current = getPlanningState();
    if (!session || current.pendingTurn || current.pendingApproval) return null;
    const runtime = getWeeklyPlanningStableV5RuntimeSession(session.conversationId);
    if (!runtime || runtime.ownerId !== ownerId) return null;
    const preparation = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId,
      weekStartDate: current.weekStartDate,
      conversationId: session.conversationId,
      graph: runtime.graph,
      planningState: current,
      includeEmpty: options.includeEmpty,
    });
    if (preparation.status !== 'ready') return null;
    return {
      version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
      ownerId,
      weekStartDate: current.weekStartDate,
      conversationId: session.conversationId,
      graph: structuredClone(runtime.graph),
      planningState: structuredClone(preparation.planningState),
      savedAt: new Date().toISOString(),
    };
  }

  function prepareConversationSnapshot(value: unknown): (() => void) | null {
    const session = controllerSessionRef.current;
    const current = getPlanningState();
    if (!session || current.pendingTurn || current.pendingApproval) return null;
    const snapshot = validateWeeklyPlanningStableV5SessionSnapshot(value, ownerId);
    if (!snapshot) return null;
    const existing = getWeeklyPlanningStableV5RuntimeSession(snapshot.conversationId);
    if (existing && existing.ownerId !== ownerId) return null;
    return () => {
      hydrateWeeklyPlanningStableV5RuntimeSession({
        ownerId,
        weekStartDate: snapshot.weekStartDate,
        conversationId: snapshot.conversationId,
        graph: snapshot.graph,
        updatedAt: Date.parse(snapshot.savedAt),
      });
      resetWeeklyPlanningControllerSession(
        session,
        ownerId,
        snapshot.weekStartDate,
        snapshot.conversationId,
      );
      session.requestSequence = Math.max(
        snapshot.planningState.conversationRequestSequence ?? 0,
        inferWeeklyPlanningControllerRequestSequence(
          snapshot.planningState.messages,
          snapshot.conversationId,
        ),
      );
      dispatchAndPersist({
        type: 'load_state',
        state: structuredClone(snapshot.planningState),
      });
    };
  }

  function loadConversationSnapshot(value: unknown): boolean {
    if (chat.requiresInitialization) return false;
    const commit = prepareConversationSnapshot(value);
    if (!commit) return false;
    commit();
    return true;
  }

  const [chatRevision, setChatRevision] = useState(0);
  const chatPortsRef = useRef({ ownerId, exportConversationSnapshot, prepareConversationSnapshot, prepareNewConversation, getPlanningState });
  chatPortsRef.current = { ownerId, exportConversationSnapshot, prepareConversationSnapshot, prepareNewConversation, getPlanningState };
  const chatRef = useRef<{ ownerId: string; generation: symbol; session: AiPlanningChatSession } | null>(null);
  if (!chatRef.current || chatRef.current.ownerId !== ownerId) {
    const generation = Symbol('chat-owner-session');
    chatRef.current = { ownerId, generation, session: createAiPlanningChatSession(ownerId, {
      isCurrent: () => applicationActiveRef.current && chatPortsRef.current.ownerId === ownerId && chatRef.current?.generation === generation,
      isBusy: () => Boolean(chatPortsRef.current.getPlanningState().pendingTurn || chatPortsRef.current.getPlanningState().pendingApproval),
      exportSnapshot: (includeEmpty) => chatPortsRef.current.exportConversationSnapshot({ includeEmpty }),
      prepareImport: (snapshot) => chatPortsRef.current.prepareConversationSnapshot(snapshot),
      prepareNew: () => chatPortsRef.current.prepareNewConversation(),
      changed: () => setChatRevision((revision) => revision + 1),
    }) };
  }
  const chat = chatRef.current.session;
  useEffect(() => {
    if (!chat.dirty || typeof window === 'undefined' || !window.addEventListener) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [chat, chatRevision]);

  return {
    chat,
    state: planningState,
    pendingDraftBlocks,
    approvalAvailability,
    canEditDraftBlocks: canEditDraftBlocks && !chat.requiresInitialization,
    submitTurn,
    cancelTurn: () => cancelWeeklyPlanningControlledTurn({
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
    }),
    clearConversation,
    appendMessage: (message) => { if (!chat.requiresInitialization) dispatchAndPersist({ type: 'append_message', message }); },
    resetSession,
    startConversation,
    exportConversationSnapshot,
    loadConversationSnapshot,
    createDraftBlocks: (blocks) => { if (!chat.requiresInitialization) dispatchAndPersist({ type: 'add_draft_blocks', blocks }); },
    removePreviewCandidate: (candidateId) => { if (!chat.requiresInitialization) dispatchAndPersist({ type: 'remove_preview_candidate', candidateId }); },
    removeDraftBlock: (blockId) => { if (!chat.requiresInitialization) dispatchAndPersist({ type: 'remove_draft_block', blockId }); },
    clearDraftBlocks: () => { if (!chat.requiresInitialization) dispatchAndPersist({ type: 'clear_draft_blocks' }); },
    approveDraftBlocks: () => chat.requiresInitialization
      ? Promise.reject(new Error('チャットの読み込みを再試行してください。'))
      : approveWeeklyPlanningDraftBlocks({
      userId,
      featureSessionId: controllerSessionRef.current?.conversationId,
      plans,
      approvalOperations,
      saveWeeklyApprovedPlan,
      completeWeeklyApprovalOperation,
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
      onOperationCompleted: (operation) => {
        setApprovalLedger((current) => {
          const currentOperations = current.ownerId === ownerId
            ? current.operations
            : loadWeeklyPlanningApprovalOperations(ownerId);
          return {
            ownerId,
            operations: [
              ...currentOperations.filter(
                (item) => item.approvalOperationId !== operation.approvalOperationId,
              ),
              operation,
            ],
          };
        });
      },
    }),
  };
}
