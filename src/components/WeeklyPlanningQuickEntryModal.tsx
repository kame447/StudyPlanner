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
import { useExitMotion } from '../hooks/useExitMotion';
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

const NO_WEEKLY_DRAFT_BLOCKS: never[] = [];
const NO_WEEKLY_PREVIEW_CANDIDATES: never[] = [];
const NO_WEEKLY_MESSAGES: never[] = [];

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
  const { isExiting, requestExit } = useExitMotion(onClose);

  return (
    <div
      data-quick-entry-manual-only="true"
      data-weekly-approval-availability={application.approvalAvailability.kind}
      data-weekly-planning-motion={isExiting ? 'closing' : 'open'}
    >
      <QuickEntryModal
        userId={userId}
        selectedDate={selectedDate}
        plans={plans}
        actuals={actuals}
        materials={materials}
        subjects={subjects}
        weeklyDraftBlocks={NO_WEEKLY_DRAFT_BLOCKS}
        weeklyPlanningPreviewCandidates={NO_WEEKLY_PREVIEW_CANDIDATES}
        weeklyPlanningMessages={NO_WEEKLY_MESSAGES}
        weeklyPlanningIntakeState={null}
        weeklyPlanningWeekStartDate={state.weekStartDate}
        weeklyPlanningRevision={state.revision}
        weeklyPlanningPendingTurn={undefined}
        weeklyPlanningPendingApproval={undefined}
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
        onClose={() => requestExit()}
        onSaveTodo={onSaveTodo}
        onSavePlan={onSavePlan}
        onSaveStandaloneActual={onSaveStandaloneActual}
        onSaveLinkedActual={onSaveLinkedActual}
      />
    </div>
  );
}
