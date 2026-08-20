import type {
  Actual,
  ActualDraft,
  Plan,
  PlanDraft,
  StudyMaterial,
  StudySubject,
  TodoTaskDraft,
} from '../types/domain';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { AiPlanningView } from './AiPlanningView';
import { QuickEntryModal } from './QuickEntryModal';
import './WeeklyPlanningQuickEntryModal.css';

interface WeeklyPlanningQuickEntryModalProps {
  application: WeeklyPlanningApplication;
  userId: string;
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  materials: StudyMaterial[];
  subjects: StudySubject[];
  onClose: () => void;
  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveLinkedActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
}

export function WeeklyPlanningQuickEntryModal({
  application,
  userId,
  selectedDate,
  plans,
  actuals,
  materials,
  subjects,
  onClose,
  onSaveTodo,
  onSavePlan,
  onSaveStandaloneActual,
  onSaveLinkedActual,
}: WeeklyPlanningQuickEntryModalProps) {
  const opensFromHome =
    typeof document !== 'undefined' && Boolean(document.querySelector('.home-app-shell'));

  if (opensFromHome) {
    return (
      <AiPlanningView
        application={application}
        userId={userId}
        selectedDate={selectedDate}
        plans={plans}
        actuals={actuals}
        onClose={onClose}
      />
    );
  }

  const { state, approvalAvailability, pendingDraftBlocks } = application;
  const unavailableApproval =
    pendingDraftBlocks.length > 0 && approvalAvailability.kind !== 'eligible'
      ? approvalAvailability
      : null;
  const lastMessage = state.messages[state.messages.length - 1];
  const weeklyPlanningMessages = unavailableApproval
    ? [
        ...state.messages,
        {
          id: 'weekly-planning-approval-unavailable',
          role: 'assistant' as const,
          content: unavailableApproval.message,
          createdAt: lastMessage?.createdAt ?? '1970-01-01T00:00:00.000Z',
        },
      ]
    : state.messages;

  return (
    <div
      className={unavailableApproval ? 'weekly-planning-approval-unavailable' : undefined}
      data-weekly-approval-availability={approvalAvailability.kind}
    >
      <QuickEntryModal
        userId={userId}
        selectedDate={selectedDate}
        plans={plans}
        actuals={actuals}
        materials={materials}
        subjects={subjects}
        weeklyDraftBlocks={pendingDraftBlocks}
        weeklyPlanningPreviewCandidates={state.previewCandidates ?? []}
        weeklyPlanningMessages={weeklyPlanningMessages}
        weeklyPlanningIntakeState={state.intakeState ?? null}
        weeklyPlanningWeekStartDate={state.weekStartDate}
        weeklyPlanningRevision={state.revision}
        weeklyPlanningPendingTurn={state.pendingTurn}
        weeklyPlanningPendingApproval={state.pendingApproval}
        onSubmitWeeklyPlanningTurn={application.submitTurn}
        onCancelWeeklyPlanningTurn={application.cancelTurn}
        onClearWeeklyPlanningConversation={application.clearConversation}
        onAppendWeeklyPlanningMessage={application.appendMessage}
        onResetWeeklyPlanningSession={application.resetSession}
        onCreateWeeklyDraftBlocks={application.createDraftBlocks}
        onRemoveWeeklyPlanningPreviewCandidate={application.removePreviewCandidate}
        onRemoveWeeklyDraftBlock={application.removeDraftBlock}
        onClearWeeklyDraftBlocks={application.clearDraftBlocks}
        onApproveWeeklyDraftBlocks={application.approveDraftBlocks}
        onClose={onClose}
        onSaveTodo={onSaveTodo}
        onSavePlan={onSavePlan}
        onSaveStandaloneActual={onSaveStandaloneActual}
        onSaveLinkedActual={onSaveLinkedActual}
      />
    </div>
  );
}
