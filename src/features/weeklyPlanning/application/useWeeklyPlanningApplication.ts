import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerDataAvailability } from '../../../domain/plannerDataReadAuthority';
import type {
  Actual,
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
  hydrateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  prepareWeeklyPlanningStableV5Checkpoint,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
  type WeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionCodec';
import { submitWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnApplication';

export interface UseWeeklyPlanningApplicationInput {
  userId: string | null | undefined;
  selectedDate: string;
  plans: Plan[];
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
  state: PlanningState;
  pendingDraftBlocks: WeeklyPlanDraftBlock[];
  approvalAvailability: WeeklyPlanningApprovalAvailability;
  canEditDraftBlocks: boolean;
  submitTurn: (
    userText: string,
    supplementalContext?: string,
  ) => Promise<WeeklyPlanningTurnSubmissionResult>;
  cancelTurn: () => boolean;
  clearConversation: () => boolean;
  appendMessage: (message: WeeklyPlanningMessage) => void;
  resetSession: () => void;
  startConversation: () => void;
  exportConversationSnapshot: () => WeeklyPlanningStableV5PersistedSession | null;
  loadConversationSnapshot: (snapshot: WeeklyPlanningStableV5PersistedSession) => boolean;
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
  const canEditDraftBlocks = !planningState.pendingTurn && !planningState.pendingApproval;

  async function submitTurn(
    userText: string,
    supplementalContext?: string,
  ): Promise<WeeklyPlanningTurnSubmissionResult> {
    const session = controllerSessionRef.current;
    if (!userId || !session) return { accepted: false, draftCandidates: [] };
    return submitWeeklyPlanningApplicationTurn({
      session,
      userId,
      ownerId,
      userText,
      supplementalContext,
      selectedDate,
      plans,
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

  function startConversation(): void {
    const session = controllerSessionRef.current;
    if (!session || getPlanningState().pendingTurn || getPlanningState().pendingApproval) return;
    const weekStartDate = getPlanningState().weekStartDate;
    resetWeeklyPlanningControllerSession(session, ownerId, weekStartDate);
    dispatchAndPersist({
      type: 'load_state',
      state: createInitialPlanningState(weekStartDate),
    });
  }

  function exportConversationSnapshot(): WeeklyPlanningStableV5PersistedSession | null {
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

  function loadConversationSnapshot(snapshot: WeeklyPlanningStableV5PersistedSession): boolean {
    const session = controllerSessionRef.current;
    const current = getPlanningState();
    if (
      !session
      || current.pendingTurn
      || current.pendingApproval
      || snapshot.ownerId !== ownerId
      || snapshot.planningState.pendingTurn
      || snapshot.planningState.pendingApproval
    ) {
      return false;
    }

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
    return true;
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
    startConversation,
    exportConversationSnapshot,
    loadConversationSnapshot,
    createDraftBlocks: (blocks) => dispatchAndPersist({ type: 'add_draft_blocks', blocks }),
    removePreviewCandidate: (candidateId) =>
      dispatchAndPersist({ type: 'remove_preview_candidate', candidateId }),
    removeDraftBlock: (blockId) => dispatchAndPersist({ type: 'remove_draft_block', blockId }),
    clearDraftBlocks: () => dispatchAndPersist({ type: 'clear_draft_blocks' }),
    approveDraftBlocks: () => approveWeeklyPlanningDraftBlocks({
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
