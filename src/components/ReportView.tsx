import { formatDateLabel, formatMinutes, getWeekdayLabel } from '../lib/date';
import {
  buildStudyTimelineEntries,
  buildWeeklyStudySeries,
  buildWeeklySubjectTotals,
  calculateCumulativeStudyMinutes,
  calculatePreviousWeeklyStudyMinutes,
  calculateTodayStudyMinutes,
  calculateWeeklyStudyMinutes,
} from '../lib/studyAnalytics';
import { getSubjectTheme } from '../lib/subjectTheme';
import type { Actual, Plan } from '../types/domain';

interface ReportViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  onOpenDay: (date: string) => void;
}

function renderTrendMinutes(currentWeekMinutes: number, previousWeekMinutes: number): string {
  const delta = currentWeekMinutes - previousWeekMinutes;

  if (delta === 0) {
    return '±0分';
  }

  return `${delta > 0 ? '+' : '-'}${formatMinutes(Math.abs(delta))}`;
}

export function ReportView({
  selectedDate,
  plans,
  actuals,
  onOpenDay,
}: ReportViewProps) {
  const weeklySeries = buildWeeklyStudySeries(selectedDate, plans, actuals);
  const weeklySubjectTotals = buildWeeklySubjectTotals(selectedDate, plans, actuals).slice(0, 5);
  const timelineEntries = buildStudyTimelineEntries(plans, actuals).slice(0, 10);
  const todayMinutes = calculateTodayStudyMinutes(selectedDate, plans, actuals);
  const weeklyMinutes = calculateWeeklyStudyMinutes(selectedDate, plans, actuals);
  const previousWeekMinutes = calculatePreviousWeeklyStudyMinutes(
    selectedDate,
    plans,
    actuals,
  );
  const cumulativeMinutes = calculateCumulativeStudyMinutes(plans, actuals);
  const weeklyMaxMinutes = Math.max(...weeklySeries.map((entry) => entry.minutes), 60);
  const subjectMaxMinutes = Math.max(
    ...weeklySubjectTotals.map((entry) => entry.minutes),
    60,
  );

  return (
    <section className="section-stack">
      <div className="panel">
        <div className="section-header">
          <div>
            <h2>レポート</h2>
            <p>学習時間の推移、週間の配分、記録履歴をまとめて確認できます。</p>
          </div>
        </div>

        <div className="report-metrics-grid">
          <article className="report-metric-card">
            <span className="report-metric-label">学習の推移</span>
            <strong className="report-metric-value">
              {renderTrendMinutes(weeklyMinutes, previousWeekMinutes)}
            </strong>
            <span className="report-metric-help">先週比</span>
          </article>

          <article className="report-metric-card">
            <span className="report-metric-label">今日の勉強時間</span>
            <strong className="report-metric-value">{formatMinutes(todayMinutes)}</strong>
            <span className="report-metric-help">{formatDateLabel(selectedDate)}</span>
          </article>

          <article className="report-metric-card">
            <span className="report-metric-label">週間の勉強時間</span>
            <strong className="report-metric-value">{formatMinutes(weeklyMinutes)}</strong>
            <span className="report-metric-help">月曜から日曜</span>
          </article>

          <article className="report-metric-card">
            <span className="report-metric-label">累計の勉強時間</span>
            <strong className="report-metric-value">{formatMinutes(cumulativeMinutes)}</strong>
            <span className="report-metric-help">実績累計</span>
          </article>
        </div>
      </div>

      <div className="report-grid">
        <section className="panel report-card">
          <div className="section-header">
            <div>
              <h2>1週間の学習時間</h2>
              <p>日ごとの勉強時間を棒グラフで見ます。</p>
            </div>
          </div>

          <div className="weekly-bars">
            {weeklySeries.map((entry) => (
              <button
                key={entry.date}
                className="weekly-bar-item"
                onClick={() => onOpenDay(entry.date)}
                type="button"
              >
                <span className="weekly-bar-value">{formatMinutes(entry.minutes)}</span>
                <div className="weekly-bar-track">
                  <div
                    className="weekly-bar-fill"
                    style={{
                      height: `${Math.max((entry.minutes / weeklyMaxMinutes) * 100, 6)}%`,
                    }}
                  />
                </div>
                <span className="weekly-bar-label">{getWeekdayLabel(entry.date)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel report-card">
          <div className="section-header">
            <div>
              <h2>週間の科目配分</h2>
              <p>どの科目に時間を使ったかをまとめます。</p>
            </div>
          </div>

          {weeklySubjectTotals.length > 0 ? (
            <div className="subject-breakdown-list">
              {weeklySubjectTotals.map((entry) => {
                const theme = getSubjectTheme(entry.subject, 'study');
                return (
                  <div key={entry.subject} className="subject-breakdown-item">
                    <div className="label-row">
                      <strong>{entry.subject}</strong>
                      <span>{formatMinutes(entry.minutes)}</span>
                    </div>
                    <div className="subject-breakdown-track">
                      <div
                        className="subject-breakdown-fill"
                        style={{
                          width: `${Math.max(
                            (entry.minutes / subjectMaxMinutes) * 100,
                            8,
                          )}%`,
                          backgroundColor: theme.fill,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="empty-copy">週間の実績がまだありません。</p>
          )}
        </section>
      </div>

      <section className="panel report-card">
        <div className="section-header">
          <div>
            <h2>学習履歴</h2>
            <p>最近の学習内容をタイムラインで振り返ります。</p>
          </div>
        </div>

        {timelineEntries.length > 0 ? (
          <div className="report-timeline">
            {timelineEntries.map((entry) => (
              <button
                key={entry.id}
                className="report-timeline-item"
                onClick={() => onOpenDay(entry.date)}
                type="button"
              >
                <span className="report-timeline-date">{formatDateLabel(entry.date)}</span>
                <div className="report-timeline-body">
                  <strong>{entry.title}</strong>
                  <span>
                    {entry.subject} / {entry.startTime} - {entry.endTime} /{' '}
                    {formatMinutes(entry.minutes)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-copy">実績を記録するとここに履歴が並びます。</p>
        )}
      </section>
    </section>
  );
}
