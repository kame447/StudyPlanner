import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, PlanDraft, ScheduleTemplate } from '../../../types/domain';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { useWeeklyPlanningPersonalization } from '../personalization/WeeklyPlanningPersonalizationContext';
import {
  recordWeeklyPlanningStableV5TurnTrace,
} from '../trace/weeklyPlanningStableV5TraceRuntime';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningAction,
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
  submitWeeklyPlanningControlledTurn,
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
  isWeeklyPlanningStableV5RuntimeEnabled,
  WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
} from './weeklyPlanningRuntimeMode';
import {
  resetWeeklyPlanningApplicationForRuntimeModeChange,
  resetWeeklyPlanningApplicationSession,
  restoreWeeklyPlanningApplicationSession,
  synchronizeWeeklyPlanningApplicationSession,
} from './weeklyPlanningSessionLifecycle';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  discardWeeklyPlanningStableV5StagedGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hasWeeklyPlanningStableV5StagedGraphForTest,
} from './weeklyPlanningStableV5RuntimeSession';

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

function stableV5TraceContext(conversationId: string) {
  const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
  const graph = runtime?.graph;
  const activeFactIds = new Set(
    graph?.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId) ?? [],
  );
  const planningWindow = graph?.planningWindows.find((fact) => activeFactIds.has(fact.id));
  return {
    graphRevision: graph?.revision ?? 0,
    graphSummary: {
      taskCount: graph?.tasks.length ?? 0,
      workloadCount: graph?.workloads.length ?? 0,
      availabilityCount: graph?.availabilityDeclarations.length ?? 0,
      activeFactCount: activeFactIds.size,
    },
    planningRangeStart: planningWindow?.start ?? undefined,
    planningRangeEnd: planningWindow?.end ?? undefined,
  };
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
      resetWeeklyPlanningApplicationForRuntimeModeChange({
        session,
        ownerId,
        getState: getPlanningState,
        dispatch: dispatchAndPersist,
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
  }, [dispatchAndPersist, getPlanningState, ownerId]);

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
      dispatch: dispatchAndPersist,
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
      commitExecutionResult({ pending }) {
        if (!isWeeklyPlanningStableV5RuntimeEnabled()) return;
        if (!hasWeeklyPlanningStableV5StagedGraphForTest({
          conversationId: pending.conversationId,
          requestId: pending.requestId,
        })) {
          return;
        }
        finalizeWeeklyPlanningStableV5RuntimeGraph({
          ownerId: userId,
          conversationId: pending.conversationId,
          requestId: pending.requestId,
        });
      },
      discardExecutionResult({ pending }) {
        if (!isWeeklyPlanningStableV5RuntimeEnabled()) return;
        discardWeeklyPlanningStableV5StagedGraph({
          conversationId: pending.conversationId,
          requestId: pending.requestId,
        });
      },
      onCommittedTurn({ pending, userText: committedUserText, result, committed }) {
        saveOwnedWeeklyPlanningState(ownerId, committed);
        if (!isWeeklyPlanningStableV5RuntimeEnabled()) return;
        const trace = stableV5TraceContext(pending.conversationId);
        void recordWeeklyPlanningStableV5TurnTrace({
          userId: ownerId,
          conversationId: pending.conversationId,
          requestId: pending.requestId,
          userText: committedUserText,
          assistantMessage: result.message,
          outcome: result.draftCandidates.length > 0 ? 'preview_ready' : result.state.status,
          graphRevision: trace.graphRevision,
          graphSummary: trace.graphSummary,
          compatibilityState: result.state,
          previewCount: result.draftCandidates.length,
          planningRangeStart: trace.planningRangeStart,
          planningRangeEnd: trace.planningRangeEnd,
        });
      },
      onFailedTurn({ pending, userText: failedUserText, error, failedState, assistantMessage }) {
        discardWeeklyPlanningStableV5StagedGraph({
          conversationId: pending.conversationId,
          requestId: pending.requestId,
        });
        saveOwnedWeeklyPlanningState(ownerId, failedState);
        if (!isWeeklyPlanningStableV5RuntimeEnabled()) return;
        const trace = stableV5TraceContext(pending.conversationId);
        void recordWeeklyPlanningStableV5TurnTrace({
          userId: ownerId,
          conversationId: pending.conversationId,
          requestId: pending.requestId,
          userText: failedUserText,
          assistantMessage: assistantMessage.content,
          outcome: 'failed',
          graphRevision: trace.graphRevision,
          graphSummary: trace.graphSummary,
          previewCount: 0,
          planningRangeStart: trace.planningRangeStart,
          planningRangeEnd: trace.planningRangeEnd,
          errorCode: error instanceof Error ? error.name : 'unknown-error',
        });
      },
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
