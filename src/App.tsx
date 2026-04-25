import { useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { SplashScreen } from './components/SplashScreen';
import { DayView } from './components/DayView';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { QuickEntryModal } from './components/QuickEntryModal';
import { RecurringPlanScopeDialog } from './components/RecurringPlanScopeDialog';
import { ReportView } from './components/ReportView';
import { StudyPlannerLogo } from './components/StudyPlannerLogo';
import { TodoView } from './components/TodoView';
import { UserAvatar } from './components/UserAvatar';
import { WeekView } from './components/WeekView';
import { createEmptyDayNoteDraft } from './domain/planner';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';
import {
  hasStoredAppAccessGrant,
  isAppAccessGateEnabled,
  verifyAndStoreAppAccessKey,
} from './lib/appAccessGate';
import { getUserDisplayName } from './lib/userProfile';

export default function App() {
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
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
    deleteActual,
    saveDayNote,
    saveMonthEvent,
    deleteMonthEvent,
    saveTodo,
    scheduleTodoAsPlan,
    deleteTodo,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote,
  } = usePlannerAppState();

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
          >
            <UserAvatar user={user} small />
            <span className="my-page-trigger-label">マイページ</span>
          </button>
        </div>
      </header>

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
        </div>
      </div>

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
            onChangeDay={openDay}
            onEditPlan={openEditPlan}
            onDeletePlan={deletePlan}
            onSaveActual={saveActual}
            onDeleteActual={deleteActual}
            onSaveMonthEvent={saveMonthEvent}
            onDeleteMonthEvent={deleteMonthEvent}
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
            onOpenDay={openDay}
            onSaveDayNote={saveDayNote}
          />
        ) : null}
      </main>

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
        <QuickEntryModal
          userId={user.id}
          selectedDate={selectedDate}
          plans={plans}
          onClose={() => setIsQuickEntryOpen(false)}
          onSaveTodo={saveTodo}
          onSavePlan={savePlanDraft}
        />
      ) : null}

      <MyPageDialog
        open={isMyPageOpen}
        user={user}
        themeMode={themeMode}
        themePalette={themePalette}
        onChangeTheme={setThemeMode}
        onChangeThemePalette={setThemePalette}
        onSaveProfile={saveUserProfile}
        onSignOut={signOut}
        onClose={() => setIsMyPageOpen(false)}
      />
    </div>
  );
}
