import { useMemo, useState } from 'react';
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

function getTopEntries(entries: TotalEntry[], limit = 5): TotalEntry[] {
  return entries.slice(0, limit);
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
    const material =
      (actual.materialId ? materialsById.get(actual.materialId) : undefined) ??
      (actual.materialName ? materialsByName.get(actual.materialName) : undefined);
    const materialKey =
      actual.materialId?.trim() ||
      (actual.materialName?.trim() ? `name:${actual.materialName.trim()}` : '__unset__');
    const materialLabel =
      actual.materialName?.trim() || material?.name || UNSET_MATERIAL_LABEL;
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
  const materialUnsetCount = rangeActuals.filter(
    (actual) => !actual.materialId && !actual.materialName?.trim(),
  ).length;
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
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  return (
    <article className="report-metric-card">
      <span className="report-metric-label">{label}</span>
      <strong className="report-metric-value">{value}</strong>
      {help ? <span className="report-metric-help">{help}</span> : null}
    </article>
  );
}

function TotalsList({
  title,
  entries,
  emptyText,
}: {
  title: string;
  entries: TotalEntry[];
  emptyText: string;
}) {
  return (
    <section className="panel report-card">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="empty-copy">{emptyText}</p>
      ) : (
        <div className="report-ranking-list">
          {entries.map((entry) => (
            <article className="report-ranking-item" key={entry.key}>
              <div className="report-ranking-head">
                <div className="label-row">
                  <span
                    className="report-color-dot"
                    style={{ backgroundColor: entry.color ?? DEFAULT_SUBJECT_COLOR }}
                  />
                  <strong>{entry.label}</strong>
                </div>
                <span>{formatMinutes(entry.minutes)}</span>
              </div>
              {entry.subject ? (
                <span className="report-ranking-subject">{entry.subject}</span>
              ) : null}
              <div className="subject-breakdown-track">
                <div
                  className="subject-breakdown-fill"
                  style={{
                    width: `${Math.round(entry.ratio * 100)}%`,
                    backgroundColor: entry.color ?? DEFAULT_SUBJECT_COLOR,
                  }}
                />
              </div>
              <span className="report-ranking-ratio">
                {Math.round(entry.ratio * 100)}%
              </span>
            </article>
          ))}
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
  const maxMinutes = Math.max(
    60,
    ...entries.flatMap((entry) => [entry.plannedMinutes, entry.actualMinutes]),
  );

  return (
    <section className="panel report-card">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="report-comparison-list">
        {entries.map((entry) => {
          const content = (
            <>
              <div className="report-comparison-label">
                <strong>{entry.label}</strong>
                {entry.sublabel ? <span>{entry.sublabel}</span> : null}
              </div>
              <div className="report-comparison-bars">
                <div className="report-comparison-row">
                  <span>予定</span>
                  <div className="report-comparison-track">
                    <div
                      className="report-comparison-fill planned"
                      style={{ width: `${(entry.plannedMinutes / maxMinutes) * 100}%` }}
                    />
                  </div>
                  <span>{formatMinutes(entry.plannedMinutes)}</span>
                </div>
                <div className="report-comparison-row">
                  <span>記録</span>
                  <div className="report-comparison-track">
                    <div
                      className="report-comparison-fill actual"
                      style={{ width: `${(entry.actualMinutes / maxMinutes) * 100}%` }}
                    />
                  </div>
                  <span>{formatMinutes(entry.actualMinutes)}</span>
                </div>
              </div>
            </>
          );

          return onOpenDay && /^\d{4}-\d{2}-\d{2}$/.test(entry.key) ? (
            <button
              className="report-comparison-item interactive"
              key={entry.key}
              onClick={() => onOpenDay(entry.key)}
              type="button"
            >
              {content}
            </button>
          ) : (
            <article className="report-comparison-item" key={entry.key}>
              {content}
            </article>
          );
        })}
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
  const topMaterials = getTopEntries(summary.materialTotals);
  const topSubjects = getTopEntries(summary.subjectTotals);
  const topMaterial = topMaterials[0];
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
            <p>{rangeLabel} の学習状況を、予定・記録・教科・教材で確認できます。</p>
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

        <div className="report-metrics-grid">
          <MetricCard label="予定時間" value={formatMinutes(summary.plannedMinutes)} />
          <MetricCard label="記録時間" value={formatMinutes(summary.actualMinutes)} />
          <MetricCard label="達成率" value={formatRate(summary.achievementRate)} />
          <MetricCard
            label="未記録予定"
            value={`${summary.unrecordedPlans.length}件`}
          />
          <MetricCard
            label={scope === 'month' || scope === 'year' ? '学習日数' : '予定なし記録'}
            value={scope === 'month' || scope === 'year' ? `${summary.learningDays}日` : `${summary.standaloneActuals.length}件`}
          />
        </div>
      </div>

      {scope === 'day' ? (
        <>
          <div className="report-grid">
            <TotalsList
              title="教科別学習時間"
              entries={topSubjects}
              emptyText="この日の記録はまだありません。"
            />
            <TotalsList
              title="教材別学習時間"
              entries={topMaterials}
              emptyText="教材付きの記録はまだありません。"
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
            <TotalsList
              title="教科別学習時間"
              entries={topSubjects}
              emptyText="この週の記録はまだありません。"
            />
            <TotalsList
              title="教材別学習時間"
              entries={topMaterials}
              emptyText="教材付きの記録はまだありません。"
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
          <div className="report-grid">
            <CompactList
              title="週の気づき"
              items={insightItems}
              emptyText="大きな偏りはまだ見つかっていません。"
            />
            <section className="panel report-card">
              <div className="section-header">
                <div>
                  <h2>よく使った教材</h2>
                </div>
              </div>
              {topMaterial ? (
                <div className="report-feature-material">
                  <strong>{topMaterial.label}</strong>
                  <span>{topMaterial.subject ?? UNSET_SUBJECT_LABEL}</span>
                  <b>{formatMinutes(topMaterial.minutes)}</b>
                </div>
              ) : (
                <p className="empty-copy">教材付きの記録はまだありません。</p>
              )}
            </section>
          </div>
        </>
      ) : null}

      {scope === 'month' ? (
        <>
          <ComparisonBars title="週ごとの学習時間推移" entries={monthWeekComparisons} />
          <div className="report-grid">
            <TotalsList
              title="教科別学習時間"
              entries={topSubjects}
              emptyText="この月の記録はまだありません。"
            />
            <TotalsList
              title="教材別学習時間"
              entries={topMaterials}
              emptyText="教材付きの記録はまだありません。"
            />
          </div>
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
        </>
      ) : null}

      {scope === 'year' ? (
        <>
          <ComparisonBars title="月ごとの予定 / 記録" entries={yearMonthComparisons} />
          <div className="report-grid">
            <TotalsList
              title="年間の教科別学習時間"
              entries={topSubjects}
              emptyText="この年の記録はまだありません。"
            />
            <TotalsList
              title="年間の教材別学習時間"
              entries={topMaterials}
              emptyText="教材付きの記録はまだありません。"
            />
          </div>
          <section className="panel report-card">
            <div className="section-header">
              <div>
                <h2>年間サマリー</h2>
              </div>
            </div>
            <div className="report-summary-line">
              <span>年間記録時間: {formatMinutes(summary.actualMinutes)}</span>
              <span>学習日数: {summary.learningDays}日</span>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
