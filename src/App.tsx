import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { SplashScreen } from './components/SplashScreen';
import { LegalPage } from './components/LegalPage';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import type { BookshelfInitialAction } from './components/BookshelfView';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { RecurringPlanScopeDialog } from './components/RecurringPlanScopeDialog';
import { StudyPlannerLogo } from './components/StudyPlannerLogo';
import { UserAvatar } from './components/UserAvatar';
import { createEmptyDayNoteDraft } from './domain/planner';
import {
  createWeeklyDraftApprovalOperation,
  executeWeeklyDraftApproval,
  parseWeeklyApprovalLedger,
  serializeWeeklyApprovalLedger,
  validateWeeklyPreviewApproval,
} from './features/weeklyPlanning/planning/weeklyPlanningApproval';
import type { WeeklyDraftApprovalOperation } from './features/weeklyPlanning/planning/weeklyPlanningApprovalTypes';
import type {
  WeeklyPlanningMessage,
  WeeklyPlanningPendingApproval,
  WeeklyPlanningPendingTurn,
} from './features/weeklyPlanning/types';
import { useWeeklyPlanningState } from './features/weeklyPlanning/useWeeklyPlanningState';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnSubmissionResult,
} from './features/weeklyPlanning/weeklyPlanningTurnExecutor';
import { createPlanDraftFromWeeklyDraftBlock } from './features/weeklyPlanning/weeklyPlanningTransforms';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';
import {
  hasStoredAppAccessGrant,
  isAppAccessGateEnabled,
  verifyAndStoreAppAccessKey,
} from './lib/appAccessGate';
import { getUserDisplayName } from './lib/userProfile';

const WEEKLY_APPROVAL_LEDGER_KEY = 'studyplanner-weekly-approval-ledger-v1';

function loadWeeklyApprovalOperations(): WeeklyDraftApprovalOperation[] {
  if (typeof window === 'undefined') return [];
  const value = window.localStorage.getItem(WEEKLY_APPROVAL_LEDGER_KEY);
  return value ? parseWeeklyApprovalLedger(value)?.operations ?? [] : [];
}

