import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { AdminGuard } from './components/AdminGuard';
import { AdminRoutes } from './components/AdminViews';
import { AuthScreen } from './components/AuthScreen';
import { SplashScreen } from './components/SplashScreen';
import { LegalPage } from './components/LegalPage';
import { AppSettingsDialog } from './components/AppSettingsDialog';
import { FaqView } from './components/FaqView';
import { FloatingActualTrackingPanel } from './components/FloatingActualTrackingPanel';
import type { BookshelfInitialAction } from './components/BookshelfView';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { RecurringPlanScopeDialog } from './components/RecurringPlanScopeDialog';
import { StudyPlannerLogo } from './components/StudyPlannerLogo';
import { UserAvatar } from './components/UserAvatar';
import { createEmptyDayNoteDraft } from './domain/planner';
import { useAdminStatus } from './hooks/useAdminStatus';
import { useIOSViewportFocusGuard } from './hooks/useIOSViewportFocusGuard';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';
import {
  hasStoredAppAccessGrant,
  isAppAccessGateEnabled,
  verifyAndStoreAppAccessKey,
} from './lib/appAccessGate';
import { getUserDisplayName } from './lib/userProfile';

type IdleCallbackHandle = number;
type IdleCapableWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

const loadBookshelfView = () =>
  import('./components/BookshelfView').then((module) => ({
    default: module.BookshelfView,
  }));
const loadDayView = () =>
  import('./components/DayView').then((module) => ({
    default: module.DayView,
  }));
const loadQuickEntryModal = () =>
  import('./components/QuickEntryModal').then((module) => ({
    default: module.QuickEntryModal,
  }));
const loadReportView = () =>
  import('./components/ReportView').then((module) => ({
    default: module.ReportView,
  }));
const loadTimetableView = () =>
  import('./components/TimetableView').then((module) => ({
    default: module.TimetableView,
  }));
const loadTimetableOcrImportDialog = () =>
  import('./components/TimetableOcrImportDialog').then((module) => ({
    default: module.TimetableOcrImportDialog,
  }));
const loadTodoView = () =>
  import('./components/TodoView').then((module) => ({
    default: module.TodoView,
  }));
const loadWeekView = () =>
  import('./components/WeekView').then((module) => ({
    default: module.WeekView,
  }));

const BookshelfView = lazy(loadBookshelfView);
const DayView = lazy(loadDayView);
const QuickEntryModal = lazy(loadQuickEntryModal);
const ReportView = lazy(loadReportView);
const TimetableView = lazy(loadTimetableView);
const TodoView = lazy(loadTodoView);
const WeekView = lazy(loadWeekView);

let didStartMainViewPreload = false;

function preloadChunk(name: string, loader: () => Promise<unknown>): Promise<void> {
  return loader()
    .then(() => undefined)
    .catch((error) => {
      console.warn(`[preload] ${name} chunk could not be loaded.`, error);
    });
}

function scheduleAfterIdle(callback: () => void, timeout = 1600): () => void {
  const idleWindow = window as IdleCapableWindow;

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout });

    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const handle = window.setTimeout(callback, Math.min(timeout, 900));

  return () => {
    window.clearTimeout(handle);
  };
}

function preloadMainViewChunks(): () => void {
  let cancelled = false;
  let lowPriorityCleanup: (() => void) | null = null;

  const highPriorityCleanup = scheduleAfterIdle(() => {
    if (cancelled) {
      return;
    }

    didStartMainViewPreload = true;

    void Promise.all([
      preloadChunk('WeekView', loadWeekView),
      preloadChunk('DayView', loadDayView),
      preloadChunk('TodoView', loadTodoView),
      preloadChunk('ReportView', loadReportView),
    ]).finally(() => {
      if (cancelled) {
        return;
      }

      lowPriorityCleanup = scheduleAfterIdle(() => {
        if (cancelled) {
          return;
        }

        void preloadChunk('TimetableView', loadTimetableView)
          .then(() =>
            Promise.all([
              preloadChunk('BookshelfView', loadBookshelfView),
              preloadChunk('QuickEntryModal', loadQuickEntryModal),
              preloadChunk('TimetableOcrImportDialog', loadTimetableOcrImportDialog),
            ]),
          );
      }, 2600);
    });
  }, 1200);

  return () => {
    cancelled = true;
    highPriorityCleanup();
    lowPriorityCleanup?.();
  };
}

