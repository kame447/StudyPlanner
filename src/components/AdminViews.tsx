import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  filterAdminUserSummaries,
  summarizePeriodReport,
} from '../lib/adminAnalytics';
import {
  addDays,
  addMonths,
  formatCompactDate,
  formatDateLabel,
  formatMonthLabel,
  formatMinutes,
  todayIsoDate,
} from '../lib/date';
import { getActualMinutes } from '../lib/studyAnalytics';
import {
  getAdminUserDetail,
  getAdminUserSummaries,
} from '../services/adminDataService';
import type {
  Actual,
  AdminDailyRecordSummary,
  AdminMaterialSummary,
  AdminPeriodReportSummary,
  AdminReportMode,
  AdminUserDetailData,
  AdminUserSummary,
  AdminWeeklyRecordSummary,
  DayNote,
  Plan,
  TodoTask,
} from '../types/domain';

interface AdminRoutesProps {
  path: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '未更新';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatUid(uid: string): string {
  return uid.length > 18 ? `${uid.slice(0, 8)}...${uid.slice(-6)}` : uid;
}

function formatSignedMinutes(minutes: number): string {
  if (minutes === 0) {
    return formatMinutes(0);
  }

  return `${minutes > 0 ? '+' : '-'}${formatMinutes(Math.abs(minutes))}`;
}

function getReportModeLabel(mode: AdminReportMode): string {
  if (mode === 'day') {
    return '日';
  }

  if (mode === 'week') {
    return '週';
  }

  return '月';
}

function formatReportRange(report: AdminPeriodReportSummary): string {
  if (report.mode === 'day') {
    return formatDateLabel(report.startDate);
  }

  if (report.mode === 'week') {
    return `${formatCompactDate(report.startDate)}-${formatCompactDate(report.endDate)}`;
  }

  return formatMonthLabel(report.startDate);
}

function AdminMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="admin-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AdminEmptyState({ children }: { children: string }) {
  return <p className="admin-empty-state">{children}</p>;
}

function AdminAppReturnButton({
  onReturn,
}: {
  onReturn: () => void;
}) {
  return (
    <button
      className="ghost-button admin-app-return-button"
      onClick={onReturn}
      type="button"
    >
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
      通常画面に戻る
    </button>
  );
}

