import { useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { DayView } from './components/DayView';
import { DisplaySettingsDialog } from './components/DisplaySettingsDialog';
import { MonthView } from './components/MonthView';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { WeekView } from './components/WeekView';
import { createEmptyDayNoteDraft } from './domain/planner';
import { usePlannerAppState } from './hooks/usePlannerAppState';
import { useThemePreference } from './hooks/useThemePreference';

export default function App() {
  const [isDisplaySettingsOpen, setIsDisplaySettingsOpen] = useState(false);
  const { themeMode, setThemeMode } = useThemePreference();
  const {
    booting,
    user,
    plans,
    actuals,
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
    signOut,
    openCreatePlan,
    openEditPlan,
    closePlanEditor,
    savePlanDraft,
    deletePlan,
    saveActual,
    deleteActual,
    saveDayNote,
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
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header hero-card">
        <div>
          <p className="eyebrow">Study Planner MVP</p>
          <h1>月 → 週 → 日 で追える勉強計画</h1>
          <p className="hero-copy">
            予定入力を軽くしつつ、週ビューで計画と実績のズレを見やすくしています。
          </p>
        </div>

        <div className="header-actions">
          <button
            className="ghost-button"
            onClick={() => setIsDisplaySettingsOpen(true)}
            type="button"
          >
            表示設定
          </button>
          <div className="user-badge">{user.email}</div>
          <button className="ghost-button" onClick={() => void signOut()} type="button">
            ログアウト
          </button>
        </div>
      </header>

      <div className="toolbar panel">
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
        </div>

        {viewMode !== 'day' ? (
          <div className="row-actions">
            <button className="primary-button" onClick={openCreatePlan} type="button">
              予定を追加
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
            plans={plans}
            onSelectDate={selectDate}
            onChangeMonth={changeMonth}
            onOpenWeek={openWeek}
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
            dayNote={currentDayNote ?? createEmptyDayNoteDraft(user.id, selectedDate)}
            onChangeDay={openDay}
            onEditPlan={openEditPlan}
            onDeletePlan={deletePlan}
            onSaveActual={saveActual}
            onDeleteActual={deleteActual}
            onSaveDayNote={saveDayNote}
            onApplyDraft={savePlanDraft}
          />
        ) : null}
      </main>

      <PlanEditorPanel
        draft={editorDraft}
        submitLabel={editingPlanId ? '予定を更新' : '予定を追加'}
        heading={editingPlanId ? '予定を編集' : '予定を追加'}
        onChange={setEditorDraft}
        onSubmit={() => {
          if (editorDraft) {
            void savePlanDraft(editorDraft);
          }
        }}
        onCancel={closePlanEditor}
      />

      <DisplaySettingsDialog
        open={isDisplaySettingsOpen}
        themeMode={themeMode}
        onChangeTheme={setThemeMode}
        onClose={() => setIsDisplaySettingsOpen(false)}
      />
    </div>
  );
}
