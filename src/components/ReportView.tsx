import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  formatCompactDate,
  formatDateLabel,
  formatMinutes,
  formatMonthLabel,
  getWeekdayLabel,
  minutesBetween,
  startOfMonth,
  startOfWeek,
} from '../lib/date';
import { doesMonthEventOccurOnDate, sortMonthEvents } from '../lib/monthEvents';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
} from '../lib/planRecurrence';
import {
  buildDailyStudySeriesInRange,
  buildMonthlyStudySeriesInRange,
  buildStudyTimelineEntries,
  buildWeeklyStudySeriesInRange,
  buildWeeklySubjectTotals,
  calculateCumulativeStudyMinutes,
  calculatePreviousWeeklyStudyMinutes,
  calculateTodayStudyMinutes,
  calculateWeeklyStudyMinutes,
  isStudyTimePlan,
} from '../lib/studyAnalytics';
import { getSubjectTheme } from '../lib/subjectTheme';
import { buildEvaluationSummary } from '../services/evaluationService';
import { DayNotebookPanel } from './DayNotebookPanel';
import { ScorePanel } from './ScorePanel';
import type {
  Actual,
  DayNote,
  DayNoteDraft,
  MonthEvent,
  Plan,
} from '../types/domain';

type ReportChartMode = 'daily' | 'weekly' | 'monthly';

interface DateRangeDraft {
  start: string;
  end: string;
}

interface ChartEntry {
  id: string;
  date: string;
  minutes: number;
  label: string;
  sublabel: string;
  interactive: boolean;
}

interface ReportViewProps {
  selectedDate: string;
  dayNote: DayNote | DayNoteDraft;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  onOpenDay: (date: string) => void;
  onSaveDayNote: (draft: DayNoteDraft) => Promise<void>;
}

interface SubjectDistributionEntry {
  subject: string;
  minutes: number;
  ratio: number;
  color: string;
}

const OTHER_SUBJECT_COLOR = '#8d9aa6';
const REPORT_BAR_MIN_WIDTH = 72;
const REPORT_BAR_GAP = 14;
const REPORT_BAR_HORIZONTAL_PADDING = 12;

function renderTrendMinutes(currentWeekMinutes: number, previousWeekMinutes: number): string {
  const delta = currentWeekMinutes - previousWeekMinutes;

  if (delta === 0) {
    return '±0分';
  }

  return `${delta > 0 ? '+' : '-'}${formatMinutes(Math.abs(delta))}`;
}

function createInitialDailyRange(selectedDate: string): DateRangeDraft {
  return {
    start: addDays(selectedDate, -6),
    end: selectedDate,
  };
}

function createInitialWeeklyRange(selectedDate: string): DateRangeDraft {
  const end = addDays(startOfWeek(selectedDate), 6);
  return {
    start: addDays(end, -41),
    end,
  };
}

function createInitialMonthlyRange(selectedDate: string): DateRangeDraft {
  const end = startOfMonth(selectedDate);
  return {
    start: addMonths(end, -5),
    end,
  };
}

function resolveChartAxisStep(maxMinutes: number): number {
  const intervalCount = 5;
  const targetStep = Math.max(maxMinutes / intervalCount, 15);
  const stepCandidates = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600];

  return (
    stepCandidates.find((step) => step >= targetStep) ??
    stepCandidates[stepCandidates.length - 1]
  );
}

function buildChartTickValues(maxMinutes: number): number[] {
  const intervalCount = 5;
  const step = resolveChartAxisStep(maxMinutes);
  const axisMax = Math.max(step * intervalCount, step);

  return Array.from({ length: intervalCount + 1 }, (_, index) => axisMax - step * index);
}

function formatChartTick(minutes: number): string {
  if (minutes === 0) {
    return '0分';
  }

  return formatMinutes(minutes);
}

function buildChartGridWidth(entryCount: number): string {
  const normalizedCount = Math.max(entryCount, 1);
  const minWidthPx =
    normalizedCount * REPORT_BAR_MIN_WIDTH +
    Math.max(normalizedCount - 1, 0) * REPORT_BAR_GAP +
    REPORT_BAR_HORIZONTAL_PADDING;

  return `max(100%, ${minWidthPx}px)`;
}