function AdminUsersPage({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const filteredUsers = useMemo(
    () => filterAdminUserSummaries(users, searchQuery),
    [searchQuery, users],
  );

  useEffect(() => {
    let active = true;

    setLoadState('loading');
    setErrorMessage('');

    getAdminUserSummaries()
      .then((nextUsers) => {
        if (!active) {
          return;
        }

        setUsers(nextUsers);
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'ユーザー一覧を取得できませんでした。',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="admin-shell">
      <AdminAppReturnButton onReturn={() => navigate('/')} />

      <section className="admin-hero panel">
        <div className="admin-title-row">
          <span className="admin-icon-badge">
            <Users aria-hidden="true" size={22} strokeWidth={1.9} />
          </span>
          <div>
            <h1>管理者画面</h1>
            <p>ユーザーの学習状況を read-only で確認します。</p>
          </div>
        </div>
        <span className="admin-readonly-badge">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
          read-only
        </span>
      </section>

      <section className="admin-search-card panel">
        <label className="admin-search-field">
          <Search aria-hidden="true" size={18} strokeWidth={2} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="表示名・メール・uidで検索"
            type="search"
          />
        </label>
      </section>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>ユーザー情報と学習状況を取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' ? (
        <section className="admin-user-list" aria-label="ユーザー一覧">
          {filteredUsers.length === 0 ? (
            <div className="admin-state-card panel">
              <strong>該当するユーザーがいません</strong>
            </div>
          ) : (
            filteredUsers.map(({ profile, stats }) => (
              <button
                key={profile.id}
                className="admin-user-card panel"
                onClick={() =>
                  navigate(`/admin/users/${encodeURIComponent(profile.id)}`)
                }
                type="button"
              >
                <span className="admin-user-card-main">
                  <span className="admin-user-avatar" aria-hidden="true">
                    {profile.avatar || profile.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="admin-user-copy">
                    <strong>{profile.username}</strong>
                    <span>{profile.email || 'メール未設定'}</span>
                    <code>{formatUid(profile.id)}</code>
                  </span>
                </span>
                <span className="admin-user-stats">
                  <span>
                    今日 <strong>{formatMinutes(stats.todayStudyMinutes)}</strong>
                  </span>
                  <span>
                    今週 <strong>{formatMinutes(stats.weekStudyMinutes)}</strong>
                  </span>
                  <span>
                    記録 <strong>{stats.todayActualCount}件</strong>
                  </span>
                  <span>
                    Todo <strong>{stats.incompleteTodoCount}件</strong>
                  </span>
                  <span>
                    更新 <strong>{formatTimestamp(stats.lastUpdatedAt)}</strong>
                  </span>
                </span>
                <ChevronRight
                  className="admin-user-card-icon"
                  aria-hidden="true"
                  size={22}
                  strokeWidth={1.9}
                />
              </button>
            ))
          )}
        </section>
      ) : null}
    </main>
  );
}

function PlanList({
  plans,
  emptyText = 'この期間の予定はありません。',
}: {
  plans: Plan[];
  emptyText?: string;
}) {
  if (plans.length === 0) {
    return <AdminEmptyState>{emptyText}</AdminEmptyState>;
  }

  return (
    <div className="admin-item-list">
      {plans.map((plan) => (
        <article key={plan.occurrenceKey ?? plan.id} className="admin-list-item">
          <strong>{plan.title || '予定'}</strong>
          <span>
            {plan.startTime}-{plan.endTime} / {plan.subject || '未設定'}
          </span>
        </article>
      ))}
    </div>
  );
}

function ActualList({
  actuals,
  emptyText = 'この期間の記録はありません。',
}: {
  actuals: Actual[];
  emptyText?: string;
}) {
  if (actuals.length === 0) {
    return <AdminEmptyState>{emptyText}</AdminEmptyState>;
  }

  return (
    <div className="admin-item-list">
      {actuals.map((actual) => (
        <article key={actual.id} className="admin-list-item">
          <strong>{actual.title?.trim() || actual.subject || '記録'}</strong>
          <span>
            {actual.actualStartTime}-{actual.actualEndTime} /{' '}
            {formatMinutes(getActualMinutes(actual))}
          </span>
          {actual.note.trim() ? <p>{actual.note}</p> : null}
        </article>
      ))}
    </div>
  );
}

function TodoList({ todos }: { todos: TodoTask[] }) {
  if (todos.length === 0) {
    return <AdminEmptyState>未完了 Todo はありません。</AdminEmptyState>;
  }

  return (
    <div className="admin-item-list">
      {todos.slice(0, 8).map((todo) => (
        <article key={todo.id} className="admin-list-item">
          <strong>{todo.title || 'Todo'}</strong>
          <span>
            {todo.subject || '未設定'}
            {todo.dueDate ? ` / 期限 ${formatDateLabel(todo.dueDate)}` : ''}
          </span>
        </article>
      ))}
    </div>
  );
}

function Last7DaysSummary({
  entries,
}: {
  entries: AdminDailyRecordSummary[];
}) {
  const maxMinutes = Math.max(...entries.map((entry) => entry.minutes), 1);

  return (
    <div className="admin-daily-summary">
      {entries.map((entry) => (
        <div key={entry.date} className="admin-daily-row">
          <span>{formatCompactDate(entry.date)}</span>
          <div className="admin-daily-track" aria-hidden="true">
            <span style={{ width: `${(entry.minutes / maxMinutes) * 100}%` }} />
          </div>
          <strong>{formatMinutes(entry.minutes)}</strong>
          <small>{entry.actualCount}件</small>
        </div>
      ))}
    </div>
  );
}

function DailySummaryList({
  entries,
}: {
  entries: AdminDailyRecordSummary[];
}) {
  const hasRecords = entries.some(
    (entry) => entry.minutes > 0 || entry.actualCount > 0,
  );

  if (!hasRecords) {
    return <AdminEmptyState>この期間の記録はありません。</AdminEmptyState>;
  }

  return <Last7DaysSummary entries={entries} />;
}

function WeeklySummaryList({
  entries,
}: {
  entries: AdminWeeklyRecordSummary[];
}) {
  const hasRecords = entries.some(
    (entry) => entry.minutes > 0 || entry.actualCount > 0,
  );
  const maxMinutes = Math.max(...entries.map((entry) => entry.minutes), 1);

  if (!hasRecords) {
    return <AdminEmptyState>この期間の記録はありません。</AdminEmptyState>;
  }

  return (
    <div className="admin-daily-summary">
      {entries.map((entry) => (
        <div key={entry.startDate} className="admin-weekly-row">
          <span>
            {formatCompactDate(entry.startDate)}-{formatCompactDate(entry.endDate)}
          </span>
          <div className="admin-daily-track" aria-hidden="true">
            <span style={{ width: `${(entry.minutes / maxMinutes) * 100}%` }} />
          </div>
          <strong>{formatMinutes(entry.minutes)}</strong>
          <small>{entry.actualCount}件</small>
        </div>
      ))}
    </div>
  );
}

function MaterialSummaryList({
  entries,
}: {
  entries: AdminMaterialSummary[];
}) {
  if (entries.length === 0) {
    return <AdminEmptyState>教材別の記録はありません。</AdminEmptyState>;
  }

  return (
    <div className="admin-item-list">
      {entries.map((entry) => (
        <article key={entry.key} className="admin-list-item admin-list-item-inline">
          <strong>{entry.label}</strong>
          <span>{formatMinutes(entry.minutes)}</span>
        </article>
      ))}
    </div>
  );
}

function DayNoteList({ dayNotes }: { dayNotes: DayNote[] }) {
  if (dayNotes.length === 0) {
    return <AdminEmptyState>この期間の day_notes はありません。</AdminEmptyState>;
  }

  return (
    <div className="admin-item-list">
      {dayNotes.map((dayNote) => (
        <article key={dayNote.id} className="admin-list-item">
          <strong>{formatDateLabel(dayNote.date)}</strong>
          {dayNote.quickMemo.trim() ? <p>{dayNote.quickMemo}</p> : null}
          {dayNote.reflection.trim() ? <p>{dayNote.reflection}</p> : null}
          {dayNote.nextFocus.trim() ? <p>{dayNote.nextFocus}</p> : null}
        </article>
      ))}
    </div>
  );
}

function AdminReportPanel({
  report,
}: {
  report: AdminPeriodReportSummary;
}) {
  const isDayMode = report.mode === 'day';
  const isWeekMode = report.mode === 'week';
  const isMonthMode = report.mode === 'month';

  return (
    <>
      <section className="admin-metric-grid" aria-label="期間サマリー">
        <AdminMetricCard
          label="合計記録時間"
          value={formatMinutes(report.actualMinutes)}
        />
        <AdminMetricCard label="記録件数" value={`${report.actualCount}件`} />
        <AdminMetricCard
          label="予定時間"
          value={formatMinutes(report.plannedMinutes)}
        />
        <AdminMetricCard
          label="差分"
          value={formatSignedMinutes(report.differenceMinutes)}
        />
      </section>

      {isDayMode ? (
        <>
          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <h2>その日の予定</h2>
              <span>{formatReportRange(report)}</span>
            </div>
            <PlanList plans={report.plans} />
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <h2>その日の記録</h2>
              <span>{formatMinutes(report.actualMinutes)}</span>
            </div>
            <ActualList actuals={report.actuals} />
          </section>

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <h2>day_notes</h2>
              <span>{report.dayNotes.length}件</span>
            </div>
            <DayNoteList dayNotes={report.dayNotes} />
          </section>
        </>
      ) : null}

      {isWeekMode || isMonthMode ? (
        <section className="admin-section-card panel">
          <div className="admin-section-heading">
            <h2>日別記録サマリー</h2>
            <span>{formatReportRange(report)}</span>
          </div>
          <DailySummaryList entries={report.dailySummaries} />
        </section>
      ) : null}

      {isWeekMode ? (
        <section className="admin-section-card panel">
          <div className="admin-section-heading">
            <h2>予定と記録の差分</h2>
            <span>{formatSignedMinutes(report.differenceMinutes)}</span>
          </div>
          <div className="admin-delta-row">
            <AdminMetricCard
              label="予定"
              value={formatMinutes(report.plannedMinutes)}
            />
            <AdminMetricCard
              label="記録"
              value={formatMinutes(report.actualMinutes)}
            />
          </div>
        </section>
      ) : null}

      {isMonthMode ? (
        <section className="admin-section-card panel">
          <div className="admin-section-heading">
            <h2>週ごとの合計</h2>
            <span>{formatReportRange(report)}</span>
          </div>
          <WeeklySummaryList entries={report.weeklySummaries} />
        </section>
      ) : null}

      <section className="admin-section-card panel">
        <div className="admin-section-heading">
          <h2>未完了 Todo</h2>
          <span>{report.incompleteTodos.length}件</span>
        </div>
        <TodoList todos={report.incompleteTodos} />
      </section>

      {isWeekMode || isMonthMode ? (
        <section className="admin-section-card panel">
          <div className="admin-section-heading">
            <h2>教材・タイトル別</h2>
            <span>上位</span>
          </div>
          <MaterialSummaryList entries={report.materialSummaries} />
        </section>
      ) : null}
    </>
  );
}

function AdminUserDetailPage({
  userId,
  navigate,
}: {
  userId: string;
  navigate: (path: string) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [detail, setDetail] = useState<AdminUserDetailData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [reportMode, setReportMode] = useState<AdminReportMode>('day');
  const [selectedDate, setSelectedDate] = useState(() => todayIsoDate());
  const reportSummary = useMemo(
    () =>
      detail
        ? summarizePeriodReport({
            mode: reportMode,
            selectedDate,
            plans: detail.plans,
            actuals: detail.actuals,
            todos: detail.todos,
            dayNotes: detail.dayNotes,
            materials: detail.studyMaterials,
          })
        : null,
    [detail, reportMode, selectedDate],
  );

  function moveReportPeriod(amount: number) {
    setSelectedDate((currentDate) => {
      if (reportMode === 'day') {
        return addDays(currentDate, amount);
      }

      if (reportMode === 'week') {
        return addDays(currentDate, amount * 7);
      }

      return addMonths(currentDate, amount);
    });
  }

  useEffect(() => {
    let active = true;

    setLoadState('loading');
    setErrorMessage('');

    getAdminUserDetail(userId)
      .then((nextDetail) => {
        if (!active) {
          return;
        }

        setDetail(nextDetail);
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'ユーザー詳細を取得できませんでした。',
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <main className="admin-shell admin-detail-shell">
      <AdminAppReturnButton onReturn={() => navigate('/')} />

      <button
        className="ghost-button admin-back-button"
        onClick={() => navigate('/admin/users')}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={2} />
        ユーザー一覧
      </button>

      {loadState === 'loading' ? (
        <section className="admin-state-card panel">
          <strong>読み込み中</strong>
          <p>対象ユーザーの学習状況を取得しています。</p>
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="admin-state-card panel" role="alert">
          <strong>取得できませんでした</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      {loadState === 'ready' && !detail ? (
        <section className="admin-state-card panel">
          <strong>ユーザーが見つかりません</strong>
        </section>
      ) : null}

      {detail ? (
        <>
          <section className="admin-profile-card panel">
            <div className="admin-title-row">
              <span className="admin-user-avatar admin-user-avatar-large" aria-hidden="true">
                {detail.profile.avatar ||
                  detail.profile.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h1>{detail.profile.username}</h1>
                <p>{detail.profile.email || 'メール未設定'}</p>
                <code>{detail.profile.id}</code>
              </div>
            </div>
            <span className="admin-readonly-badge">
              <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
              read-only
            </span>
          </section>

          <section className="admin-metric-grid" aria-label="学習サマリー">
            <AdminMetricCard
              label="今日"
              value={formatMinutes(detail.stats.todayStudyMinutes)}
            />
            <AdminMetricCard
              label="今週"
              value={formatMinutes(detail.stats.weekStudyMinutes)}
            />
            <AdminMetricCard
              label="今日の記録"
              value={`${detail.stats.todayActualCount}件`}
            />
            <AdminMetricCard
              label="未完了 Todo"
              value={`${detail.stats.incompleteTodoCount}件`}
            />
          </section>

          <section className="admin-section-card panel">
            <div className="admin-report-head">
              <div>
                <h2>レポート</h2>
                <p>過去の日・週・月の学習状況を read-only で確認します。</p>
              </div>
              <span className="admin-readonly-badge">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
                read-only
              </span>
            </div>

            <div className="admin-report-tabs" role="tablist" aria-label="管理者レポート">
              {(['day', 'week', 'month'] as AdminReportMode[]).map((mode) => (
                <button
                  key={mode}
                  className={reportMode === mode ? 'segment active' : 'segment'}
                  onClick={() => setReportMode(mode)}
                  role="tab"
                  aria-selected={reportMode === mode}
                  type="button"
                >
                  {getReportModeLabel(mode)}
                </button>
              ))}
            </div>

            {reportSummary ? (
              <div className="admin-period-nav">
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => moveReportPeriod(-1)}
                  type="button"
                  aria-label={`前の${getReportModeLabel(reportMode)}`}
                >
                  <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
                <strong>{formatReportRange(reportSummary)}</strong>
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => moveReportPeriod(1)}
                  type="button"
                  aria-label={`次の${getReportModeLabel(reportMode)}`}
                >
                  <ChevronRight aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
              </div>
            ) : null}
          </section>

          {reportSummary ? <AdminReportPanel report={reportSummary} /> : null}

          <section className="admin-section-card panel">
            <div className="admin-section-heading">
              <h2>直近7日間</h2>
              <span>
                <Clock3 aria-hidden="true" size={15} strokeWidth={2} />
                現在基準
              </span>
            </div>
            <Last7DaysSummary entries={detail.last7Days} />
          </section>
        </>
      ) : null}
    </main>
  );
}

export function AdminRoutes({ path, navigate }: AdminRoutesProps) {
  useEffect(() => {
    if (path === '/admin') {
      navigate('/admin/users', { replace: true });
    }
  }, [navigate, path]);

  if (path === '/admin') {
    return (
      <main className="admin-shell">
        <AdminAppReturnButton onReturn={() => navigate('/')} />

        <section className="admin-state-card panel">
          <strong>管理者画面へ移動しています</strong>
        </section>
      </main>
    );
  }

  if (path === '/admin/users') {
    return <AdminUsersPage navigate={(nextPath) => navigate(nextPath)} />;
  }

  const detailMatch = path.match(/^\/admin\/users\/([^/]+)$/);

  if (detailMatch) {
    return (
      <AdminUserDetailPage
        userId={decodeURIComponent(detailMatch[1])}
        navigate={(nextPath) => navigate(nextPath)}
      />
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-state-card panel">
        <strong>ページが見つかりません</strong>
      </section>
    </main>
  );
}
