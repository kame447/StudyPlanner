import { useMemo, useState, type CSSProperties } from 'react';
import {
  formatCompactDate,
  formatDateLabel,
  formatMinutes,
  formatMonthLabel,
  getWeekDates,
  getWeekdayLabel,
} from '../lib/date';
import {
  buildMonthWeekComparisons,
  buildRangeDailyComparisons,
  buildReportSummary,
  buildYearMonthComparisons,
  getComparisonChartMax,
  getComparisonTicks,
  getMaterialChartColor,
  getMaterialChartEntries,
  getReportScopeRange,
  UNSET_SUBJECT_LABEL,
  type ReportPeriodComparison,
  type ReportScope,
  type ReportTotalEntry,
} from '../lib/reportAnalytics';
import type {
  Actual,
  DayNote,
  DayNoteDraft,
  MonthEvent,
  Plan,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

interface ReportViewProps {
  selectedDate: string;
  dayNote: DayNote | DayNoteDraft;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  studySubjects?: StudySubject[];
  studyMaterials?: StudyMaterial[];
  onOpenDay: (date: string) => void;
  onSaveDayNote: (draft: DayNoteDraft) => Promise<void>;
}

const REPORT_SCOPES: Array<{ value: ReportScope; label: string }> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '週' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

const MATERIAL_PIE_LABEL_THRESHOLD = 0.1;

function formatRate(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate)}%`;
}

function formatStackedMinutes(minutes: number): string[] {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return [`${hours}時間`, `${remainingMinutes}分`];
  }

  if (hours > 0) {
    return [`${hours}時間`];
  }

  return [`${remainingMinutes}分`];
}

function buildMaterialPieGradient(entries: ReportTotalEntry[]): string {
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  let cursor = 0;

  const stops = entries.map((entry, index) => {
    const start = cursor;
    const share = totalMinutes === 0 ? 0 : (entry.minutes / totalMinutes) * 100;
    const end = index === entries.length - 1 ? 100 : cursor + share;
    cursor = end;

    return `${getMaterialChartColor(entry, index)} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });

  return `conic-gradient(${stops.join(', ')})`;
}

