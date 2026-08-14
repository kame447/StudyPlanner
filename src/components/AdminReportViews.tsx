import {
  formatCompactDate,
  formatDateLabel,
  formatMonthLabel,
  formatMinutes,
} from '../lib/date';
import { getActualMinutes } from '../lib/studyAnalytics';
import type {
  Actual,
  AdminDailyRecordSummary,
  AdminMaterialSummary,
  AdminPeriodReportSummary,
  AdminReportMode,
  AdminWeeklyRecordSummary,
  DayNote,
  Plan,
  TodoTask,
} from '../types/domain';

export function formatSignedMinutes(minutes: number): string {
  if (minutes === 0) {
    return formatMinutes(0);
  }

  return `${minutes > 0 ? '+' : '-'}${formatMinutes(Math.abs(minutes))}`;
}

export function getReportModeLabel(mode: AdminReportMode): string {
  if (mode === 'day') {
    return '日';
  }

  if (mode === 'week') {
    return '週';
  }

  return '月';
}

export function formatReportRange(report: AdminPeriodReportSummary): string {
  if (report.mode === 'day') {
    return formatDateLabel(report.startDate);
  }

  if (report.mode === 'week') {
    return `${formatCompactDate(report.startDate)}-${formatCompactDate(report.endDate)}`;
  }

  return formatMonthLabel(report.startDate);
}

export function AdminMetricCard({
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

export function Last7DaysSummary({
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

export function AdminReportPanel({
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
