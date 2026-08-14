import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Actual, Plan, PlanDraft, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { useWeeklyPlanningPersonalization } from '../personalization/WeeklyPlanningPersonalizationContext';
import {
  deriveWeeklyPlanningEstimateCalibration,
} from '../personalization/weeklyPlanningEstimateCalibration';
import {
  clearWeeklyPlanningEstimateCalibrationRuntimeV5,
  setWeeklyPlanningEstimateCalibrationRuntimeV5,
} from '../personalization/weeklyPlanningEstimateCalibrationRuntimeV5';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
  WeeklyPlanningMessage,
} from '../types';
import { useWeeklyPlanningState } from '../useWeeklyPlanningState';
import type {
  WeeklyPlanningTurnSubmissionOptions,
  WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  cancelWeeklyPlanningControlledTurn,
  clearWeeklyPlanningControlledConversation,
  createWeeklyPlanningControllerSession,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
import { saveOwnedWeeklyPlanningState } from '../weeklyPlanningOwnedStorage';
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
import { submitWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnApplication';

export interface UseWeeklyPlanningApplicationInput {
  userId: string | null | undefined;
  selectedDate: string;
  plans: Plan[];
  actuals?: Actual[];
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
  submitTurn: (
    userText: string,
    options?: WeeklyPlanningTurnSubmissionOptions,
  ) => Promise<WeeklyPlanningTurnSubmissionResult>;
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
  actuals = [],
  scheduleTemplates,
  timetableTermId,
  saveWeeklyApprovedPlan,
  completeWeeklyApprovalOperation,
}: UseWeeklyPlanningApplicationInput): WeeklyPlanningApplication {
  const ownerId = userId?.trim() || 'anonymous';
  const { weekStartsOn } = useWeeklyPlanningPersonalization();
  const estimateCalibration = useMemo(
    () => deriveWeeklyPlanningEstimateCalibration({ plans, actuals }),
    [actuals, plans],
  );
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
    setWeeklyPlanningEstimateCalibrationRuntimeV5({
      ownerId,
      calibration: estimateCalibration,
    });
    return () => clearWeeklyPlanningEstimateCalibrationRuntimeV5(ownerId);
  }, [estimateCalibration, ownerId]);

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
  const canEditDraftBlocks = !planningState.pendingTurn && !planningState.pendingApproval;

  async function submitTurn(
    userText: string,
    submissionOptions?: WeeklyPlanningTurnSubmissionOptions,
  ): Promise<WeeklyPlanningTurnSubmissionResult> {
    const session = controllerSessionRef.current;
    if (!userId || !session) return { accepted: false, draftCandidates: [] };
    return submitWeeklyPlanningApplicationTurn({
      session,
      userId,
      ownerId,
      userText,
      selectedDate,
      plans,
      scheduleTemplates,
      timetableTermId,
      weekStartsOn,
      submissionOptions,
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
    });
  }

  function resetSession(): void {
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
    return clearWeeklyPlanningControlledConversation({
      getState: getPlanningState,
      dispatch: dispatchAndPersist,
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
      dispatch: dispatchAndPersist,
    }),
    clearConversation,
    appendMessage: (message) => dispatchAndPersist({ type: 'append_message', message }),
    resetSession,
    createDraftBlocks: (blocks) => dispatchAndPersist({ type: 'add_draft_blocks', blocks }),
    removePreviewCandidate: (candidateId) =>
      dispatchAndPersist({ type: 'remove_preview_candidate', candidateId }),
    removeDraftBlock: (blockId) => dispatchAndPersist({ type: 'remove_draft_block', blockId }),
    clearDraftBlocks: () => dispatchAndPersist({ type: 'clear_draft_blocks' }),
    approveDraftBlocks: () => approveWeeklyPlanningDraftBlocks({
      userId,
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
