import { useMemo, useState, type CSSProperties } from 'react';
import {
  addDays,
  addMonths,
  formatCompactDate,
  formatDateLabel,
  formatMinutes,
  formatMonthLabel,
  getMonthWeeks,
  getWeekDates,
  getWeekdayLabel,
  startOfMonth,
  startOfWeek,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDateRange,
  getActualOccurrenceKey,
} from '../lib/planRecurrence';
import {
  getActualMinutes,
  getPlannedMinutes,
  isStudyTimePlan,
} from '../lib/studyAnalytics';
import type {
  Actual,
  DayNote,
  DayNoteDraft,
  MonthEvent,
  Plan,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

type ReportScope = 'day' | 'week' | 'month' | 'year';

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

interface TotalEntry {
  key: string;
  label: string;
  minutes: number;
  ratio: number;
  color?: string;
  subject?: string;
}

interface PeriodComparison {
  key: string;
  label: string;
  sublabel?: string;
  plannedMinutes: number;
  actualMinutes: number;
}

interface ReportSummary {
  startDate: string;
  endDate: string;
  plannedMinutes: number;
  actualMinutes: number;
  achievementRate: number | null;
  unrecordedPlans: Plan[];
  standaloneActuals: Actual[];
  actuals: Actual[];
  subjectTotals: TotalEntry[];
  materialTotals: TotalEntry[];
  learningDays: number;
  materialUnsetCount: number;
  underPlannedSubjects: TotalEntry[];
  extraStudiedSubjects: TotalEntry[];
}

const REPORT_SCOPES: Array<{ value: ReportScope; label: string }> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '週' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

const DEFAULT_SUBJECT_COLOR = '#8d9aa6';
const UNSET_SUBJECT_LABEL = '未設定';
const UNSET_MATERIAL_LABEL = '教材未設定';
const OTHER_MATERIAL_LABEL = 'その他';
const MATERIAL_CHART_COLORS = [
  '#567fb6',
  '#d9824f',
  '#5f9f6e',
  '#c95f75',
  '#8a70b8',
  '#b99b3e',
  '#4f9f9a',
  '#8d9aa6',
];

function endOfMonth(date: string): string {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

function getYearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

function getYearEnd(date: string): string {
  return `${date.slice(0, 4)}-12-31`;
}

function isDateInRange(date: string, startDate: string, endDate: string): boolean {
  return date.localeCompare(startDate) >= 0 && date.localeCompare(endDate) <= 0;
}

function formatRate(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate)}%`;
}

function getComparisonChartMax(minutes: number): number {
  const paddedMinutes = minutes * 1.16;

  if (paddedMinutes <= 60) {
    return 60;
  }

  if (paddedMinutes <= 120) {
    return Math.ceil(paddedMinutes / 30) * 30;
  }

  if (paddedMinutes <= 360) {
    return Math.ceil(paddedMinutes / 60) * 60;
  }

  return Math.ceil(paddedMinutes / 120) * 120;
}

function getComparisonTicks(maxMinutes: number): number[] {
  return Array.from({ length: 5 }, (_, index) =>
    Math.round(maxMinutes - (maxMinutes / 4) * index),
  );
}

function buildSubjectColorMap(subjects: StudySubject[]): Map<string, string> {
  return new Map(subjects.map((subject) => [subject.name, subject.color]));
}

function getPlanByOccurrenceKey(plans: Plan[]): Map<string, Plan> {
  return new Map(
    plans.map((plan) => [buildPlanOccurrenceKey(plan.id, plan.date), plan]),
  );
}

function getActualSubject(actual: Actual, plan?: Plan): string {
  return actual.subject.trim() || plan?.subject.trim() || UNSET_SUBJECT_LABEL;
}

function getMaterialChartEntries(entries: TotalEntry[], limit = 6): TotalEntry[] {
  const positiveEntries = entries.filter((entry) => entry.minutes > 0);

  if (positiveEntries.length <= limit) {
    return positiveEntries;
  }

  const visibleEntries = positiveEntries.slice(0, limit - 1);
  const hiddenEntries = positiveEntries.slice(limit - 1);
  const visibleTotalMinutes = positiveEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );
  const otherMinutes = hiddenEntries.reduce((sum, entry) => sum + entry.minutes, 0);

  return [
    ...visibleEntries,
    {
      key: '__other_materials__',
      label: OTHER_MATERIAL_LABEL,
      minutes: otherMinutes,
      ratio: visibleTotalMinutes === 0 ? 0 : otherMinutes / visibleTotalMinutes,
      color: DEFAULT_SUBJECT_COLOR,
    },
  ];
}

function getMaterialChartColor(entry: TotalEntry, index: number): string {
  if (entry.key === '__unset__' || entry.key === '__other_materials__') {
    return DEFAULT_SUBJECT_COLOR;
  }

  return MATERIAL_CHART_COLORS[index % MATERIAL_CHART_COLORS.length];
}

function buildMaterialPieGradient(entries: TotalEntry[]): string {
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

function buildReportSummary({
  startDate,
  endDate,
  plans,
  actuals,
  subjects,
  materials,
}: {
  startDate: string;
  endDate: string;
  plans: Plan[];
  actuals: Actual[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}): ReportSummary {
  const subjectColorMap = buildSubjectColorMap(subjects);
  const materialsById = new Map(materials.map((material) => [material.id, material]));
  const materialsByName = new Map(materials.map((material) => [material.name, material]));
  const rangePlans = expandPlansForDateRange(plans, startDate, endDate).filter(
    isStudyTimePlan,
  );
  const planByOccurrenceKey = getPlanByOccurrenceKey(rangePlans);
  const actualByOccurrenceKey = new Map(
    actuals
      .filter((actual) => actual.planId)
      .map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const rangeActuals = actuals.filter((actual) => {
    if (!isDateInRange(actual.occurrenceDate, startDate, endDate)) {
      return false;
    }

    return !actual.planId || planByOccurrenceKey.has(getActualOccurrenceKey(actual));
  });
  const plannedMinutes = rangePlans.reduce(
    (sum, plan) => sum + getPlannedMinutes(plan),
    0,
  );
  const actualMinutes = rangeActuals.reduce(
    (sum, actual) => sum + getActualMinutes(actual),
    0,
  );
  const subjectMinutes = new Map<string, number>();
  const plannedSubjectMinutes = new Map<string, number>();
  const materialMinutes = new Map<string, { label: string; subject: string; minutes: number }>();

  rangePlans.forEach((plan) => {
    const subject = plan.subject.trim() || UNSET_SUBJECT_LABEL;
    plannedSubjectMinutes.set(
      subject,
      (plannedSubjectMinutes.get(subject) ?? 0) + getPlannedMinutes(plan),
    );
  });

  rangeActuals.forEach((actual) => {
    const plan = actual.planId ? planByOccurrenceKey.get(getActualOccurrenceKey(actual)) : undefined;
    const minutes = getActualMinutes(actual);
    const subject = getActualSubject(actual, plan);
    const materialId = actual.materialId?.trim() || plan?.materialId?.trim() || '';
    const materialName = actual.materialName?.trim() || plan?.materialName?.trim() || '';
    const material =
      (materialId ? materialsById.get(materialId) : undefined) ??
      (materialName ? materialsByName.get(materialName) : undefined);
    const materialKey =
      materialId || (materialName ? `name:${materialName}` : '__unset__');
    const materialLabel = materialName || material?.name || UNSET_MATERIAL_LABEL;
    const materialSubject = material?.subjectName || subject;
    const currentMaterial = materialMinutes.get(materialKey) ?? {
      label: materialLabel,
      subject: materialSubject,
      minutes: 0,
    };

    subjectMinutes.set(subject, (subjectMinutes.get(subject) ?? 0) + minutes);
    materialMinutes.set(materialKey, {
      ...currentMaterial,
      minutes: currentMaterial.minutes + minutes,
    });
  });

  const subjectTotals = [...subjectMinutes.entries()]
    .map(([label, minutes]) => ({
      key: label,
      label,
      minutes,
      ratio: actualMinutes === 0 ? 0 : minutes / actualMinutes,
      color: subjectColorMap.get(label) ?? DEFAULT_SUBJECT_COLOR,
    }))
    .sort((left, right) => right.minutes - left.minutes);
  const materialTotals = [...materialMinutes.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      subject: entry.subject,
      minutes: entry.minutes,
      ratio: actualMinutes === 0 ? 0 : entry.minutes / actualMinutes,
      color: subjectColorMap.get(entry.subject) ?? DEFAULT_SUBJECT_COLOR,
    }))
    .sort((left, right) => right.minutes - left.minutes);
  const unrecordedPlans = rangePlans.filter(
    (plan) => !actualByOccurrenceKey.has(buildPlanOccurrenceKey(plan.id, plan.date)),
  );
  const standaloneActuals = rangeActuals.filter((actual) => !actual.planId);
  const learningDays = new Set(
    rangeActuals.filter((actual) => getActualMinutes(actual) > 0).map((actual) => actual.occurrenceDate),
  ).size;
  const materialUnsetCount = rangeActuals.filter((actual) => {
    const plan = actual.planId ? planByOccurrenceKey.get(getActualOccurrenceKey(actual)) : undefined;

    return (
      !actual.materialId?.trim() &&
      !actual.materialName?.trim() &&
      !plan?.materialId?.trim() &&
      !plan?.materialName?.trim()
    );
  }).length;
  const subjectComparisons = [...new Set([
    ...plannedSubjectMinutes.keys(),
    ...subjectMinutes.keys(),
  ])].map((subject) => ({
    key: subject,
    label: subject,
    minutes: Math.abs((subjectMinutes.get(subject) ?? 0) - (plannedSubjectMinutes.get(subject) ?? 0)),
    ratio: 0,
    color: subjectColorMap.get(subject) ?? DEFAULT_SUBJECT_COLOR,
    planned: plannedSubjectMinutes.get(subject) ?? 0,
    actual: subjectMinutes.get(subject) ?? 0,
  }));

  return {
    startDate,
    endDate,
    plannedMinutes,
    actualMinutes,
    achievementRate: plannedMinutes === 0 ? null : (actualMinutes / plannedMinutes) * 100,
    unrecordedPlans,
    standaloneActuals,
    actuals: rangeActuals,
    subjectTotals,
    materialTotals,
    learningDays,
    materialUnsetCount,
    underPlannedSubjects: subjectComparisons
      .filter((entry) => entry.planned > entry.actual)
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 3),
    extraStudiedSubjects: subjectComparisons
      .filter((entry) => entry.actual > entry.planned)
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 3),
  };
}

function buildRangeDailyComparisons({
  startDate,
  endDate,
  plans,
  actuals,
  subjects,
  materials,
}: {
  startDate: string;
  endDate: string;
  plans: Plan[];
  actuals: Actual[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}): PeriodComparison[] {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor.localeCompare(endDate) <= 0) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates.map((date) => {
    const summary = buildReportSummary({
      startDate: date,
      endDate: date,
      plans,
      actuals,
      subjects,
      materials,
    });

    return {
      key: date,
      label: getWeekdayLabel(date),
      sublabel: formatCompactDate(date),
      plannedMinutes: summary.plannedMinutes,
      actualMinutes: summary.actualMinutes,
    };
  });
}

function buildMonthWeekComparisons({
  selectedDate,
  plans,
  actuals,
  subjects,
  materials,
}: {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}): PeriodComparison[] {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);

  return getMonthWeeks(selectedDate).map((week) => {
    const startDate =
      week.startDate.localeCompare(monthStart) < 0 ? monthStart : week.startDate;
    const endDate = week.endDate.localeCompare(monthEnd) > 0 ? monthEnd : week.endDate;
    const summary = buildReportSummary({
      startDate,
      endDate,
      plans,
      actuals,
      subjects,
      materials,
    });

    return {
      key: week.startDate,
      label: week.label,
      sublabel: `${formatCompactDate(startDate)}-${formatCompactDate(endDate)}`,
      plannedMinutes: summary.plannedMinutes,
      actualMinutes: summary.actualMinutes,
    };
  });
}

function buildYearMonthComparisons({
  selectedDate,
  plans,
  actuals,
  subjects,
  materials,
}: {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}): PeriodComparison[] {
  const year = selectedDate.slice(0, 4);

  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}-01`;
    const summary = buildReportSummary({
      startDate: month,
      endDate: endOfMonth(month),
      plans,
      actuals,
      subjects,
      materials,
    });

    return {
      key: month,
      label: `${index + 1}月`,
      plannedMinutes: summary.plannedMinutes,
      actualMinutes: summary.actualMinutes,
    };
  });
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
  entries: TotalEntry[];
  emptyText: string;
}) {
  const chartEntries = getMaterialChartEntries(entries);
  const chartTotalMinutes = chartEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );

  return (
    <section className="panel report-card">
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
            />
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
  entries: PeriodComparison[];
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
        <div
          className="report-comparison-chart"
          style={{
            gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))`,
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
                            {formatMinutes(entry.plannedMinutes)}
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
                            {formatMinutes(entry.actualMinutes)}
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
  const weekStart = startOfWeek(selectedDate);
  const monthStart = startOfMonth(selectedDate);
  const scopeRange = {
    day: { startDate: selectedDate, endDate: selectedDate },
    week: { startDate: weekStart, endDate: addDays(weekStart, 6) },
    month: { startDate: monthStart, endDate: endOfMonth(selectedDate) },
    year: { startDate: getYearStart(selectedDate), endDate: getYearEnd(selectedDate) },
  }[scope];
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
    () =>
      buildRangeDailyComparisons({
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
  const monthWeekComparisons = useMemo(
    () =>
      buildMonthWeekComparisons({
        selectedDate,
        plans: props.plans,
        actuals: props.actuals,
        subjects,
        materials,
      }),
    [materials, props.actuals, props.plans, selectedDate, subjects],
  );
  const yearMonthComparisons = useMemo(
    () =>
      buildYearMonthComparisons({
        selectedDate,
        plans: props.plans,
        actuals: props.actuals,
        subjects,
        materials,
      }),
    [materials, props.actuals, props.plans, selectedDate, subjects],
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
  const diffMinutes = summary.actualMinutes - summary.plannedMinutes;
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
