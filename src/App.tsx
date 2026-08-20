import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { House, Settings } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { HomeView } from './components/HomeView';
import { SplashScreen } from './components/SplashScreen';
import { LegalPage } from './components/LegalPage';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { AppViewSwitcher } from './components/AppViewSwitcher';
import type { BookshelfInitialAction } from './components/BookshelfView';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { RecurringPlanScopeDialog } from './components/RecurringPlanScopeDialog';
import { StudyPlannerLogo } from './components/StudyPlannerLogo';
import { UserAvatar } from './components/UserAvatar';
import { useWeeklyPlanningApplication } from './features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';
import {
  hasStoredAppAccessGrant,
  isAppAccessGateEnabled,
  verifyAndStoreAppAccessKey,
} from './lib/appAccessGate';
import { getUserDisplayName } from './lib/userProfile';

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
const WeeklyPlanningQuickEntryModal = lazy(() =>
  import('./components/WeeklyPlanningQuickEntryModal').then((module) => ({
    default: module.WeeklyPlanningQuickEntryModal,
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
  const [isHomeView, setIsHomeView] = useState(true);
  const [bookshelfInitialAction, setBookshelfInitialAction] =
    useState<BookshelfInitialAction>(null);
  const [appAccessGranted, setAppAccessGranted] = useState(
    () => !isAppAccessGateEnabled() || hasStoredAppAccessGrant(),
  );
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
    saveWeeklyApprovedPlan,
    completeWeeklyApprovalOperation,
    deletePlan,
    confirmRecurringPlanScope,
    cancelRecurringPlanScope,
    saveActual,
    saveStandaloneActual,
    linkStandaloneActualToPlan,
    deleteActual,
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
  } = usePlannerAppState();
  const activeTimetableTerm = useMemo(
    () =>
      timetableTerms.find((term) => term.isActive) ??
      timetableTerms[0] ??
      null,
    [timetableTerms],
  );
  const activeTimetableTermId = activeTimetableTerm?.id ?? 'default';
  const weeklyPlanning = useWeeklyPlanningApplication({
    userId: user?.id,
    selectedDate,
    plans,
    actuals,
    scheduleTemplates,
    timetableTermId: activeTimetableTermId,
    saveWeeklyApprovedPlan,
    completeWeeklyApprovalOperation,
  });
  const currentPath = window.location.pathname;

  useEffect(() => {
    if (user?.id) {
      setIsHomeView(true);
    }
  }, [user?.id]);

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
    <div className={isHomeView ? 'app-shell home-app-shell' : 'app-shell'}>
      {!isHomeView ? (
        <>
          <header className="app-header hero-card print-hide">
            <StudyPlannerLogo />
            <div className="header-actions">
              <button
                className="ghost-button header-home-button"
                onClick={() => setIsHomeView(true)}
                type="button"
                aria-label="ホームへ戻る"
                title="ホーム"
              >
                <House aria-hidden="true" size={21} strokeWidth={1.9} />
              </button>
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

          <AppViewSwitcher
            viewMode={viewMode}
            onChange={(nextViewMode) => {
              setIsHomeView(false);
              setViewMode(nextViewMode);
            }}
          />
        </>
      ) : null}

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

      <main className={isHomeView ? 'home-main' : 'section-stack'}>
        {isHomeView ? (
          <HomeView
            user={user}
            plans={plans}
            actuals={actuals}
            todos={todos}
            studyMaterials={studyMaterials}
            onOpenAiPlanning={() => setIsQuickEntryOpen(true)}
            onOpenSchedule={() => {
              setIsHomeView(false);
              setViewMode('month');
            }}
            onOpenDay={(date) => {
              setIsHomeView(false);
              openDay(date);
            }}
            onOpenTodo={() => {
              setIsHomeView(false);
              setViewMode('todo');
            }}
            onOpenBookshelf={() => {
              setIsHomeView(false);
              setViewMode('bookshelf');
            }}
            onOpenReport={() => {
              setIsHomeView(false);
              setViewMode('report');
            }}
            onOpenProfile={() => setIsMyPageOpen(true)}
            onOpenSettings={() => setIsAppSettingsOpen(true)}
          />
        ) : null}

        {!isHomeView && viewMode === 'month' ? (
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

        {!isHomeView ? (
          <Suspense fallback={<SplashScreen />}>
            {viewMode === 'week' ? (
              <WeekView
                selectedDate={selectedDate}
                plans={plans}
                actuals={actuals}
                weeklyDraftBlocks={weeklyPlanning.pendingDraftBlocks}
                onRemoveWeeklyDraftBlock={weeklyPlanning.canEditDraftBlocks
                  ? weeklyPlanning.removeDraftBlock
                  : undefined}
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
                weeklyDraftBlocks={weeklyPlanning.pendingDraftBlocks}
                onRemoveWeeklyDraftBlock={weeklyPlanning.canEditDraftBlocks
                  ? weeklyPlanning.removeDraftBlock
                  : undefined}
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
                plans={plans}
                actuals={actuals}
                studySubjects={studySubjects}
                studyMaterials={studyMaterials}
                onOpenDay={openDay}
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
        ) : null}
      </main>

      {!isHomeView && (viewMode === 'day' || viewMode === 'todo') ? (
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
          <WeeklyPlanningQuickEntryModal
            application={weeklyPlanning}
            userId={user.id}
            selectedDate={selectedDate}
            plans={plans}
            actuals={actuals}
            materials={studyMaterials}
            subjects={studySubjects}
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
