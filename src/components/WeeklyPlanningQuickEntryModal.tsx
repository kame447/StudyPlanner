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
import { QuickEntryModal } from './QuickEntryModal';

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
  const { state } = application;

  return (
    <QuickEntryModal
      userId={userId}
      selectedDate={selectedDate}
      plans={plans}
      actuals={actuals}
      materials={materials}
      subjects={subjects}
      weeklyDraftBlocks={application.pendingDraftBlocks}
      weeklyPlanningPreviewCandidates={state.previewCandidates ?? []}
      weeklyPlanningMessages={state.messages}
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
  );
}
