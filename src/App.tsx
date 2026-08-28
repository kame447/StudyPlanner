import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { HomeView } from './components/HomeView';
import { SplashScreen } from './components/SplashScreen';
import { StudySessionProvider } from './components/StudySessionView';
import { LegalPage } from './components/LegalPage';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { AppViewSwitcher } from './components/AppViewSwitcher';
import type { BookshelfInitialAction } from './components/BookshelfView';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { PrimaryAppHeader } from './components/PrimaryAppHeader';
import {
  PrimaryBottomNav,
  type PrimaryNavItem,
} from './components/PrimaryBottomNav';
import { QuickAddMenu } from './components/QuickAddMenu';
import { RecurringPlanScopeDialog } from './components/RecurringPlanScopeDialog';
import { ScheduleToolbar } from './components/ScheduleToolbar';
import { useWeeklyPlanningApplication } from './features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';
import {
  hasStoredAppAccessGrant,
  isAppAccessGateEnabled,
  verifyAndStoreAppAccessKey,
} from './lib/appAccessGate';
import type { ViewMode } from './types/domain';

const AiPlanningView = lazy(() =>
  import('./components/AiPlanningView').then((module) => ({
    default: module.AiPlanningView,
  })),
);
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

type PrimarySurface = 'home' | 'ai-planning' | 'workspace';

const SCHEDULE_VIEW_MODES = new Set<ViewMode>(['month', 'week', 'day', 'todo']);