export function ReportView({
  selectedDate,
  dayNote,
  plans,
  actuals,
  monthEvents,
  onOpenDay,
  onSaveDayNote,
}: ReportViewProps) {
  const [chartMode, setChartMode] = useState<ReportChartMode>('daily');
  const [dailyRange, setDailyRange] = useState<DateRangeDraft>(() =>
    createInitialDailyRange(selectedDate),
  );
  const [dailyDraft, setDailyDraft] = useState<DateRangeDraft>(() =>
    createInitialDailyRange(selectedDate),
  );
  const [weeklyRange, setWeeklyRange] = useState<DateRangeDraft>(() =>
    createInitialWeeklyRange(selectedDate),
  );
  const [weeklyDraft, setWeeklyDraft] = useState<DateRangeDraft>(() =>
    createInitialWeeklyRange(selectedDate),
  );
  const [monthlyRange, setMonthlyRange] = useState<DateRangeDraft>(() =>
    createInitialMonthlyRange(selectedDate),
  );
  const [monthlyDraft, setMonthlyDraft] = useState<DateRangeDraft>(() =>
    createInitialMonthlyRange(selectedDate),
  );
  const [rangeError, setRangeError] = useState('');

  const weeklySubjectTotals = buildWeeklySubjectTotals(selectedDate, plans, actuals);
  const timelineEntries = buildStudyTimelineEntries(plans, actuals);
  const dayPlans = useMemo(
    () => expandPlansForDate(plans, selectedDate),
    [plans, selectedDate],
  );
  const studyDayPlans = useMemo(
    () => dayPlans.filter(isStudyTimePlan),
    [dayPlans],
  );
  const dayMonthEvents = useMemo(
    () =>
      sortMonthEvents(
        monthEvents.filter((monthEvent) =>
          doesMonthEventOccurOnDate(monthEvent, selectedDate),
        ),
      ),
    [monthEvents, selectedDate],
  );
  const dayOccurrenceKeys = useMemo(
    () => new Set(dayPlans.map((plan) => buildPlanOccurrenceKey(plan.id, plan.date))),
    [dayPlans],
  );
  const studyDayOccurrenceKeys = useMemo(
    () =>
      new Set(studyDayPlans.map((plan) => buildPlanOccurrenceKey(plan.id, plan.date))),
    [studyDayPlans],
  );
  const dayActuals = useMemo(
    () =>
      actuals.filter(
        (actual) =>
          dayOccurrenceKeys.has(getActualOccurrenceKey(actual)) ||
          (!actual.planId && actual.occurrenceDate === selectedDate),
      ),
    [actuals, dayOccurrenceKeys, selectedDate],
  );
  const studyDayActuals = useMemo(
    () =>
      dayActuals.filter((actual) =>
        studyDayOccurrenceKeys.has(getActualOccurrenceKey(actual)),
      ),
    [dayActuals, studyDayOccurrenceKeys],
  );
  const actualByOccurrenceKey = useMemo(
    () => new Map(dayActuals.map((actual) => [getActualOccurrenceKey(actual), actual])),
    [dayActuals],
  );
  const dayPlannedMinutes = useMemo(
    () =>
      studyDayPlans.reduce(
        (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
        0,
      ),
    [studyDayPlans],
  );
  const dayActualMinutes = useMemo(
    () => {
      const linkedMinutes = studyDayPlans.reduce((sum, plan) => {
        const actual = actualByOccurrenceKey.get(buildPlanOccurrenceKey(plan.id, plan.date));
        return (
          sum +
          (actual ? minutesBetween(actual.actualStartTime, actual.actualEndTime) : 0)
        );
      }, 0);
      const standaloneMinutes = dayActuals
        .filter((actual) => !actual.planId)
        .reduce(
          (sum, actual) =>
            sum + minutesBetween(actual.actualStartTime, actual.actualEndTime),
          0,
        );

      return linkedMinutes + standaloneMinutes;
    },
    [actualByOccurrenceKey, dayActuals, studyDayPlans],
  );
  const evaluation = useMemo(
    () => buildEvaluationSummary(selectedDate, plans, actuals),
    [actuals, plans, selectedDate],
  );
  const planDeltaMinutes = dayActualMinutes - dayPlannedMinutes;
  const displayedScheduleCount = dayPlans.length + dayMonthEvents.length;
  const todayMinutes = calculateTodayStudyMinutes(selectedDate, plans, actuals);
  const weeklyMinutes = calculateWeeklyStudyMinutes(selectedDate, plans, actuals);
  const previousWeekMinutes = calculatePreviousWeeklyStudyMinutes(
    selectedDate,
    plans,
    actuals,
  );
  const cumulativeMinutes = calculateCumulativeStudyMinutes(plans, actuals);
  const subjectDistributionEntries = useMemo<SubjectDistributionEntry[]>(() => {
    if (weeklySubjectTotals.length === 0) {
      return [];
    }

    const totalMinutes = weeklySubjectTotals.reduce((sum, entry) => sum + entry.minutes, 0);
    const mainEntries = weeklySubjectTotals.slice(0, 5);
    const otherMinutes = weeklySubjectTotals
      .slice(5)
      .reduce((sum, entry) => sum + entry.minutes, 0);
    const mergedEntries =
      otherMinutes > 0
        ? [...mainEntries, { subject: 'その他', minutes: otherMinutes }]
        : mainEntries;

    return mergedEntries.map((entry) => ({
      subject: entry.subject,
      minutes: entry.minutes,
      ratio: totalMinutes === 0 ? 0 : entry.minutes / totalMinutes,
      color:
        entry.subject === 'その他'
          ? OTHER_SUBJECT_COLOR
          : getSubjectTheme(entry.subject, 'study').fill,
    }));
  }, [weeklySubjectTotals]);
  const subjectPieBackground = useMemo(() => {
    if (subjectDistributionEntries.length === 0) {
      return 'conic-gradient(rgba(31, 43, 43, 0.12) 0% 100%)';
    }

    let currentPercent = 0;
    const segments = subjectDistributionEntries.map((entry) => {
      const startPercent = currentPercent;
      currentPercent += entry.ratio * 100;
      return `${entry.color} ${startPercent.toFixed(2)}% ${currentPercent.toFixed(2)}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  }, [subjectDistributionEntries]);

  useEffect(() => {
    const nextDaily = createInitialDailyRange(selectedDate);
    const nextWeekly = createInitialWeeklyRange(selectedDate);
    const nextMonthly = createInitialMonthlyRange(selectedDate);

    setDailyRange(nextDaily);
    setDailyDraft(nextDaily);
    setWeeklyRange(nextWeekly);
    setWeeklyDraft(nextWeekly);
    setMonthlyRange(nextMonthly);
    setMonthlyDraft(nextMonthly);
    setRangeError('');
  }, [selectedDate]);

  const chartEntries = useMemo<ChartEntry[]>(() => {
    switch (chartMode) {
      case 'weekly':
        return buildWeeklyStudySeriesInRange(
          weeklyRange.start,
          weeklyRange.end,
          plans,
          actuals,
        ).map((entry) => ({
          id: entry.startDate,
          date: entry.startDate,
          minutes: entry.minutes,
          label: formatCompactDate(entry.startDate),
          sublabel: `${formatCompactDate(entry.startDate)} - ${formatCompactDate(entry.endDate)}`,
          interactive: false,
        }));
      case 'monthly':
        return buildMonthlyStudySeriesInRange(
          monthlyRange.start,
          monthlyRange.end,
          plans,
          actuals,
        ).map((entry) => ({
          id: entry.startDate,
          date: entry.startDate,
          minutes: entry.minutes,
          label: formatMonthLabel(entry.startDate).replace(/^\d+年/, ''),
          sublabel: entry.startDate.slice(0, 4),
          interactive: false,
        }));
      case 'daily':
      default:
        return buildDailyStudySeriesInRange(
          dailyRange.start,
          dailyRange.end,
          plans,
          actuals,
        ).map((entry) => ({
          id: entry.date,
          date: entry.date,
          minutes: entry.minutes,
          label: getWeekdayLabel(entry.date),
          sublabel: formatCompactDate(entry.date),
          interactive: true,
        }));
    }
  }, [
    actuals,
    chartMode,
    dailyRange.end,
    dailyRange.start,
    monthlyRange.end,
    monthlyRange.start,
    plans,
    weeklyRange.end,
    weeklyRange.start,
  ]);

  const chartMaxMinutes = Math.max(...chartEntries.map((entry) => entry.minutes), 60);
  const chartTickValues = useMemo(
    () => buildChartTickValues(chartMaxMinutes),
    [chartMaxMinutes],
  );
  const chartAxisMax = chartTickValues[0] ?? 60;
  const chartGridWidth = useMemo(
    () => buildChartGridWidth(chartEntries.length),
    [chartEntries.length],
  );
  const chartHeading =
    chartMode === 'daily'
      ? '日別の学習時間'
      : chartMode === 'weekly'
        ? '週別の学習時間'
        : '月別の学習時間';
  const chartDescription =
    chartMode === 'daily'
      ? '直近7日を起点に、何日から何日まででも見られます。'
      : chartMode === 'weekly'
        ? '直近6週間を起点に、何日から何日まででも見られます。'
        : '直近6か月を起点に、何月から何月まででも見られます。';

  const currentRangeLabel =
    chartMode === 'monthly'
      ? `${formatMonthLabel(monthlyRange.start)} - ${formatMonthLabel(monthlyRange.end)}`
      : chartMode === 'daily'
        ? `${formatCompactDate(dailyRange.start)} - ${formatCompactDate(dailyRange.end)}`
        : `${formatCompactDate(weeklyRange.start)} - ${formatCompactDate(weeklyRange.end)}`;

  function shiftRange(direction: -1 | 1) {
    setRangeError('');

    if (chartMode === 'daily') {
      const nextRange = {
        start: addDays(dailyRange.start, direction * 7),
        end: addDays(dailyRange.end, direction * 7),
      };
      setDailyRange(nextRange);
      setDailyDraft(nextRange);
      return;
    }

    if (chartMode === 'weekly') {
      const nextRange = {
        start: addDays(weeklyRange.start, direction * 7),
        end: addDays(weeklyRange.end, direction * 7),
      };
      setWeeklyRange(nextRange);
      setWeeklyDraft(nextRange);
      return;
    }

    const nextRange = {
      start: addMonths(monthlyRange.start, direction),
      end: addMonths(monthlyRange.end, direction),
    };
    setMonthlyRange(nextRange);
    setMonthlyDraft(nextRange);
  }

  function applyRangeSelection() {
    setRangeError('');

    if (chartMode === 'daily') {
      if (dailyDraft.start.localeCompare(dailyDraft.end) > 0) {
        setRangeError('開始日は終了日以前にしてください。');
        return;
      }

      setDailyRange(dailyDraft);
      return;
    }

    if (chartMode === 'weekly') {
      if (weeklyDraft.start.localeCompare(weeklyDraft.end) > 0) {
        setRangeError('開始日は終了日以前にしてください。');
        return;
      }

      setWeeklyRange(weeklyDraft);
      return;
    }

    const normalizedRange = {
      start: startOfMonth(monthlyDraft.start),
      end: startOfMonth(monthlyDraft.end),
    };

    if (normalizedRange.start.localeCompare(normalizedRange.end) > 0) {
      setRangeError('開始月は終了月以前にしてください。');
      return;
    }

    setMonthlyRange(normalizedRange);
    setMonthlyDraft(normalizedRange);
  }

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
            <span className="report-metric-help">記録累計</span>
          </article>
        </div>
      </div>

      <div className="report-daily-review-layout">
        <DayNotebookPanel
          dayNote={dayNote}
          plannedMinutes={dayPlannedMinutes}
          actualMinutes={dayActualMinutes}
          actualCount={studyDayActuals.length}
          planCount={studyDayPlans.length}
          evaluation={evaluation}
          planDeltaMinutes={planDeltaMinutes}
          displayedScheduleCount={displayedScheduleCount}
          onSave={onSaveDayNote}
        />
        <ScorePanel summary={evaluation} />
      </div>

      <div className="report-grid">
        <section className="panel report-card">
          <div className="section-header">
            <div>
              <h2>{chartHeading}</h2>
              <p>{chartDescription}</p>
            </div>
            <div className="segmented-control">
              <button
                className={chartMode === 'daily' ? 'segment active' : 'segment'}
                onClick={() => setChartMode('daily')}
                type="button"
              >
                日別
              </button>
              <button
                className={chartMode === 'weekly' ? 'segment active' : 'segment'}
                onClick={() => setChartMode('weekly')}
                type="button"
              >
                週別
              </button>
              <button
                className={chartMode === 'monthly' ? 'segment active' : 'segment'}
                onClick={() => setChartMode('monthly')}
                type="button"
              >
                月別
              </button>
            </div>
          </div>

          <div className="report-range-toolbar">
            <div className="row-actions">
              <button className="ghost-button" onClick={() => shiftRange(-1)} type="button">
                {chartMode === 'monthly' ? '前の月' : '前の週'}
              </button>
              <span className="week-range-chip">{currentRangeLabel}</span>
              <button className="ghost-button" onClick={() => shiftRange(1)} type="button">
                {chartMode === 'monthly' ? '次の月' : '次の週'}
              </button>
            </div>

            <div className="report-range-form">
              {chartMode === 'monthly' ? (
                <>
                  <label className="field">
                    <span>開始月</span>
                    <input
                      type="month"
                      value={monthlyDraft.start.slice(0, 7)}
                      onChange={(event) =>
                        setMonthlyDraft((current) => ({
                          ...current,
                          start: `${event.target.value}-01`,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>終了月</span>
                    <input
                      type="month"
                      value={monthlyDraft.end.slice(0, 7)}
                      onChange={(event) =>
                        setMonthlyDraft((current) => ({
                          ...current,
                          end: `${event.target.value}-01`,
                        }))
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>開始日</span>
                    <input
                      type="date"
                      value={chartMode === 'daily' ? dailyDraft.start : weeklyDraft.start}
                      onChange={(event) => {
                        const nextValue = event.target.value;

                        if (chartMode === 'daily') {
                          setDailyDraft((current) => ({ ...current, start: nextValue }));
                          return;
                        }

                        setWeeklyDraft((current) => ({ ...current, start: nextValue }));
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>終了日</span>
                    <input
                      type="date"
                      value={chartMode === 'daily' ? dailyDraft.end : weeklyDraft.end}
                      onChange={(event) => {
                        const nextValue = event.target.value;

                        if (chartMode === 'daily') {
                          setDailyDraft((current) => ({ ...current, end: nextValue }));
                          return;
                        }

                        setWeeklyDraft((current) => ({ ...current, end: nextValue }));
                      }}
                    />
                  </label>
                </>
              )}
              <button className="ghost-button" onClick={applyRangeSelection} type="button">
                期間を反映
              </button>
            </div>
          </div>

          {rangeError ? <p className="inline-error">{rangeError}</p> : null}

          <div className="report-bar-chart-shell">
            <div className="report-bar-chart-axis">
              {chartTickValues.map((tickValue) => (
                <div key={tickValue} className="report-bar-chart-axis-tick">
                  <span className="report-bar-chart-axis-label">
                    {formatChartTick(tickValue)}
                  </span>
                </div>
              ))}
            </div>

            <div className="report-bar-chart-scroll">
              <div className="report-bar-chart-grid" style={{ width: chartGridWidth }}>
                {chartTickValues.map((tickValue) => (
                  <div key={tickValue} className="report-bar-chart-grid-line" />
                ))}

                <div
                  className="report-bar-chart-bars"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(chartEntries.length, 1)}, minmax(${REPORT_BAR_MIN_WIDTH}px, 1fr))`,
                  }}
                >
                  {chartEntries.map((entry) => {
                    const barHeight =
                      entry.minutes === 0
                        ? '0%'
                        : `${(entry.minutes / chartAxisMax) * 100}%`;

                    const barBody = (
                      <>
                        <span className="report-bar-value">{formatMinutes(entry.minutes)}</span>
                        <div className="report-bar-column-track">
                          <div
                            className="report-bar-column-fill"
                            style={{
                              height: barHeight,
                              minHeight: entry.minutes > 0 ? '3px' : '0',
                            }}
                          />
                        </div>
                        <span className="report-bar-label">{entry.label}</span>
                        <span className="report-bar-sublabel">{entry.sublabel}</span>
                      </>
                    );

                    return entry.interactive ? (
                      <button
                        key={entry.id}
                        className="report-bar-item"
                        onClick={() => onOpenDay(entry.date)}
                        type="button"
                      >
                        {barBody}
                      </button>
                    ) : (
                      <div key={entry.id} className="report-bar-item">
                        {barBody}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel report-card">
          <div className="section-header">
            <div>
              <h2>週間の科目配分</h2>
              <p>どの科目に時間を使ったかをまとめます。</p>
            </div>
          </div>

          {subjectDistributionEntries.length > 0 ? (
            <div className="report-pie-layout">
              <div className="report-pie-chart-wrap">
                <div
                  className="report-pie-chart"
                  style={{ backgroundImage: subjectPieBackground }}
                  role="img"
                  aria-label={subjectDistributionEntries
                    .map(
                      (entry) =>
                        `${entry.subject} ${formatMinutes(entry.minutes)} ${Math.round(
                          entry.ratio * 100,
                        )}%`,
                    )
                    .join('、')}
                />
                <div className="report-pie-total">
                  <strong>{formatMinutes(weeklyMinutes)}</strong>
                  <span>週間合計</span>
                </div>
              </div>

              <div className="report-pie-legend">
                {subjectDistributionEntries.map((entry) => (
                  <div key={entry.subject} className="report-pie-legend-item">
                    <span
                      className="report-pie-legend-dot"
                      style={{ backgroundColor: entry.color }}
                    />
                    <div className="report-pie-legend-body">
                      <strong>{entry.subject}</strong>
                      <span>
                        {formatMinutes(entry.minutes)} / {Math.round(entry.ratio * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-copy">週間の記録がまだありません。</p>
          )}
        </section>
      </div>

      <section className="panel report-card">
        <div className="section-header">
          <div>
            <h2>学習履歴</h2>
            <p>直近5件を中心に見て、それ以前はスクロールで振り返ります。</p>
          </div>
        </div>

        {timelineEntries.length > 0 ? (
          <div className="report-timeline report-timeline-scroll">
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
          <p className="empty-copy">記録するとここに履歴が並びます。</p>
        )}
      </section>
    </section>
  );
}