export default function App() {
  useIOSViewportFocusGuard();

  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [isTrackingPanelOpen, setIsTrackingPanelOpen] = useState(false);
  const [trackingApplyTargetLabel, setTrackingApplyTargetLabel] = useState('');
  const trackingApplyRef = useRef<((startTime: string, endTime: string) => void) | null>(null);
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
  const { status: adminStatus, isAdmin } = useAdminStatus(user?.id);
  const openTrackingTools = useCallback(
    (
      onApplyMeasuredRange: (startTime: string, endTime: string) => void,
      targetLabel: string,
    ) => {
      trackingApplyRef.current = onApplyMeasuredRange;
      setTrackingApplyTargetLabel(targetLabel);
      setIsTrackingPanelOpen(true);
    },
    [],
  );
  const detachTrackingTools = useCallback(
    (onApplyMeasuredRange: (startTime: string, endTime: string) => void) => {
      if (trackingApplyRef.current !== onApplyMeasuredRange) {
        return;
      }

      trackingApplyRef.current = null;
      setTrackingApplyTargetLabel('');
    },
    [],
  );
  const applyMeasuredRangeFromFloatingPanel = useCallback(
    (startTime: string, endTime: string) => {
      trackingApplyRef.current?.(startTime, endTime);
    },
    [],
  );
  const closeTrackingPanel = useCallback(() => {
    setIsTrackingPanelOpen(false);
  }, []);
  const navigate = useCallback(
    (path: string, options: { replace?: boolean } = {}) => {
      if (window.location.pathname !== path) {
        if (options.replace) {
          window.history.replaceState({}, '', path);
        } else {
          window.history.pushState({}, '', path);
        }
      }

      setCurrentPath(path);
    },
    [],
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const activeTimetableTerm = useMemo(
    () =>
      timetableTerms.find((term) => term.isActive) ??
      timetableTerms[0] ??
      null,
    [timetableTerms],
  );
  const activeTimetableTermId = activeTimetableTerm?.id ?? 'default';
  const isAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');

  useEffect(() => {
    if (booting || !user || !appAccessGranted || isAdminRoute) {
      return;
    }

    if (didStartMainViewPreload) {
      return;
    }

    return preloadMainViewChunks();
  }, [appAccessGranted, booting, isAdminRoute, user]);

  if (currentPath === '/terms') {
    return <LegalPage kind="terms" />;
  }

  if (currentPath === '/privacy') {
    return <LegalPage kind="privacy" />;
  }

  if (currentPath === '/contact') {
    return <LegalPage kind="contact" />;
  }

  if (currentPath === '/faq') {
    return (
      <div className="app-shell">
        <FaqView />
      </div>
    );
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

          if (didUnlock) {
            setAppAccessGranted(true);
          }

          return didUnlock;
        }}
        onSignUpWithPassword={signUpWithPassword}
        onSignInWithPassword={signInWithPassword}
        onSignInWithGoogle={signInWithGoogle}
        onSendPasswordReset={sendPasswordReset}
      />
    );
  }

  if (isAdminRoute) {
    return (
      <div className="app-shell admin-app-shell">
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

        <AdminGuard status={adminStatus}>
          <AdminRoutes path={currentPath} navigate={navigate} />
        </AdminGuard>

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
          isAdmin={isAdmin}
          onChangeTheme={setThemeMode}
          onChangeThemePalette={setThemePalette}
          onOpenAdmin={() => navigate('/admin/users')}
          onSignOut={signOut}
          onClose={() => setIsAppSettingsOpen(false)}
        />
      </div>
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
              onChangeDay={openDay}
              onEditPlan={openEditPlan}
              onDeletePlan={deletePlan}
              onSavePlan={savePlanDraft}
              onSaveActual={saveActual}
              onSaveStandaloneActual={saveStandaloneActual}
              onLinkStandaloneActualToPlan={linkStandaloneActualToPlan}
              onDeleteActual={deleteActual}
              onOpenTrackingTools={openTrackingTools}
              onDetachTrackingTools={detachTrackingTools}
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

      <div className="toolbar panel app-view-switcher print-hide">
        <div className="segmented-control">
          <button
            className={viewMode === 'month' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('month')}
            type="button"
          >
            月
          </button>
          <button
            className={viewMode === 'week' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('week')}
            type="button"
          >
            週
          </button>
          <button
            className={viewMode === 'day' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('day')}
            type="button"
          >
            日
          </button>
          <button
            className={viewMode === 'todo' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('todo')}
            type="button"
          >
            Todo
          </button>
          <button
            className={viewMode === 'report' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('report')}
            type="button"
          >
            レポート
          </button>
          <button
            className={viewMode === 'timetable' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('timetable')}
            type="button"
          >
            時間割
          </button>
          <button
            className={viewMode === 'bookshelf' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('bookshelf')}
            type="button"
          >
            本棚
          </button>
        </div>
      </div>

      {viewMode === 'day' || viewMode === 'todo' ? (
        <button
          className="daily-add-fab print-hide"
          onClick={() => setIsQuickEntryOpen(true)}
          type="button"
          aria-label="新規追加"
        >
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
          if (editorDraft) {
            return savePlanDraft(editorDraft);
          }
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
          <QuickEntryModal
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

      {isTrackingPanelOpen ? (
        <FloatingActualTrackingPanel
          hasApplyTarget={Boolean(trackingApplyRef.current)}
          onApplyMeasuredRange={applyMeasuredRangeFromFloatingPanel}
          onClose={closeTrackingPanel}
          targetLabel={trackingApplyTargetLabel}
        />
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
        isAdmin={isAdmin}
        onChangeTheme={setThemeMode}
        onChangeThemePalette={setThemePalette}
        onOpenAdmin={() => navigate('/admin/users')}
        onSignOut={signOut}
        onClose={() => setIsAppSettingsOpen(false)}
      />
    </div>
  );
}
