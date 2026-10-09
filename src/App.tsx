import { HomeDisplayClockProvider } from './components/home/HomeDisplayClockContext';
import { useSettingsNavigation } from './hooks/useSettingsNavigation';
import { HomeSceneAtmosphereProvider } from './components/home/HomeSceneAtmosphereContext';
import { useHomeScenePreference } from './hooks/useHomeScenePreference';
import { RootStartupReadyProvider, useRootStartupReady } from './components/RootStartupReadyContext';
import { StartupSurface, useStartupContentVisible } from './components/StartupSurface';
import type { PlannerAppSnapshot } from './components/PlannerAppBootstrap';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { HomeScheduleView } from './components/HomeScheduleView';
import { SplashScreen } from './components/SplashScreen';
import { StudySessionProvider } from './components/StudySessionView';
import { LegalPage } from './components/LegalPage';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { AppViewSwitcher } from './components/AppViewSwitcher';
import type { BookshelfInitialAction } from './components/BookshelfView';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { PlannerDataRecoveryNotice } from './components/PlannerDataRecoveryNotice';
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
import { useMonthTimetablePreference } from './hooks/useMonthTimetablePreference';
import { useThemePreference } from './hooks/useThemePreference';
import {
  hasStoredAppAccessGrant,
  isAppAccessGateEnabled,
  verifyAndStoreAppAccessKey,
} from './lib/appAccessGate';
import { scheduleAppViewPreload } from './lib/preloadAppViews';
import { isPlannerDataReadyForOwner } from './domain/plannerDataReadAuthority';
import { resolveActiveTimetableTerm } from './domain/timetableTerm';
import type { ViewMode } from './types/domain';

const HomeAddFlow = lazy(() => import('./components/HomeAddFlow').then((module) => ({ default: module.HomeAddFlow })));

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

type PrimarySurface = 'home' | 'ai-planning' | 'workspace';

const SCHEDULE_VIEW_MODES = new Set<ViewMode>(['month', 'week', 'day', 'todo']);

export default function App({ state, onReady }: { state?: PlannerAppSnapshot; onReady?: () => void } = {}) {
  return state ? <AppContent state={state} onReady={onReady} /> : <StandaloneApp />;
}

const ignoreStandaloneReady = () => {};
function StandaloneApp() {
  const rootOwned = useRootStartupReady() !== null;
  const parentVisible = useStartupContentVisible();
  const [standaloneVisible, setStandaloneVisible] = useState(false);
  const legal = ['/terms', '/privacy', '/contact'].includes(window.location.pathname);
  const state = usePlannerAppState({ noticeAutoDismiss: rootOwned ? parentVisible : legal || standaloneVisible });
  if (rootOwned || legal) return <AppContent state={state} />;
  return <StartupSurface loading={state.booting} onVisibilityChange={setStandaloneVisible}>
    <RootStartupReadyProvider onReady={ignoreStandaloneReady}><AppContent state={state} /></RootStartupReadyProvider>
  </StartupSurface>;
}

