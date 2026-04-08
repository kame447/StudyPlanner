import { useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { DayView } from './components/DayView';
import { DayPlanInputPanel } from './components/DayPlanInputPanel';
import { MonthView } from './components/MonthView';
import { MyPageDialog } from './components/MyPageDialog';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { ReportView } from './components/ReportView';
import { StudyPlannerLogo } from './components/StudyPlannerLogo';
import { UserAvatar } from './components/UserAvatar';
import { WeekView } from './components/WeekView';
import { createEmptyDayNoteDraft } from './domain/planner';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';
import { getUserDisplayName } from './lib/userProfile';

export default function App() {
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [isToolbarPlanInputOpen, setIsToolbarPlanInputOpen] = useState(false);
  const [toolbarPlanInputMode, setToolbarPlanInputMode] = useState<'manual' | 'ai'>(
    'manual',
  );
  const { themeMode, setThemeMode } = useThemePreference();
  const {
    booting,
    user,
    plans,
    actuals,
    monthEvents,
    viewMode,
    selectedDate,
    monthDate,
    challenge,
    notice,
    editorDraft,
    editingPlanId,
    setViewMode,
    requestCode,
    verifyCode,
    resetChallenge,
    saveUserProfile,
    signOut,
    openEditPlan,
    closePlanEditor,
    savePlanDraft,
    deletePlan,
    saveActual,
    deleteActual,
    saveDayNote,
    saveMonthEvent,
    deleteMonthEvent,
    selectDate,
    changeMonth,
    openWeek,
    openDay,
    setEditorDraft,
    currentDayNote,
  } = usePlannerAppState();

  if (booting) {
    return <main className="loading-screen">起動しています...</main>;
  }

  if (!user) {
    return (
      <AuthScreen
        challenge={challenge}
        notice={notice?.text ?? ''}
        onRequestCode={requestCode}
        onVerifyCode={verifyCode}
        onResetChallenge={resetChallenge}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header hero-card print-hide">
        <StudyPlannerLogo />

        <div className="header-actions">
          <button
            className="ghost-button my-page-trigger"
            onClick={() => setIsMyPageOpen(true)}
            type="button"
          >
            <UserAvatar user={user} small />
            <span className="my-page-trigger-label">マイページ</span>
          </button>
          <div className="user-badge header-profile-name">
            {getUserDisplayName(user)}
          </div>
        </div>
      </header>

      <div className="toolbar panel print-hide">
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
            className={viewMode === 'report' ? 'segment active' : 'segment'}
            onClick={() => setViewMode('report')}
            type="button"
          >
            レポート
          </button>
        </div>

        {viewMode !== 'report' ? (
          <div className="row-actions">
            <button
              className="primary-button"
              onClick={() => {
                setToolbarPlanInputMode('manual');
                setIsToolbarPlanInputOpen(true);
              }}
              type="button"
            >
              学習予定を追加
            </button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className={`app-notice ${notice.tone}`}>{notice.text}</div>
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
            dayNote={currentDayNote ?? createEmptyDayNoteDraft(user.id, selectedDate)}
            onChangeDay={openDay}
            onEditPlan={openEditPlan}
            onDeletePlan={deletePlan}
            onSaveActual={saveActual}
            onDeleteActual={deleteActual}
            onSaveDayNote={saveDayNote}
            onSaveMonthEvent={saveMonthEvent}
            onDeleteMonthEvent={deleteMonthEvent}
          />
        ) : null}

        {viewMode === 'report' ? (
          <ReportView
            selectedDate={selectedDate}
            plans={plans}
            actuals={actuals}
            onOpenDay={openDay}
          />
        ) : null}
      </main>

      <PlanEditorPanel
        draft={editorDraft}
        submitLabel={editingPlanId ? '学習予定を更新' : '学習予定を追加'}
        heading={editingPlanId ? '学習予定を編集' : '学習予定を追加'}
        onChange={setEditorDraft}
        onSubmit={() => {
          if (editorDraft) {
            void savePlanDraft(editorDraft);
          }
        }}
        onCancel={closePlanEditor}
      />

      {isToolbarPlanInputOpen ? (
        <div className="overlay modal-overlay">
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <DayPlanInputPanel
              selectedDate={selectedDate}
              userId={user.id}
              plans={plans}
              mode={toolbarPlanInputMode}
              onModeChange={setToolbarPlanInputMode}
              onApplyDraft={savePlanDraft}
              onClose={() => setIsToolbarPlanInputOpen(false)}
              embedded
            />
          </div>
        </div>
      ) : null}

      <MyPageDialog
        open={isMyPageOpen}
        user={user}
        themeMode={themeMode}
        onChangeTheme={setThemeMode}
        onSaveProfile={saveUserProfile}
        onSignOut={signOut}
        onClose={() => setIsMyPageOpen(false)}
      />
    </div>
  );
}