function formatShare(minutes: number, totalMinutes: number): string {
  if (totalMinutes <= 0) {
    return '0%';
  }

  const percent = (minutes / totalMinutes) * 100;

  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

function MetricCard({
  label,
  value,
  variant = 'compact',
  help,
}: {
  label: string;
  value: string;
  variant?: 'primary' | 'compact';
  help?: string;
}) {
  return (
    <article className={`report-metric-card ${variant}`}>
      <span className="report-metric-label">{label}</span>
      <strong className="report-metric-value">{value}</strong>
      {help ? <span className="report-metric-help">{help}</span> : null}
    </article>
  );
}

function MaterialPieChart({
  title,
  entries,
  emptyText,
}: {
  title: string;
  entries: ReportTotalEntry[];
  emptyText: string;
}) {
  const chartEntries = getMaterialChartEntries(entries);
  const chartTotalMinutes = chartEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );
  let sliceCursor = 0;
  const chartSlices = chartEntries.map((entry, index) => {
    const share = chartTotalMinutes === 0 ? 0 : entry.minutes / chartTotalMinutes;
    const middle = sliceCursor + share / 2;
    const angle = (middle * 360 - 90) * (Math.PI / 180);
    sliceCursor += share;

    return {
      entry,
      index,
      share,
      left: 50 + Math.cos(angle) * 31,
      top: 50 + Math.sin(angle) * 31,
    };
  });

  return (
    <section className="panel report-card report-pie-card">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {chartEntries.length === 0 ? (
        <p className="empty-copy">{emptyText}</p>
      ) : (
        <div className="report-pie-layout">
          <div className="report-pie-chart-wrap">
            <div
              className="report-pie-chart"
              role="img"
              aria-label={`${title}: ${formatMinutes(chartTotalMinutes)}`}
              style={{ background: buildMaterialPieGradient(chartEntries) }}
            >
              {chartSlices
                .filter((slice) => slice.share >= MATERIAL_PIE_LABEL_THRESHOLD)
                .map((slice) => (
                  <span
                    className="report-pie-slice-label"
                    key={slice.entry.key}
                    style={{
                      left: `${slice.left}%`,
                      top: `${slice.top}%`,
                    }}
                  >
                    {Math.round(slice.share * 100)}%
                  </span>
                ))}
            </div>
            <div className="report-pie-total">
              <strong>{formatMinutes(chartTotalMinutes)}</strong>
              <span>記録時間ベース</span>
            </div>
          </div>
          <div className="report-pie-legend">
            {chartEntries.map((entry, index) => (
              <div className="report-pie-legend-item" key={entry.key}>
                <span
                  className="report-pie-legend-dot"
                  style={{ backgroundColor: getMaterialChartColor(entry, index) }}
                />
                <div className="report-pie-legend-body">
                  <strong title={entry.label}>{entry.label}</strong>
                  <span>
                    {formatMinutes(entry.minutes)} /{' '}
                    {formatShare(entry.minutes, chartTotalMinutes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ComparisonBars({
  title,
  entries,
  onOpenDay,
}: {
  title: string;
  entries: ReportPeriodComparison[];
  onOpenDay?: (date: string) => void;
}) {
  const maxMinutes = getComparisonChartMax(Math.max(
    60,
    ...entries.flatMap((entry) => [entry.plannedMinutes, entry.actualMinutes]),
  ));
  const tickMinutes = getComparisonTicks(maxMinutes);

  return (
    <section className="panel report-card">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
        </div>
        <div className="report-comparison-legend" aria-hidden="true">
          <span>
            <i className="planned" />
            予定
          </span>
          <span>
            <i className="actual" />
            記録
          </span>
        </div>
      </div>
      <div className="report-comparison-plot">
        <div className="report-comparison-axis" aria-hidden="true">
          {tickMinutes.map((minutes) => (
            <span key={minutes}>{formatMinutes(minutes)}</span>
          ))}
        </div>
        <div className="report-comparison-scroll">
          <div
            className="report-comparison-chart"
            style={{
              gridTemplateColumns: `repeat(${entries.length}, minmax(var(--comparison-item-width), 1fr))`,
            }}
          >
            <div className="report-comparison-grid-lines" aria-hidden="true">
              {tickMinutes.map((minutes) => (
                <span key={minutes} />
              ))}
            </div>
            {entries.map((entry) => {
              const plannedHeight =
                entry.plannedMinutes === 0 ? 0 : Math.max(3, (entry.plannedMinutes / maxMinutes) * 100);
              const actualHeight =
                entry.actualMinutes === 0 ? 0 : Math.max(3, (entry.actualMinutes / maxMinutes) * 100);
              const shouldStaggerLabels =
                entry.plannedMinutes > 0 &&
                entry.actualMinutes > 0 &&
                Math.abs(plannedHeight - actualHeight) < 12;
              const content = (
                <>
                  <div className="report-comparison-column">
                    <div className="report-comparison-column-track">
                      <div className="report-comparison-bar-pair">
                        <div
                          className="report-comparison-bar"
                          style={{ '--bar-height': `${plannedHeight}%` } as CSSProperties}
                        >
                          {entry.plannedMinutes > 0 ? (
                            <span className="report-comparison-value planned">
                              {formatStackedMinutes(entry.plannedMinutes).map((line) => (
                                <span key={line}>{line}</span>
                              ))}
                            </span>
                          ) : null}
                          <div
                            className="report-comparison-fill planned"
                            title={`予定 ${formatMinutes(entry.plannedMinutes)}`}
                          />
                        </div>
                        <div
                          className="report-comparison-bar"
                          style={{ '--bar-height': `${actualHeight}%` } as CSSProperties}
                        >
                          {entry.actualMinutes > 0 ? (
                            <span
                              className={
                                shouldStaggerLabels
                                  ? 'report-comparison-value actual staggered'
                                  : 'report-comparison-value actual'
                              }
                            >
                              {formatStackedMinutes(entry.actualMinutes).map((line) => (
                                <span key={line}>{line}</span>
                              ))}
                            </span>
                          ) : null}
                          <div
                            className="report-comparison-fill actual"
                            title={`記録 ${formatMinutes(entry.actualMinutes)}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="report-comparison-label">
                    <strong>{entry.label}</strong>
                    {entry.sublabel ? <span>{entry.sublabel}</span> : null}
                  </div>
                </>
              );

              return onOpenDay && /^\d{4}-\d{2}-\d{2}$/.test(entry.key) ? (
                <button
                  aria-label={`${entry.label} ${entry.sublabel ?? ''} 予定 ${formatMinutes(entry.plannedMinutes)} 記録 ${formatMinutes(entry.actualMinutes)}`}
                  className="report-comparison-item interactive"
                  key={entry.key}
                  onClick={() => onOpenDay(entry.key)}
                  type="button"
                >
                  {content}
                </button>
              ) : (
                <article
                  aria-label={`${entry.label} ${entry.sublabel ?? ''} 予定 ${formatMinutes(entry.plannedMinutes)} 記録 ${formatMinutes(entry.actualMinutes)}`}
                  className="report-comparison-item"
                  key={entry.key}
                >
                  {content}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function CompactList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: Array<{ id: string; title: string; detail: string }>;
  emptyText: string;
}) {
  return (
    <section className="panel report-card">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="empty-copy">{emptyText}</p>
      ) : (
        <div className="report-compact-list">
          {items.slice(0, 6).map((item) => (
            <article className="report-compact-item" key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ReportView(props: ReportViewProps) {
  const [scope, setScope] = useState<ReportScope>('week');
  const selectedDate = props.selectedDate;
  const subjects = props.studySubjects ?? [];
  const materials = props.studyMaterials ?? [];
  const scopeRange = getReportScopeRange(scope, selectedDate);
  const summary = useMemo(
    () =>
      buildReportSummary({
        ...scopeRange,
        plans: props.plans,
        actuals: props.actuals,
        subjects,
        materials,
      }),
    [
      materials,
      props.actuals,
      props.plans,
      scopeRange.endDate,
      scopeRange.startDate,
      subjects,
    ],
  );
  const dailyComparisons = useMemo(
    () => {
      if (scope !== 'week') {
        return [];
      }

      return buildRangeDailyComparisons({
        ...scopeRange,
        plans: props.plans,
        actuals: props.actuals,
        subjects,
        materials,
      });
    },
    [
      materials,
      props.actuals,
      props.plans,
      scope,
      scopeRange.endDate,
      scopeRange.startDate,
      subjects,
    ],
  );
  const monthWeekComparisons = useMemo(
    () => {
      if (scope !== 'month') {
        return [];
      }

      return buildMonthWeekComparisons({
        selectedDate,
        plans: props.plans,
        actuals: props.actuals,
        subjects,
        materials,
      });
    },
    [materials, props.actuals, props.plans, scope, selectedDate, subjects],
  );
  const yearMonthComparisons = useMemo(
    () => {
      if (scope !== 'year') {
        return [];
      }

      return buildYearMonthComparisons({
        selectedDate,
        plans: props.plans,
        actuals: props.actuals,
        subjects,
        materials,
      });
    },
    [materials, props.actuals, props.plans, scope, selectedDate, subjects],
  );
  const rangeLabel =
    scope === 'day'
      ? formatDateLabel(selectedDate)
      : scope === 'month'
        ? formatMonthLabel(selectedDate)
        : scope === 'year'
          ? `${selectedDate.slice(0, 4)}年`
          : `${formatCompactDate(scopeRange.startDate)} - ${formatCompactDate(scopeRange.endDate)}`;
  const topMaterial = summary.materialTotals.find((entry) => entry.minutes > 0);
  const diffMinutes = summary.differenceMinutes;
  const diffLabel = diffMinutes === 0
    ? '差分なし'
    : `${diffMinutes > 0 ? '+' : '-'}${formatMinutes(Math.abs(diffMinutes))}`;
  const activityMetricLabel = scope === 'month' || scope === 'year' ? '学習日数' : '予定なし記録';
  const activityMetricValue =
    scope === 'month' || scope === 'year'
      ? `${summary.learningDays}日`
      : `${summary.standaloneActuals.length}件`;
  const unrecordedItems = summary.unrecordedPlans.map((plan) => ({
    id: `${plan.id}-${plan.date}`,
    title: plan.title,
    detail: `${formatCompactDate(plan.date)} ${plan.startTime}-${plan.endTime} / ${plan.subject || UNSET_SUBJECT_LABEL}`,
  }));
  const standaloneItems = summary.standaloneActuals.map((actual) => ({
    id: actual.id,
    title: actual.title?.trim() || '記録',
    detail: `${formatCompactDate(actual.occurrenceDate)} ${actual.actualStartTime}-${actual.actualEndTime} / ${actual.subject || UNSET_SUBJECT_LABEL}`,
  }));
  const insightItems = [
    ...summary.underPlannedSubjects.map((entry) => ({
      id: `under-${entry.key}`,
      title: `予定より少なかった教科: ${entry.label}`,
      detail: `${formatMinutes(entry.minutes)} 少なめ`,
    })),
    ...summary.extraStudiedSubjects.map((entry) => ({
      id: `extra-${entry.key}`,
      title: `予定外に多く学習: ${entry.label}`,
      detail: `${formatMinutes(entry.minutes)} 多め`,
    })),
    {
      id: 'unset-material',
      title: '教材未設定の記録',
      detail: `${summary.materialUnsetCount}件`,
    },
  ].filter((item) => item.id !== 'unset-material' || summary.materialUnsetCount > 0);

  void props.dayNote;
  void props.monthEvents;
  void props.onSaveDayNote;

  return (
    <section className="section-stack report-view">
      <div className="panel">
        <div className="section-header">
          <div>
            <h2>レポート</h2>
            <p>{rangeLabel} の学習状況を、予定・記録・教材で確認できます。</p>
          </div>
          <div className="segmented-control report-scope-tabs" role="tablist">
            {REPORT_SCOPES.map((option) => (
              <button
                className={scope === option.value ? 'segment active' : 'segment'}
                key={option.value}
                onClick={() => setScope(option.value)}
                type="button"
                role="tab"
                aria-selected={scope === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="report-metrics-panel">
          <div className="report-metrics-primary">
            <MetricCard
              label="予定時間"
              value={formatMinutes(summary.plannedMinutes)}
              variant="primary"
            />
            <MetricCard
              label="記録時間"
              value={formatMinutes(summary.actualMinutes)}
              variant="primary"
            />
          </div>
          <div className="report-metric-chips">
            <MetricCard label="達成率" value={formatRate(summary.achievementRate)} />
            <MetricCard
              label="未記録予定"
              value={`${summary.unrecordedPlans.length}件`}
            />
            <MetricCard label={activityMetricLabel} value={activityMetricValue} />
            <MetricCard label="差分" value={diffLabel} />
          </div>
        </div>
      </div>

      {scope === 'day' ? (
        <>
          <div className="report-grid">
            <MaterialPieChart
              title="教材別学習比率"
              entries={summary.materialTotals}
              emptyText="この日の記録時間はまだありません。"
            />
            <CompactList
              title="未記録の予定"
              items={unrecordedItems}
              emptyText="未記録の学習予定はありません。"
            />
          </div>
          <div className="report-grid">
            <CompactList
              title="予定なし記録"
              items={standaloneItems}
              emptyText="予定なし記録はありません。"
            />
            <section className="panel report-card">
              <div className="section-header">
                <div>
                  <h2>教材メモ</h2>
                </div>
              </div>
              <div className="report-summary-line">
                <span>
                  最も多く使った教材: {topMaterial ? topMaterial.label : 'なし'}
                </span>
                <span>教材未設定: {summary.materialUnsetCount}件</span>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {scope === 'week' ? (
        <>
          <ComparisonBars
            title="曜日別の予定 / 記録"
            entries={getWeekDates(selectedDate).map((date) => {
              const entry = dailyComparisons.find((item) => item.key === date);
              return (
                entry ?? {
                  key: date,
                  label: getWeekdayLabel(date),
                  sublabel: formatCompactDate(date),
                  plannedMinutes: 0,
                  actualMinutes: 0,
                }
              );
            })}
            onOpenDay={props.onOpenDay}
          />
          <div className="report-grid">
            <MaterialPieChart
              title="教材別学習比率"
              entries={summary.materialTotals}
              emptyText="この週の記録時間はまだありません。"
            />
            <CompactList
              title="週の気づき"
              items={insightItems}
              emptyText="大きな偏りはまだ見つかっていません。"
            />
          </div>
          <div className="report-grid">
            <CompactList
              title="未記録の予定"
              items={unrecordedItems}
              emptyText="未記録の学習予定はありません。"
            />
            <CompactList
              title="予定なし記録"
              items={standaloneItems}
              emptyText="予定なし記録はありません。"
            />
          </div>
        </>
      ) : null}

      {scope === 'month' ? (
        <>
          <ComparisonBars title="週ごとの学習時間推移" entries={monthWeekComparisons} />
          <div className="report-grid">
            <MaterialPieChart
              title="教材別学習比率"
              entries={summary.materialTotals}
              emptyText="この月の記録時間はまだありません。"
            />
            <section className="panel report-card">
              <div className="section-header">
                <div>
                  <h2>月間サマリー</h2>
                </div>
              </div>
              <div className="report-summary-line">
                <span>学習日数: {summary.learningDays}日</span>
                <span>
                  最も多く使った教材: {topMaterial ? topMaterial.label : 'なし'}
                </span>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {scope === 'year' ? (
        <>
          <ComparisonBars title="月ごとの予定 / 記録" entries={yearMonthComparisons} />
          <div className="report-grid">
            <MaterialPieChart
              title="年間の教材別学習比率"
              entries={summary.materialTotals}
              emptyText="この年の記録時間はまだありません。"
            />
            <section className="panel report-card">
              <div className="section-header">
                <div>
                  <h2>年間サマリー</h2>
                </div>
              </div>
              <div className="report-summary-line">
                <span>年間記録時間: {formatMinutes(summary.actualMinutes)}</span>
                <span>学習日数: {summary.learningDays}日</span>
                <span>
                  最も多く使った教材: {topMaterial ? topMaterial.label : 'なし'}
                </span>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}
