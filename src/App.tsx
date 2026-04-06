import { useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { DayView } from './components/DayView';
import { MonthView } from './components/MonthView';
import { PlanEditorPanel } from './components/PlanEditorPanel';
import { WeekView } from './components/WeekView';
import {
  isSameMonth,
  minutesBetween,
  sortByDateTime,
  startOfMonth,
  todayIsoDate,
} from './lib/date';
import { createId } from './lib/id';
import { authRepository, plannerRepository } from './repositories';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
  EmailChallenge,
  Plan,
  PlanDraft,
  User,
  ViewMode,
} from './types/domain';

type NoticeTone = 'info' | 'success' | 'error';

interface NoticeState {
  tone: NoticeTone;
  text: string;
}

function createDefaultPlanDraft(userId: string, date: string): PlanDraft {
  return {
    userId,
    title: '',
    subject: '',
    date,
    startTime: '19:00',
    endTime: '20:00',
    type: 'study',
    memo: '',
  };
}

function createDefaultDayNoteDraft(userId: string, date: string): DayNoteDraft {
  return {
    userId,
    date,
    quickMemo: '',
    reflection: '',
    nextFocus: '',
    checkedPlan: false,
    checkedRecord: false,
    checkedReady: false,
  };
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [monthDate, setMonthDate] = useState(startOfMonth(todayIsoDate()));
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [editorDraft, setEditorDraft] = useState<PlanDraft | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
      const currentUser = await authRepository.getCurrentUser();

      if (currentUser) {
        setUser(currentUser);
        await loadPlannerData(currentUser.id);
      }

      setBooting(false);
    }

    void bootstrap();
  }, []);

  async function loadPlannerData(userId: string) {
    const [nextPlans, nextActuals, nextDayNotes] = await Promise.all([
      plannerRepository.getPlans(userId),
      plannerRepository.getActuals(userId),
      plannerRepository.getDayNotes(userId),
    ]);

    setPlans(sortByDateTime(nextPlans));
    setActuals(nextActuals);
    setDayNotes(nextDayNotes);
  }

  function showNotice(text: string, tone: NoticeTone = 'info') {
    setNotice({ text, tone });
  }

  async function handleRequestCode(email: string) {
    try {
      const nextChallenge = await authRepository.requestEmailCode(email);
      setChallenge(nextChallenge);
      showNotice('認証コードを発行しました。MVP用メールボックスを確認してください。');
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : '認証コードを発行できませんでした。',
        'error',
      );
    }
  }

  async function handleVerifyCode(email: string, code: string) {
    try {
      const currentUser = await authRepository.verifyEmailCode(email, code);
      setUser(currentUser);
      await loadPlannerData(currentUser.id);
      setChallenge(null);
      showNotice('ログインしました。', 'success');
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : 'ログインに失敗しました。',
        'error',
      );
    }
  }

  async function handleSignOut() {
    await authRepository.signOut();
    setUser(null);
    setPlans([]);
    setActuals([]);
    setDayNotes([]);
    setChallenge(null);
    showNotice('ログアウトしました。');
  }

  function openCreatePlan() {
    if (!user) {
      return;
    }

    setEditingPlanId(null);
    setEditorDraft(createDefaultPlanDraft(user.id, selectedDate));
  }

  function openEditPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setEditorDraft({
      userId: plan.userId,
      title: plan.title,
      subject: plan.subject,
      date: plan.date,
      startTime: plan.startTime,
      endTime: plan.endTime,
      type: plan.type,
      memo: plan.memo,
    });
  }

  function closePlanEditor() {
    setEditingPlanId(null);
    setEditorDraft(null);
  }

  async function savePlanDraft(draft: PlanDraft, targetPlanId?: string) {
    if (!user) {
      return;
    }

    if (minutesBetween(draft.startTime, draft.endTime) <= 0) {
      showNotice('終了時刻は開始時刻より後にしてください。', 'error');
      return;
    }

    const now = new Date().toISOString();
    const currentPlan = plans.find((plan) => plan.id === (targetPlanId ?? editingPlanId));
    const nextPlan: Plan = currentPlan
      ? {
          ...currentPlan,
          ...draft,
          updatedAt: now,
        }
      : {
          id: createId('plan'),
          ...draft,
          createdAt: now,
          updatedAt: now,
        };

    await plannerRepository.upsertPlan(nextPlan);
    const nextPlans = sortByDateTime(
      plans.filter((plan) => plan.id !== nextPlan.id).concat(nextPlan),
    );

    setPlans(nextPlans);
    setSelectedDate(nextPlan.date);
    setMonthDate(startOfMonth(nextPlan.date));
    closePlanEditor();
    showNotice(currentPlan ? '予定を更新しました。' : '予定を追加しました。', 'success');
  }

  async function handleDeletePlan(plan: Plan) {
    if (!user) {
      return;
    }

    await plannerRepository.deletePlan(user.id, plan.id);
    setPlans((current) => current.filter((item) => item.id !== plan.id));
    setActuals((current) => current.filter((item) => item.planId !== plan.id));
    showNotice('予定を削除しました。');
  }

  async function handleSaveActual(plan: Plan, draft: ActualDraft) {
    if (!user) {
      return;
    }

    const existingActual = actuals.find((actual) => actual.planId === plan.id);
    const nextActual: Actual = {
      id: existingActual?.id ?? createId('actual'),
      userId: user.id,
      planId: plan.id,
      actualStartTime: draft.actualStartTime,
      actualEndTime: draft.actualEndTime,
      subject: draft.subject,
      note: draft.note,
      updatedAt: new Date().toISOString(),
    };

    await plannerRepository.upsertActual(nextActual);
    setActuals((current) =>
      current.filter((item) => item.planId !== plan.id).concat(nextActual),
    );
    showNotice('実績を保存しました。', 'success');
  }

  async function handleDeleteActual(actual: Actual) {
    if (!user) {
      return;
    }

    await plannerRepository.deleteActual(user.id, actual.id);
    setActuals((current) => current.filter((item) => item.id !== actual.id));
    showNotice('実績を削除しました。');
  }

  async function handleSaveDayNote(draft: DayNoteDraft) {
    if (!user) {
      return;
    }

    const currentDayNote = dayNotes.find((dayNote) => dayNote.date === draft.date);
    const nextDayNote: DayNote = {
      id: currentDayNote?.id ?? createId('day-note'),
      ...draft,
      updatedAt: new Date().toISOString(),
    };

    await plannerRepository.upsertDayNote(nextDayNote);
    setDayNotes((current) =>
      current.filter((item) => item.id !== nextDayNote.id).concat(nextDayNote),
    );
    showNotice('日次メモを保存しました。', 'success');
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);

    if (!isSameMonth(monthDate, date)) {
      setMonthDate(startOfMonth(date));
    }
  }

  function switchToWeek(date: string) {
    handleSelectDate(date);
    setViewMode('week');
  }

  function switchToDay(date: string) {
    handleSelectDate(date);
    setViewMode('day');
  }

  if (booting) {
    return <main className="loading-screen">起動しています...</main>;
  }

  if (!user) {
    return (
      <AuthScreen
        challenge={challenge}
        notice={notice?.text ?? ''}
        onRequestCode={handleRequestCode}
        onVerifyCode={handleVerifyCode}
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
          <div className="user-badge">{user.email}</div>
          <button className="ghost-button" onClick={handleSignOut} type="button">
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

        <div className="row-actions">
          <button className="primary-button" onClick={openCreatePlan} type="button">
            予定を追加
          </button>
        </div>
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
            onSelectDate={handleSelectDate}
            onChangeMonth={(date) => {
              setMonthDate(startOfMonth(date));
              if (!isSameMonth(selectedDate, date)) {
                setSelectedDate(startOfMonth(date));
              }
            }}
            onOpenWeek={switchToWeek}
          />
        ) : null}

        {viewMode === 'week' ? (
          <WeekView
            selectedDate={selectedDate}
            plans={plans}
            actuals={actuals}
            onChangeWeek={switchToWeek}
            onOpenDay={switchToDay}
          />
        ) : null}

        {viewMode === 'day' ? (
          <DayView
            selectedDate={selectedDate}
            userId={user.id}
            plans={plans}
            actuals={actuals}
            dayNote={
              dayNotes.find((dayNote) => dayNote.date === selectedDate) ??
              createDefaultDayNoteDraft(user.id, selectedDate)
            }
            onChangeDay={switchToDay}
            onAddPlan={openCreatePlan}
            onEditPlan={openEditPlan}
            onDeletePlan={handleDeletePlan}
            onSaveActual={handleSaveActual}
            onDeleteActual={handleDeleteActual}
            onSaveDayNote={handleSaveDayNote}
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
    </div>
  );
}