function createWeeklyPlanningRequestId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createWeeklyPlanningMessage(
  role: WeeklyPlanningMessage['role'],
  content: string,
): WeeklyPlanningMessage {
  return {
    id: createWeeklyPlanningRequestId(`weekly-${role}-message`),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

const BookshelfView = lazy(() =>
  import('./components/BookshelfView').then((module) => ({
    default: module.BookshelfView,
  })),
);
const DayView = lazy(() =>
  import('./components/DayView').then((module) => ({
    default: module.DayView,
  })),
);
const QuickEntryModal = lazy(() =>
  import('./components/QuickEntryModal').then((module) => ({
    default: module.QuickEntryModal,
  })),
);
const ReportView = lazy(() =>
  import('./components/ReportView').then((module) => ({
    default: module.ReportView,
  })),
);
const TimetableView = lazy(() =>
  import('./components/TimetableView').then((module) => ({
    default: module.TimetableView,
  })),
);
const TodoView = lazy(() =>
  import('./components/TodoView').then((module) => ({
    default: module.TodoView,
  })),
);
const WeekView = lazy(() =>
  import('./components/WeekView').then((module) => ({
    default: module.WeekView,
  })),
);

export default function App() {
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [bookshelfInitialAction, setBookshelfInitialAction] =
    useState<BookshelfInitialAction>(null);
  const [appAccessGranted, setAppAccessGranted] = useState(
    () => !isAppAccessGateEnabled() || hasStoredAppAccessGrant(),
  );
  const [weeklyApprovalOperations, setWeeklyApprovalOperations] =
    useState<WeeklyDraftApprovalOperation[]>(loadWeeklyApprovalOperations);
  const { themeMode, setThemeMode, themePalette, setThemePalette } =
    useThemePreference();
  const {
    booting,
    user,
    plans,
    actuals,
    monthEvents,
    todos,
    studySubjects,
    studyMaterials,
    scheduleTemplates,
    timetableTerms,
    timetablePeriods,
    viewMode,
    selectedDate,
    monthDate,
    notice,
    dismissNotice,
    editorDraft,
    editingPlanId,
    editingPlan,
    isRecurringPlanEdit,
    pendingRecurringPlanAction,
    setViewMode,
    signUpWithPassword,
    signInWithPassword,
    signInWithGoogle,
    sendPasswordReset,
    saveUserProfile,
    signOut,
    openEditPlan,
    closePlanEditor,
    savePlanDraft,
    deletePlan,
    confirmRecurringPlanScope,
    cancelRecurringPlanScope,
    saveActual,
    saveStandaloneActual,
    linkStandaloneActualToPlan,
    deleteActual,
    saveDayNote,
    saveMonthEvent,
    deleteMonthEvent,
    saveTodo,
    scheduleTodoAsPlan,
    deleteTodo,
    saveStudySubject,
    deleteStudySubject,
    saveStudyMaterial,
    deleteStudyMaterial,
    saveScheduleTemplate,
    deleteScheduleTemplate,
    activateTimetableTerm,
    clearTimetableTermData,
    saveTimetablePeriod,
    deleteTimetablePeriod,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote,
  } = usePlannerAppState();
  const planningUserId = user?.id ?? 'anonymous';
  const { planningState, dispatchPlanningAction, getPlanningState } = useWeeklyPlanningState(
    planningUserId,
    selectedDate,
  );
  const pendingWeeklyDraftBlocks = useMemo(
    () => planningState.draftBlocks.filter((block) => block.status === 'draft'),
    [planningState.draftBlocks],
  );
  const activeTimetableTerm = useMemo(
    () =>
      timetableTerms.find((term) => term.isActive) ??
      timetableTerms[0] ??
      null,
    [timetableTerms],
  );
  const activeTimetableTermId = activeTimetableTerm?.id ?? 'default';
  const currentPath = window.location.pathname;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      WEEKLY_APPROVAL_LEDGER_KEY,
      serializeWeeklyApprovalLedger(weeklyApprovalOperations),
    );
  }, [weeklyApprovalOperations]);

  async function submitWeeklyPlanningTurn(
    userText: string,
  ): Promise<WeeklyPlanningTurnSubmissionResult> {
    const snapshot = getPlanningState();
    if (!user || snapshot.pendingTurn || snapshot.pendingApproval) {
      return { accepted: false, draftCandidates: [] };
    }

    const pending: WeeklyPlanningPendingTurn = {
      requestId: createWeeklyPlanningRequestId('weekly-turn'),
      weekStartDate: snapshot.weekStartDate,
      baseRevision: snapshot.revision,
      startedAt: new Date().toISOString(),
    };
    const userMessage = createWeeklyPlanningMessage('user', userText);
    const begun = dispatchPlanningAction({ type: 'begin_turn', pending, userMessage });
    if (begun.pendingTurn?.requestId !== pending.requestId) {
      return { accepted: false, draftCandidates: [] };
    }

    try {
      const result = await executeWeeklyPlanningTurn({
        previousState: snapshot.intakeState,
        messages: snapshot.messages,
        userText,
        selectedDate,
        userId: user.id,
        plans,
        scheduleTemplates,
        timetableTermId: activeTimetableTermId,
        traceRequestId: pending.requestId,
      });
      const assistantMessage = createWeeklyPlanningMessage('assistant', result.message);
      const committed = dispatchPlanningAction({
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
    } catch {
      const message = '週間計画の会話状態を更新できませんでした。';
      dispatchPlanningAction({
        type: 'fail_turn',
        pending,
        assistantMessage: createWeeklyPlanningMessage('assistant', message),
      });
      throw new Error(message);
    }
  }

  async function approveWeeklyDraftBlocks() {
    if (!user) return;
    const snapshot = getPlanningState();
    const blocks = snapshot.draftBlocks.filter((block) => block.status === 'draft');
    if (blocks.length === 0 || snapshot.pendingTurn || snapshot.pendingApproval) return;

    const pending: WeeklyPlanningPendingApproval = {
      requestId: createWeeklyPlanningRequestId('weekly-approval'),
      weekStartDate: snapshot.weekStartDate,
      baseRevision: snapshot.revision,
      blockIds: blocks.map((block) => block.id),
      startedAt: new Date().toISOString(),
    };
    const begun = dispatchPlanningAction({ type: 'begin_approval', pending });
    if (begun.pendingApproval?.requestId !== pending.requestId) return;

    try {
      const firstMetadata = blocks[0]?.behaviorMetadata?.previewMetadata;
      const proposalRecords = (firstMetadata?.assumptionDependencies ?? []).map((dependency) => ({
        proposalId: dependency.proposalId,
        conversationId: 'weekly-planning-session',
        slot: 'duration' as const,
        targetRef: dependency.targetRef,
        proposedValue: 0,
        proposedUnit: 'minutes' as const,
        reasonCode: 'missing_duration' as const,
        sourceFactRefs: [dependency.targetRef],
        createdAtTurnId: 'preview-dependency',
        createdFromStateRevision: dependency.proposalCreatedFromStateRevision,
        status: 'pending' as const,
      }));
      const guard = validateWeeklyPreviewApproval({
        blocks,
        currentStateRevision: firstMetadata?.stateRevision ?? -1,
        userId: user.id,
        proposalRecords,
      });
      if (!guard.allowed) {
        switch (guard.attempt.kind) {
          case 'stale_preview_approval_attempt':
            throw new Error('現在の条件と一致しない仮予定です。最新条件で再計算してください。');
          case 'pending_assumption_preview_approval_attempt':
            throw new Error('未確認の仮定があります。仮定を確認してから最新案を再計算してください。');
          default:
            throw new Error('この仮予定は保存できません。最新案を作り直してください。');
        }
      }

      const existingOperation = weeklyApprovalOperations.find((operation) =>
        operation.userId === user.id
        && operation.previewId === guard.metadata.previewId
        && operation.previewStateRevision === guard.metadata.stateRevision,
      );
      const operation = existingOperation ?? createWeeklyDraftApprovalOperation({
        userId: user.id,
        metadata: guard.metadata,
        blocks,
        now: new Date().toISOString(),
      });
      const result = await executeWeeklyDraftApproval({
        operation,
        blocks,
        dependencies: {
          async findExistingPlanId({ sourceDraftBlockId }) {
            const marker = `[weekly-source:${sourceDraftBlockId}]`;
            return plans.find((plan) => plan.userId === user.id && plan.memo.includes(marker))?.id;
          },
          async saveBlock({ block, source }) {
            const draft = createPlanDraftFromWeeklyDraftBlock(block, user.id);
            const sourceMarker = `[weekly-source:${source.sourceDraftBlockId}]`;
            const operationMarker = `[weekly-approval:${source.approvalOperationId}]`;
            await savePlanDraft({
              ...draft,
              memo: [draft.memo, sourceMarker, operationMarker].filter(Boolean).join(' / '),
            });
            return { planId: `weekly-plan:${source.sourceDraftBlockId}` };
          },
          now: () => new Date().toISOString(),
        },
      });
      setWeeklyApprovalOperations((current) => [
        ...current.filter((item) => item.approvalOperationId !== result.approvalOperationId),
        result,
      ]);
      const completedBlockIds = result.items
        .filter((item) => item.status === 'saved' || item.status === 'skipped_duplicate')
        .map((item) => item.sourceDraftBlockId);
      const failed = result.status === 'failed' || result.status === 'partially_saved';
      const message = failed
        ? '一部の仮予定を保存できませんでした。未保存分だけ再試行できます。'
        : `${completedBlockIds.length}件の仮予定を通常予定として保存しました。`;
      dispatchPlanningAction({
        type: 'complete_approval',
        pending,
        completedBlockIds,
        assistantMessage: createWeeklyPlanningMessage('assistant', message),
      });
      if (failed) throw new Error(message);
    } catch (error) {
      const current = getPlanningState();
      if (current.pendingApproval?.requestId === pending.requestId) {
        dispatchPlanningAction({ type: 'fail_approval', pending });
      }
      throw error;
    }
  }

  if (currentPath === '/terms') {
    return <LegalPage kind="terms" />;
  }

  if (currentPath === '/privacy') {
    return <LegalPage kind="privacy" />;
  }

  if (currentPath === '/contact') {
    return <LegalPage kind="contact" />;
  }

  if (booting) {
    return <SplashScreen />;
  }

  if (!user || !appAccessGranted) {
    return (
      <AuthScreen
        notice={notice}
        onDismissNotice={dismissNotice}
        accessGateEnabled={isAppAccessGateEnabled()}
        accessGateUnlocked={appAccessGranted}
        onUnlockAccessGate={(key) => {
          const didUnlock = verifyAndStoreAppAccessKey(key);
          if (didUnlock) setAppAccessGranted(true);
          return didUnlock;
        }}
        onSignUpWithPassword={signUpWithPassword}
        onSignInWithPassword={signInWithPassword}
        onSignInWithGoogle={signInWithGoogle}
        onSendPasswordReset={sendPasswordReset}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header hero-card print-hide">
        <StudyPlannerLogo />
        <div className="header-actions">
          <div className="user-badge header-profile-name">
            {getUserDisplayName(user)}
          </div>
          <button
            className="ghost-button my-page-trigger"
            onClick={() => setIsMyPageOpen(true)}
            type="button"
            aria-label="マイページを開く"
          >
            <UserAvatar user={user} small />
            <span className="my-page-trigger-label">マイページ</span>
          </button>
          <button
            className="ghost-button header-settings-button"
            onClick={() => setIsAppSettingsOpen(true)}
            type="button"
            aria-label="アプリ設定を開く"
            title="アプリ設定"
          >
            <Settings aria-hidden="true" size={22} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <div className="toolbar panel app-view-switcher print-hide">
        <div className="segmented-control">
          <button className={viewMode === 'month' ? 'segment active' : 'segment'} onClick={() => setViewMode('month')} type="button">月</button>
          <button className={viewMode === 'week' ? 'segment active' : 'segment'} onClick={() => setViewMode('week')} type="button">週</button>
          <button className={viewMode === 'day' ? 'segment active' : 'segment'} onClick={() => setViewMode('day')} type="button">日</button>
          <button className={viewMode === 'todo' ? 'segment active' : 'segment'} onClick={() => setViewMode('todo')} type="button">Todo</button>
          <button className={viewMode === 'report' ? 'segment active' : 'segment'} onClick={() => setViewMode('report')} type="button">レポート</button>
          <button className={viewMode === 'timetable' ? 'segment active' : 'segment'} onClick={() => setViewMode('timetable')} type="button">時間割</button>
          <button className={viewMode === 'bookshelf' ? 'segment active' : 'segment'} onClick={() => setViewMode('bookshelf')} type="button">本棚</button>
        </div>
      </div>

      {notice ? (
        <div className={`app-toast-layer print-hide ${notice.placement ?? 'top'}`} aria-live="polite">
          <div className={`app-notice app-toast ${notice.tone}`}>
            <span>{notice.text}</span>
            {notice.actionLabel && notice.onAction ? (
              <button className="app-toast-action" onClick={() => { void notice.onAction?.(); }} type="button">
                {notice.actionLabel}
              </button>
            ) : null}
            <button className="app-toast-close" onClick={dismissNotice} type="button" aria-label="通知を閉じる">×</button>
          </div>
        </div>
      ) : null}

      <main className="section-stack">
        {viewMode === 'month' ? (
          <MonthView
            monthDate={monthDate}
            selectedDate={selectedDate}
            userId={user.id}
            plans={plans}
            actuals={actuals}
            monthEvents={monthEvents}
            onSelectDate={selectDate}
            onChangeMonth={changeMonth}
            onOpenWeek={openWeek}
            onSaveMonthEvent={saveMonthEvent}
            onDeleteMonthEvent={deleteMonthEvent}
          />
        ) : null}

        <Suspense fallback={<SplashScreen />}>
          {viewMode === 'week' ? (
            <WeekView
              selectedDate={selectedDate}
              plans={plans}
              actuals={actuals}
              weeklyDraftBlocks={pendingWeeklyDraftBlocks}
              onRemoveWeeklyDraftBlock={planningState.pendingTurn || planningState.pendingApproval
                ? undefined
                : (blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}
              onChangeWeek={openWeek}
              onOpenDay={openDay}
            />
          ) : null}

          {viewMode === 'day' ? (
            <DayView
              selectedDate={selectedDate}
              userId={user.id}
              plans={plans}
              actuals={actuals}
              monthEvents={monthEvents}
              studySubjects={studySubjects}
              studyMaterials={studyMaterials}
              scheduleTemplates={scheduleTemplates}
              timetableTermId={activeTimetableTermId}
              weeklyDraftBlocks={pendingWeeklyDraftBlocks}
              onRemoveWeeklyDraftBlock={planningState.pendingTurn || planningState.pendingApproval
                ? undefined
                : (blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}
              onChangeDay={openDay}
              onEditPlan={openEditPlan}
              onDeletePlan={deletePlan}
              onSavePlan={savePlanDraft}
              onSaveActual={saveActual}
              onSaveStandaloneActual={saveStandaloneActual}
              onLinkStandaloneActualToPlan={linkStandaloneActualToPlan}
              onDeleteActual={deleteActual}
              onOpenBookshelf={() => setViewMode('bookshelf')}
              onOpenAddMaterial={() => {
                setBookshelfInitialAction('add-material');
                setViewMode('bookshelf');
              }}
            />
          ) : null}

          {viewMode === 'todo' ? (
            <TodoView
              userId={user.id}
              selectedDate={selectedDate}
              todos={todos}
              onSaveTodo={saveTodo}
              onScheduleTodo={scheduleTodoAsPlan}
              onDeleteTodo={deleteTodo}
            />
          ) : null}

          {viewMode === 'report' ? (
            <ReportView
              selectedDate={selectedDate}
              dayNote={currentDayNote ?? createEmptyDayNoteDraft(user.id, selectedDate)}
              plans={plans}
              actuals={actuals}
              monthEvents={monthEvents}
              studySubjects={studySubjects}
              studyMaterials={studyMaterials}
              onOpenDay={openDay}
              onSaveDayNote={saveDayNote}
            />
          ) : null}

          {viewMode === 'timetable' ? (
            <TimetableView
              userId={user.id}
              activeTerm={activeTimetableTerm}
              timetablePeriods={timetablePeriods}
              scheduleTemplates={scheduleTemplates}
              onActivateTerm={activateTimetableTerm}
              onClearTermData={clearTimetableTermData}
              onSaveTimetablePeriod={saveTimetablePeriod}
              onDeleteTimetablePeriod={deleteTimetablePeriod}
              onSaveScheduleTemplate={saveScheduleTemplate}
              onDeleteScheduleTemplate={deleteScheduleTemplate}
            />
          ) : null}

          {viewMode === 'bookshelf' ? (
            <BookshelfView
              userId={user.id}
              subjects={studySubjects}
              materials={studyMaterials}
              initialAction={bookshelfInitialAction}
              onInitialActionHandled={() => setBookshelfInitialAction(null)}
              onSaveSubject={saveStudySubject}
              onDeleteSubject={deleteStudySubject}
              onSaveMaterial={saveStudyMaterial}
              onDeleteMaterial={deleteStudyMaterial}
            />
          ) : null}
        </Suspense>
      </main>

      {viewMode === 'day' || viewMode === 'todo' ? (
        <button className="daily-add-fab print-hide" onClick={() => setIsQuickEntryOpen(true)} type="button" aria-label="新規追加">
          <span aria-hidden="true">＋</span>
        </button>
      ) : null}

      <PlanEditorPanel
        draft={editorDraft}
        submitLabel={editingPlanId ? '学習予定を更新' : '学習予定を追加'}
        heading={editingPlanId ? '学習予定を編集' : '学習予定を追加'}
        recurringEditMode={Boolean(editingPlan && isRecurringPlanEdit)}
        onChange={setEditorDraft}
        onSubmit={() => {
          if (editorDraft) return savePlanDraft(editorDraft);
          return Promise.resolve();
        }}
        onCancel={closePlanEditor}
      />

      {pendingRecurringPlanAction ? (
        <RecurringPlanScopeDialog
          action={pendingRecurringPlanAction.kind}
          plan={pendingRecurringPlanAction.plan}
          onSelect={(scope) => { void confirmRecurringPlanScope(scope); }}
          onClose={cancelRecurringPlanScope}
        />
      ) : null}

      {isQuickEntryOpen ? (
        <Suspense fallback={null}>
          <QuickEntryModal
            userId={user.id}
            selectedDate={selectedDate}
            plans={plans}
            actuals={actuals}
            materials={studyMaterials}
            subjects={studySubjects}
             weeklyDraftBlocks={pendingWeeklyDraftBlocks}
             weeklyPlanningPreviewCandidates={planningState.previewCandidates ?? []}
             weeklyPlanningMessages={planningState.messages}

              weeklyPlanningIntakeState={planningState.intakeState ?? null}
              weeklyPlanningWeekStartDate={planningState.weekStartDate}
              weeklyPlanningRevision={planningState.revision}
              weeklyPlanningPendingTurn={planningState.pendingTurn}
              weeklyPlanningPendingApproval={planningState.pendingApproval}
              onSubmitWeeklyPlanningTurn={submitWeeklyPlanningTurn}
              onAppendWeeklyPlanningMessage={(message) =>
                dispatchPlanningAction({ type: 'append_message', message })
              }
              onResetWeeklyPlanningSession={() =>
                dispatchPlanningAction({ type: 'reset_session' })
              }
               onCreateWeeklyDraftBlocks={(blocks) => dispatchPlanningAction({ type: 'add_draft_blocks', blocks })}
             onRemoveWeeklyPlanningPreviewCandidate={(candidateId) =>
               dispatchPlanningAction({ type: 'remove_preview_candidate', candidateId })
             }
             onRemoveWeeklyDraftBlock={(blockId) => dispatchPlanningAction({ type: 'remove_draft_block', blockId })}

            onClearWeeklyDraftBlocks={() => dispatchPlanningAction({ type: 'clear_draft_blocks' })}
            onApproveWeeklyDraftBlocks={approveWeeklyDraftBlocks}
            onClose={() => setIsQuickEntryOpen(false)}
            onSaveTodo={saveTodo}
            onSavePlan={savePlanDraft}
            onSaveStandaloneActual={saveStandaloneActual}
            onSaveLinkedActual={saveActual}
          />
        </Suspense>
      ) : null}

      <MyPageDialog
        open={isMyPageOpen}
        user={user}
        onSaveProfile={saveUserProfile}
        onSignOut={signOut}
        onClose={() => setIsMyPageOpen(false)}
      />

      <AppSettingsDialog
        open={isAppSettingsOpen}
        themeMode={themeMode}
        themePalette={themePalette}
        onChangeTheme={setThemeMode}
        onChangeThemePalette={setThemePalette}
        onClose={() => setIsAppSettingsOpen(false)}
      />
    </div>
  );
}
