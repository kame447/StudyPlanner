import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  House,
  MessageCircle,
  Settings,
} from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { HomeTopbar } from './components/HomeTopbar';
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
import { ScheduleToolbar } from './components/ScheduleToolbar';
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
  const [primarySurface, setPrimarySurface] = useState<PrimarySurface>('home');
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
  const isHomeSurface = primarySurface === 'home';
  const isAiPlanningSurface = primarySurface === 'ai-planning';
  const isWorkspaceSurface = primarySurface === 'workspace';
  const isScheduleSurface = isWorkspaceSurface && SCHEDULE_VIEW_MODES.has(viewMode);

  useEffect(() => {
    if (user?.id) {
      setPrimarySurface('home');
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
    <div
      className={
        isWorkspaceSurface
          ? isScheduleSurface
            ? 'app-shell schedule-workspace-shell'
            : 'app-shell'
          : 'app-shell home-app-shell'
      }
    >
      {isWorkspaceSurface ? (
        <>
          {isScheduleSurface ? (
            <header className="schedule-app-header print-hide">
              <button
                className="schedule-back-button"
                onClick={() => setPrimarySurface('home')}
                type="button"
                aria-label="ホームへ戻る"
              >
                <ArrowLeft aria-hidden="true" size={27} strokeWidth={2.2} />
              </button>
              <h1>予定</h1>
              <span className="schedule-header-spacer" aria-hidden="true" />
            </header>
          ) : (
            <header className="app-header hero-card print-hide">
              <StudyPlannerLogo />
              <div className="header-actions">
                <button
                  className="ghost-button header-home-button"
                  onClick={() => setPrimarySurface('home')}
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
          )}

          {isScheduleSurface ? (
            <ScheduleToolbar
              viewMode={viewMode}
              selectedDate={selectedDate}
              monthDate={monthDate}
              onChangeView={(nextViewMode) => setViewMode(nextViewMode)}
              onChangeMonth={changeMonth}
              onChangeWeek={openWeek}
              onChangeDay={openDay}
            />
          ) : (
            <AppViewSwitcher
              viewMode={viewMode}
              onChange={(nextViewMode) => {
                setPrimarySurface('workspace');
                setViewMode(nextViewMode);
              }}
            />
          )}
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
          <HomeView
            user={user}
            plans={plans}
            actuals={actuals}
            todos={todos}
            studyMaterials={studyMaterials}
            onOpenAiPlanning={() => setPrimarySurface('ai-planning')}
            onOpenSchedule={() => {
              setPrimarySurface('workspace');
              setViewMode('month');
            }}
            onOpenDay={(date) => {
              setPrimarySurface('workspace');
              openDay(date);
            }}
            onOpenTodo={() => {
              setPrimarySurface('workspace');
              setViewMode('todo');
            }}
            onOpenBookshelf={() => {
              setPrimarySurface('workspace');
              setViewMode('bookshelf');
            }}
            onOpenReport={() => {
              setPrimarySurface('workspace');
              setViewMode('report');
            }}
            onOpenProfile={() => setIsMyPageOpen(true)}
            onOpenSettings={() => setIsAppSettingsOpen(true)}
          />
        ) : null}

        {isAiPlanningSurface ? (
          <>
            <div className="home-dashboard home-dashboard-default ai-planning-primary-header">
              <HomeTopbar
                user={user}
                plans={plans}
                actuals={actuals}
                todos={todos}
                onOpenProfile={() => setIsMyPageOpen(true)}
                onOpenSettings={() => setIsAppSettingsOpen(true)}
              />
            </div>
            <Suspense fallback={<SplashScreen />}>
              <AiPlanningView
                application={weeklyPlanning}
                userId={user.id}
                selectedDate={selectedDate}
                plans={plans}
                actuals={actuals}
                onClose={() => setPrimarySurface('home')}
              />
            </Suspense>
          </>
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

      {isScheduleSurface ? (
        <button
          className="daily-add-fab schedule-add-fab print-hide"
          onClick={() => {
            if (viewMode === 'month') {
              setMonthCreateRequestId((current) => current + 1);
              return;
            }
            setIsQuickEntryOpen(true);
          }}
          type="button"
          aria-label="新規追加"
        >
          <span aria-hidden="true">＋</span>
        </button>
      ) : null}

      {isScheduleSurface ? (
        <nav className="home-bottom-nav schedule-bottom-nav print-hide" aria-label="主要ナビゲーション">
          <button type="button" onClick={() => setPrimarySurface('ai-planning')}>
            <MessageCircle aria-hidden="true" />
            <span>AI計画</span>
          </button>
          <button className="active" type="button" aria-current="page">
            <CalendarDays aria-hidden="true" />
            <span>予定</span>
          </button>
          <button type="button" onClick={() => setPrimarySurface('home')}>
            <span className="home-nav-active-circle"><House aria-hidden="true" /></span>
            <span>ホーム</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPrimarySurface('workspace');
              setViewMode('bookshelf');
            }}
          >
            <BookOpen aria-hidden="true" />
            <span>教材</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPrimarySurface('workspace');
              setViewMode('report');
            }}
          >
            <BarChart3 aria-hidden="true" />
            <span>分析</span>
          </button>
        </nav>
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