function AppContent({ state, onReady }: { state: PlannerAppSnapshot; onReady?: () => void }) {
  const markRootStartupReady = useRootStartupReady();
  const startupVisible = useStartupContentVisible();
  useEffect(() => { if (!state.booting) markRootStartupReady?.(); }, [state.booting, markRootStartupReady]);
  useEffect(() => { if (!state.booting && startupVisible) onReady?.(); }, [state.booting, startupVisible, onReady]);
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const settingsNavigation = useSettingsNavigation();
  const [quickEntry, setQuickEntry] = useState<{ ownerId: string; id: number; materialId?: string } | null>(null);
  const quickEntrySequence = useRef(0);
  const [homeEntry, setHomeEntry] = useState<{ ownerId: string; id: number } | null>(null);
  const homeEntrySequence = useRef(0);
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
    plannerDataAvailability,
    isPlannerDataSnapshotCurrent,
    plannerDataRecovery,
    retryPlannerData,
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
    getActualActionBlockReason,
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
    captureStudyMaterialBaseline,
    saveStudyMaterial,
    deleteStudyMaterial,
    saveScheduleTemplate,
    deleteScheduleTemplate,
    activateTimetableTerm,
    deleteTimetableTerm,
    clearTimetableTermData,
    saveTimetablePeriod,
    deleteTimetablePeriod,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
  } = state;
  const monthTimetablePreference = useMonthTimetablePreference(user?.id);
  const homeScenePreference = useHomeScenePreference();
  const {
    term: activeTimetableTerm,
    termId: activeTimetableTermId,
  } = resolveActiveTimetableTerm(timetableTerms);
  const weeklyPlanning = useWeeklyPlanningApplication({
    userId: user?.id,
    selectedDate,
    plans,
    monthEvents,
    actuals,
    studyMaterials,
    scheduleTemplates,
    timetableTermId: activeTimetableTermId,
    timetableTerm: activeTimetableTerm,
    timetableTerms,
    plannerDataAvailability,
    isPlannerDataSnapshotCurrent,
    saveWeeklyApprovedPlan,
    completeWeeklyApprovalOperation,
  });
  const currentPath = window.location.pathname;
  const hasPlannerDataRecovery = Boolean(user && plannerDataRecovery?.ownerId === user.id);
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

  const canPreloadViews = startupVisible && !booting && appAccessGranted && Boolean(user)
    && !['/terms', '/privacy', '/contact'].includes(currentPath)
    && isPlannerDataReadyForOwner(plannerDataAvailability, user?.id ?? '');

  useEffect(() => {
    // Optional screens must not compete with authentication or the initial data load.
    // Cancelling on sign-out/reload also cancels an idle callback that has not run yet.
    if (canPreloadViews) return scheduleAppViewPreload();
  }, [canPreloadViews, user?.id]);

  useEffect(() => {
    if (user?.id) {
      setPrimarySurface('home');
    }
  }, [user?.id]);

  useEffect(() => { setHomeEntry(null); }, [user?.id, primarySurface]);
  useEffect(() => { setQuickEntry(null); }, [user?.id]);

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

  // Readiness hooks above keep running behind the intro, but layout/scene
  // descendants must first mount with visible geometry and a fresh lifetime.
  if (!startupVisible) return null;

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

  function openQuickEntry(materialId?: string) {
    if (!user) return;
    setQuickEntry({ ownerId: user.id, id: ++quickEntrySequence.current, materialId });
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
    <HomeDisplayClockProvider>
    <HomeSceneAtmosphereProvider>
    <div
      hidden={settingsNavigation.isOpen}
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
        onOpenSettings={settingsNavigation.open}
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
        className={`${isWorkspaceSurface
          ? isScheduleSurface ? 'section-stack schedule-main' : 'section-stack'
          : 'home-main'}${hasPlannerDataRecovery ? ' planner-data-recovery-main' : ''}`}
      >
        <PlannerDataRecoveryNotice
          ownerId={user.id}
          recovery={plannerDataRecovery}
          onRetry={retryPlannerData}
        />
        {isHomeSurface ? (
          <StudySessionProvider userId={user.id} materials={studyMaterials} onSaveActual={saveActual} onSaveStandaloneActual={saveStandaloneActual}>
            <HomeScheduleView
              homeScenePreferences={homeScenePreference.preferences}
              userId={user.id}
              plans={plans}
              actuals={actuals}
              monthEvents={monthEvents}
              todos={todos}
              studyMaterials={studyMaterials}
              scheduleTemplates={scheduleTemplates}
              timetableTermId={activeTimetableTermId}
              timetableTerm={activeTimetableTerm}
              timetableTerms={timetableTerms}
              primaryHeaderRef={primaryHeaderRef}
              primaryBottomNavRef={primaryBottomNavRef}
              onOpenAiPlanning={openAiPlanningSurface}
              onOpenSchedule={openScheduleSurface}
              onAddEntry={() => {
                closePlanEditor();
                setHomeEntry({ ownerId: user.id, id: ++homeEntrySequence.current });
              }}
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
            showTimetable={monthTimetablePreference.showTimetable}
            monthDate={monthDate}
            selectedDate={selectedDate}
            userId={user.id}
            plans={plans}
            actuals={actuals}
            monthEvents={monthEvents}
            scheduleTemplates={scheduleTemplates}
            timetableTermId={activeTimetableTermId}
            timetableTerm={activeTimetableTerm}
            timetableTerms={timetableTerms}
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
                userId={user.id}
                plans={plans}
                actuals={actuals}
                monthEvents={monthEvents}
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
                onOpenPlan={openEditPlan}
                onMovePlan={movePlanOccurrence}
                onDeletePlan={deletePlan}
                onDeleteMonthEvent={deleteMonthEvent}
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
                onDeleteMonthEvent={deleteMonthEvent}
                onSavePlan={savePlanDraft}
                getActualActionBlockReason={getActualActionBlockReason}
                onSaveActual={saveActual}
                onSaveStandaloneActual={saveStandaloneActual}
                onLinkStandaloneActualToPlan={linkStandaloneActualToPlan}
                onDeleteActual={deleteActual}
                onOpenTimetable={openTimetableSurface}
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
                onDeleteTerm={deleteTimetableTerm}
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
                onCaptureMaterialBaseline={captureStudyMaterialBaseline}
                onSaveMaterial={saveStudyMaterial}
                onDeleteMaterial={deleteStudyMaterial}
                onAddMaterialToPlan={(material) => openQuickEntry(material.id)}
              />
            ) : null}
          </Suspense>
        ) : null}
      </main>

      {isScheduleSurface ? (
        <QuickAddMenu
          onAddSchedule={openMonthEventCreate}
          onAddStudy={() => openQuickEntry()}
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
            void confirmRecurringPlanScope(scope).catch(() => undefined);
          }}
          onClose={cancelRecurringPlanScope}
        />
      ) : null}

      {isHomeSurface && homeEntry?.ownerId === user.id ? (
        <Suspense fallback={null}>
          <HomeAddFlow key={homeEntry.id} userId={user.id} plans={plans} actuals={actuals} materials={studyMaterials}
            subjects={studySubjects} monthEvents={monthEvents}
            onClose={() => setHomeEntry((current) => current === homeEntry ? null : current)}
            onSaveTodo={saveTodo} onSavePlan={savePlanDraft} onSaveStandaloneActual={saveStandaloneActual}
            onSaveLinkedActual={saveActual} onSaveMonthEvent={saveMonthEvent} onDeleteMonthEvent={deleteMonthEvent} />
        </Suspense>
      ) : null}

      {quickEntry?.ownerId === user.id ? (
        <Suspense fallback={null}>
          <QuickEntryModal
            key={quickEntry.id}
            initialMaterialId={quickEntry.materialId}
            initialMode={quickEntry.materialId ? 'scheduled' : 'later'}
            userId={user.id}
            selectedDate={selectedDate}
            plans={plans}
            actuals={actuals}
            materials={studyMaterials}
            subjects={studySubjects}
            onClose={() => setQuickEntry((current) => current === quickEntry ? null : current)}
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

    </div>
      <AppSettingsDialog
        homeScenePreferences={homeScenePreference.preferences}
        onChangeHomeSceneStyle={homeScenePreference.setStyle}
        onChangeHomeSceneMotion={homeScenePreference.setAnimated}
        homeSceneError={homeScenePreference.error}
        open={settingsNavigation.isOpen}
        showMonthTimetable={monthTimetablePreference.showTimetable}
        onChangeMonthTimetable={monthTimetablePreference.setShowTimetable}
        monthTimetableError={monthTimetablePreference.error}
        themeMode={themeMode}
        themePalette={themePalette}
        onChangeTheme={setThemeMode}
        onChangeThemePalette={setThemePalette}
        onClose={settingsNavigation.close}
      />
    </HomeSceneAtmosphereProvider>
    </HomeDisplayClockProvider>
  );
}