export default function App() {
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [monthCreateRequestId, setMonthCreateRequestId] = useState(0);
  const [pendingMonthCreate, setPendingMonthCreate] = useState(false);
  const [primarySurface, setPrimarySurface] = useState<PrimarySurface>('home');
  const [bookshelfInitialAction, setBookshelfInitialAction] =
    useState<BookshelfInitialAction>(null);
  const [appAccessGranted, setAppAccessGranted] = useState(
    () => !isAppAccessGateEnabled() || hasStoredAppAccessGrant(),
  );
  const primaryHeaderRef = useRef<HTMLDivElement | null>(null);
  const primaryBottomNavRef = useRef<HTMLElement | null>(null);
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
    movePlanOccurrence,
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
    timetableTerm: activeTimetableTerm,
    timetableTerms,
    saveWeeklyApprovedPlan,
    completeWeeklyApprovalOperation,
  });
  const currentPath = window.location.pathname;
  const isHomeSurface = primarySurface === 'home';
  const isAiPlanningSurface = primarySurface === 'ai-planning';
  const isWorkspaceSurface = primarySurface === 'workspace';
  const isScheduleSurface = isWorkspaceSurface && SCHEDULE_VIEW_MODES.has(viewMode);
  const activePrimaryNav: PrimaryNavItem = isHomeSurface
    ? 'home'
    : isAiPlanningSurface
      ? 'ai-planning'
      : viewMode === 'bookshelf'
        ? 'bookshelf'
        : viewMode === 'timetable'
          ? 'timetable'
          : viewMode === 'report'
            ? 'home'
            : 'schedule';
  const primaryNavClassName = isScheduleSurface
    ? 'schedule-bottom-nav'
    : isAiPlanningSurface
      ? 'ai-planning-home-nav'
      : viewMode === 'bookshelf'
        ? 'bookshelf-bottom-nav'
        : viewMode === 'timetable'
          ? 'timetable-bottom-nav'
          : undefined;
  const primaryHeaderClassName = isScheduleSurface
    ? 'schedule-primary-header'
    : isAiPlanningSurface
      ? 'ai-planning-primary-header'
      : isWorkspaceSurface && viewMode === 'timetable'
        ? 'timetable-primary-header'
        : isWorkspaceSurface
          ? 'workspace-primary-header'
          : 'home-primary-header';

  useEffect(() => {
    if (user?.id) {
      setPrimarySurface('home');
    }
  }, [user?.id]);

  useEffect(() => {
    if (!pendingMonthCreate || !isScheduleSurface || viewMode !== 'month') {
      return;
    }

    setMonthCreateRequestId((current) => current + 1);
    setPendingMonthCreate(false);
  }, [isScheduleSurface, pendingMonthCreate, viewMode]);

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
    return <SplashScreen fixedLight />;
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

  function openAiPlanningSurface() {
    setPrimarySurface('ai-planning');
  }

  function openScheduleSurface() {
    setPrimarySurface('workspace');
    setViewMode('month');
  }

  function openMonthEventCreate() {
    setPrimarySurface('workspace');

    if (isScheduleSurface && viewMode === 'month') {
      setMonthCreateRequestId((current) => current + 1);
      return;
    }

    setPendingMonthCreate(true);
    setViewMode('month');
  }

  function openHomeSurface() {
    setPrimarySurface('home');
  }

  function openBookshelfSurface() {
    setPrimarySurface('workspace');
    setViewMode('bookshelf');
  }

  function openReportSurface() {
    setPrimarySurface('workspace');
    setViewMode('report');
  }

  function openTimetableSurface() {
    setPrimarySurface('workspace');
    setViewMode('timetable');
  }

  const primaryNavigation = {
    onOpenAiPlanning: openAiPlanningSurface,
    onOpenSchedule: openScheduleSurface,
    onOpenHome: openHomeSurface,
    onOpenBookshelf: openBookshelfSurface,
    onOpenTimetable: openTimetableSurface,
  };

  return (
    <div
      className={
        isWorkspaceSurface
          ? isScheduleSurface
            ? 'app-shell schedule-workspace-shell'
            : 'app-shell'
          : 'app-shell home-app-shell'
      }
    >
      <PrimaryAppHeader
        ref={primaryHeaderRef}
        user={user}
        plans={plans}
        actuals={actuals}
        todos={todos}
        onOpenProfile={() => setIsMyPageOpen(true)}
        onOpenSettings={() => setIsAppSettingsOpen(true)}
        className={primaryHeaderClassName}
      />

      {isWorkspaceSurface ? (
        isScheduleSurface ? (
          <ScheduleToolbar
            viewMode={viewMode}
            selectedDate={selectedDate}
            monthDate={monthDate}
            onChangeView={(nextViewMode) => setViewMode(nextViewMode)}
            onChangeMonth={changeMonth}
            onChangeWeek={openWeek}
            onChangeDay={openDay}
          />
        ) : viewMode === 'timetable' || viewMode === 'report' ? null : (
          <AppViewSwitcher
            viewMode={viewMode}
            onChange={(nextViewMode) => {
              setPrimarySurface('workspace');
              setViewMode(nextViewMode);
            }}
          />
        )
      ) : null}

      {notice ? (
        <div
          className={`app-toast-layer print-hide ${notice.placement ?? 'top'}`}
          aria-live="polite"
        >
          <div className={`app-notice app-toast ${notice.tone}`}>
            <span>{notice.text}</span>
            {notice.actionLabel && notice.onAction ? (
              <button
                className="app-toast-action"
                onClick={() => {
                  void notice.onAction?.();
                }}
                type="button"
              >
                {notice.actionLabel}
              </button>
            ) : null}
            <button
              className="app-toast-close"
              onClick={dismissNotice}
              type="button"
              aria-label="通知を閉じる"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <main
        className={
          isWorkspaceSurface
            ? isScheduleSurface
              ? 'section-stack schedule-main'
              : 'section-stack'
            : 'home-main'
        }
      >
        {isHomeSurface ? (
          <StudySessionProvider materials={studyMaterials} onSaveActual={saveActual}>
            <HomeView
              plans={plans}
              actuals={actuals}
              todos={todos}
              studyMaterials={studyMaterials}
              primaryHeaderRef={primaryHeaderRef}
              primaryBottomNavRef={primaryBottomNavRef}
              onOpenAiPlanning={openAiPlanningSurface}
              onOpenSchedule={openScheduleSurface}
              onOpenDay={(date) => {
                setPrimarySurface('workspace');
                openDay(date);
              }}
              onOpenTodo={() => {
                setPrimarySurface('workspace');
                setViewMode('todo');
              }}
              onOpenBookshelf={openBookshelfSurface}
              onOpenReport={openReportSurface}
            />
          </StudySessionProvider>
        ) : null}

        {isAiPlanningSurface ? (
          <Suspense fallback={<SplashScreen />}>
            <AiPlanningView
              application={weeklyPlanning}
              userId={user.id}
              selectedDate={selectedDate}
              plans={plans}
            />
          </Suspense>
        ) : null}

        {isWorkspaceSurface && viewMode === 'month' ? (
          <MonthView
            monthDate={monthDate}
            selectedDate={selectedDate}
            userId={user.id}
            plans={plans}
            actuals={actuals}
            monthEvents={monthEvents}
            createRequestId={monthCreateRequestId}
            onSelectDate={selectDate}
            onChangeMonth={changeMonth}
            onOpenWeek={openWeek}
            onSaveMonthEvent={saveMonthEvent}
            onDeleteMonthEvent={deleteMonthEvent}
          />
        ) : null}

        {isWorkspaceSurface ? (
          <Suspense fallback={<SplashScreen />}>
            {viewMode === 'week' ? (
              <WeekView
                selectedDate={selectedDate}
                plans={plans}
                actuals={actuals}
                weeklyDraftBlocks={weeklyPlanning.pendingDraftBlocks}
                onRemoveWeeklyDraftBlock={
                  weeklyPlanning.canEditDraftBlocks
                    ? weeklyPlanning.removeDraftBlock
                    : undefined
                }
                onOpenPlan={openEditPlan}
                onMovePlan={movePlanOccurrence}
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
                timetableTerm={activeTimetableTerm}
                timetableTerms={timetableTerms}
                weeklyDraftBlocks={weeklyPlanning.pendingDraftBlocks}
                onRemoveWeeklyDraftBlock={
                  weeklyPlanning.canEditDraftBlocks
                    ? weeklyPlanning.removeDraftBlock
                    : undefined
                }
                onChangeDay={openDay}
                onEditPlan={openEditPlan}
                onMovePlan={movePlanOccurrence}
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
                onBack={openHomeSurface}
              />
            ) : null}

            {viewMode === 'timetable' ? (
              <TimetableView
                userId={user.id}
                activeTerm={activeTimetableTerm}
                timetableTerms={timetableTerms}
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
                plans={plans}
                actuals={actuals}
                initialAction={bookshelfInitialAction}
                onInitialActionHandled={() => setBookshelfInitialAction(null)}
                onSaveSubject={saveStudySubject}
                onDeleteSubject={deleteStudySubject}
                onSaveMaterial={saveStudyMaterial}
                onDeleteMaterial={deleteStudyMaterial}
                onAddMaterialToPlan={() => setIsQuickEntryOpen(true)}
              />
            ) : null}
          </Suspense>
        ) : null}
      </main>

      {isScheduleSurface ? (
        <QuickAddMenu
          onAddSchedule={openMonthEventCreate}
          onAddStudy={() => setIsQuickEntryOpen(true)}
          onOpenAiPlanning={openAiPlanningSurface}
        />
      ) : null}

      <PrimaryBottomNav
        ref={primaryBottomNavRef}
        active={activePrimaryNav}
        className={primaryNavClassName}
        {...primaryNavigation}
      />

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
          onSelect={(scope) => {
            void confirmRecurringPlanScope(scope);
          }}
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
