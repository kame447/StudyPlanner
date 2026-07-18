import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, PlanDraft, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
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

export interface UseWeeklyPlanningApplicationInput {
  userId: string | null | undefined;
  selectedDate: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  saveWeeklyApprovedPlan: (draft: PlanDraft) => Promise<Plan>;
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

export function useWeeklyPlanningApplication({
  userId,
  selectedDate,
  plans,
  scheduleTemplates,
  timetableTermId,
  saveWeeklyApprovedPlan,
}: UseWeeklyPlanningApplicationInput): WeeklyPlanningApplication {
  const ownerId = userId?.trim() || 'anonymous';
  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(
    ownerId,
    selectedDate,
  );
  const controllerSessionRef = useRef<WeeklyPlanningControllerSession | null>(null);
  const [approvalLedger, setApprovalLedger] = useState<ApprovalLedgerState>(() => ({
    ownerId,
    operations: loadWeeklyPlanningApprovalOperations(ownerId),
  }));

  if (!controllerSessionRef.current) {
    controllerSessionRef.current = createWeeklyPlanningControllerSession(
      ownerId,
      planningState.weekStartDate,
    );
  }

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
        });
      },
    });
  }

  function resetSession(): void {
    const session = controllerSessionRef.current;
    if (!session) return;
    resetWeeklyPlanningControlledSession({
      session,
      ownerId,
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    });
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
    clearConversation: () => clearWeeklyPlanningControlledConversation({
      getState: getPlanningState,
      dispatch: dispatchPlanningAction,
    }),
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
