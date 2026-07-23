import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, PlanDraft, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { useWeeklyPlanningPersonalization } from '../personalization/WeeklyPlanningPersonalizationContext';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningMessage,
} from '../types';
import { useWeeklyPlanningState } from '../useWeeklyPlanningState';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  cancelWeeklyPlanningControlledTurn,
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  resetWeeklyPlanningControlledSession,
  resetWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
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
  isWeeklyPlanningStableV5RuntimeEnabled,
  WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
} from './weeklyPlanningRuntimeMode';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  clearWeeklyPlanningStableV5RuntimeSession,
  clearWeeklyPlanningStableV5RuntimeSessionsForScope,
  hydrateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  clearWeeklyPlanningStableV5PersistedSession,
  loadWeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionStorage';

export interface UseWeeklyPlanningApplicationInput {
  userId: string | null | undefined;
  selectedDate: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  saveWeeklyApprovedPlan: (draft: PlanDraft) => Promise<Plan>;
  completeWeeklyApprovalOperation?: (operation: WeeklyDraftApprovalOperation) => Promise<void>;
}

export interface WeeklyPlanningApplication {
  state: PlanningState;
  pendingDraftBlocks: WeeklyPlanDraftBlock[];
  approvalAvailability: WeeklyPlanningApprovalAvailability;
  canEditDraftBlocks: boolean;
  submitTurn: (userText: string) => Promise<WeeklyPlanningTurnSubmissionResult>;
  cancelTurn: () => boolean;
  clearConversation: () => boolean;
  appendMessage: (message: WeeklyPlanningMessage) => void;
  resetSession: () => void;
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

function restoreStableV5RuntimeSession(ownerId: string, weekStartDate: string) {
  if (!isWeeklyPlanningStableV5RuntimeEnabled()) return null;
  const persisted = loadWeeklyPlanningStableV5PersistedSession({
    ownerId,
    weekStartDate,
  });
  if (!persisted) return null;
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId,
    weekStartDate,
    conversationId: persisted.conversationId,
    graph: persisted.graph,
    updatedAt: Date.parse(persisted.savedAt),
  });
  return persisted;
}

export function useWeeklyPlanningApplication({
  userId,
  selectedDate,
  plans,
  scheduleTemplates,
  timetableTermId,
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
  const [approvalLedger, setApprovalLedger] = useState<ApprovalLedgerState>(() => ({
    ownerId,
    operations: loadWeeklyPlanningApprovalOperations(ownerId),
  }));

  if (!controllerSessionRef.current) {
    const restored = restoreStableV5RuntimeSession(ownerId, planningState.weekStartDate);
    controllerSessionRef.current = createWeeklyPlanningControllerSession(
      ownerId,
      planningState.weekStartDate,
      restored?.conversationId,
    );
  }

  useEffect(() => {
    const session = controllerSessionRef.current;
    if (!session) return;
    const restored = restoreStableV5RuntimeSession(ownerId, planningState.weekStartDate);
    const scopeChanged = session.ownerId !== ownerId
      || session.weekStartDate !== planningState.weekStartDate;
    const conversationChanged = Boolean(
      restored?.conversationId && session.conversationId !== restored.conversationId,
    );
    if (scopeChanged || conversationChanged) {
      resetWeeklyPlanningControllerSession(
        session,
        ownerId,
        planningState.weekStartDate,
        restored?.conversationId,
      );
    }
  }, [ownerId, planningState.weekStartDate]);

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

  useEffect(() => {
    if (
      typeof window === 'undefined'
      || typeof window.addEventListener !== 'function'
      || typeof window.removeEventListener !== 'function'
    ) return undefined;
    const handleRuntimeModeChange = () => {
      const session = controllerSessionRef.current;
      if (!session) return;
      clearWeeklyPlanningStableV5PersistedSession({
        ownerId,
        weekStartDate: getPlanningState().weekStartDate,
      });
      clearWeeklyPlanningStableV5RuntimeSession(session.conversationId);
      resetWeeklyPlanningControlledSession({
        session,
        ownerId,
        getState: getPlanningState,
        dispatch: dispatchPlanningAction,
      });
    };
    window.addEventListener(
      WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
      handleRuntimeModeChange,
    );
    return () => window.removeEventListener(
      WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
      handleRuntimeModeChange,
    );
  }, [dispatchPlanningAction, getPlanningState, ownerId]);

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
  const canEditDraftBlocks = !planningState.pendingTurn && !planningState.pendingApproval;

  async function submitTurn(userText: string): Promise<WeeklyPlanningTurnSubmissionResult> {
    const session = controllerSessionRef.current;
    if (!userId || !session) return { accepted: false, draftCandidates: [] };

    return submitWeeklyPlanningControlledTurn({
      session,
      ownerId: userId,
      userText,
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
      async execute({ snapshot, pending, userText: controlledUserText }) {
        if (isWeeklyPlanningStableV5RuntimeEnabled()) {
          bindWeeklyPlanningStableV5RuntimeSessionScope({
            ownerId: userId,
            weekStartDate: snapshot.weekStartDate,
            conversationId: pending.conversationId,
          });
        }
        return executeWeeklyPlanningTurn({
          previousState: snapshot.intakeState,
          messages: snapshot.messages,
          userText: controlledUserText,
          selectedDate,
          userId,
          plans,
          scheduleTemplates,
          timetableTermId,
          conversationId: pending.conversationId,
          traceRequestId: pending.requestId,
          weekStartsOn,
        });
      },
    });
  }

  function resetSession(): void {
    const session = controllerSessionRef.current;
    if (!session) return;
    const weekStartDate = getPlanningState().weekStartDate;
    clearWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate });
    clearWeeklyPlanningStableV5RuntimeSessionsForScope({ ownerId, weekStartDate });
    resetWeeklyPlanningControlledSession({
      session,
      ownerId,
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    });
  }

  function clearConversation(): boolean {
    const current = getPlanningState();
    if (isWeeklyPlanningStableV5RuntimeEnabled()) {
      if (current.pendingTurn || current.pendingApproval) return false;
      resetSession();
      return true;
    }
    const session = controllerSessionRef.current;
    const cleared = clearWeeklyPlanningControlledConversation({
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    });
    if (cleared && session) {
      clearWeeklyPlanningStableV5RuntimeSession(session.conversationId);
    }
    return cleared;
  }

  return {
    state: planningState,
    pendingDraftBlocks,
    approvalAvailability,
    canEditDraftBlocks,
    submitTurn,
    cancelTurn: () => cancelWeeklyPlanningControlledTurn({
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    }),
    clearConversation,
    appendMessage: (message) => dispatchPlanningAction({ type: 'append_message', message }),
    resetSession,
    createDraftBlocks: (blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks }),
    removePreviewCandidate: (candidateId) =>
      dispatchPlanningAction({ type: 'remove_preview_candidate', candidateId }),
    removeDraftBlock: (blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId }),
    clearDraftBlocks: () => dispatchPlanningAction({ type: 'clear_draft_blocks' }),
    approveDraftBlocks: () => approveWeeklyPlanningDraftBlocks({
      userId,
      plans,
      approvalOperations,
      saveWeeklyApprovedPlan,
      completeWeeklyApprovalOperation,
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
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
