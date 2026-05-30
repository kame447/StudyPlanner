import {
  addDays,
  addMonths,
  formatCompactDate,
  getMonthWeeks,
  getWeekdayLabel,
  startOfMonth,
  startOfWeek,
} from './date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDateRange,
} from './planRecurrence';
import {
  getPlannedMinutes,
  isStudyTimePlan,
} from './studyAnalytics';
import {
  isStudyRecordForDisplay,
  normalizeStudyRecordsForDisplay,
  sumStudyRecordMinutes,
} from './studyRecords';
import type { Actual, Plan, StudyMaterial, StudySubject } from '../types/domain';

export type ReportScope = 'day' | 'week' | 'month' | 'year';

export interface ReportRange {
  startDate: string;
  endDate: string;
}

export interface ReportTotalEntry {
  key: string;
  label: string;
  minutes: number;
  ratio: number;
  color?: string;
  subject?: string;
}

interface MaterialEntrySeed {
  key: string;
  label: string;
  subject: string;
}

export interface ReportPeriodComparison {
  key: string;
  label: string;
  sublabel?: string;
  plannedMinutes: number;
  actualMinutes: number;
}

export interface ReportSubjectComparison extends ReportTotalEntry {
  plannedMinutes: number;
  actualMinutes: number;
}

export interface ReportSummary {
  startDate: string;
  endDate: string;
  plannedMinutes: number;
  actualMinutes: number;
  achievementRate: number | null;
  differenceMinutes: number;
  unrecordedPlans: Plan[];
  standaloneActuals: Actual[];
  actuals: Actual[];
  subjectTotals: ReportTotalEntry[];
  materialTotals: ReportTotalEntry[];
  learningDays: number;
  materialUnsetCount: number;
  underPlannedSubjects: ReportSubjectComparison[];
  extraStudiedSubjects: ReportSubjectComparison[];
}

interface ReportAnalyticsInput {
  plans: Plan[];
  actuals: Actual[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}

export interface ReportSummaryInput extends ReportAnalyticsInput, ReportRange {}

export interface SelectedDateReportInput extends ReportAnalyticsInput {
  selectedDate: string;
}

export const DEFAULT_SUBJECT_COLOR = '#8d9aa6';
export const UNSET_SUBJECT_LABEL = '未設定';
export const UNSET_MATERIAL_LABEL = '教材未設定';
export const OTHER_MATERIAL_LABEL = 'その他';
export const OTHER_MATERIAL_COLOR = '#a4aab2';
export const MATERIAL_CHART_COLORS = [
  '#567fb6',
  '#d9824f',
  '#5f9f6e',
  '#c95f75',
  '#8a70b8',
  '#b99b3e',
  '#4f9f9a',
  '#8d9aa6',
];

export function endOfMonth(date: string): string {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

export function getYearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

export function getYearEnd(date: string): string {
  return `${date.slice(0, 4)}-12-31`;
}

export function getReportScopeRange(
  scope: ReportScope,
  selectedDate: string,
): ReportRange {
  if (scope === 'day') {
    return { startDate: selectedDate, endDate: selectedDate };
  }

  if (scope === 'week') {
    const startDate = startOfWeek(selectedDate);
    return { startDate, endDate: addDays(startDate, 6) };
  }

  if (scope === 'month') {
    return {
      startDate: startOfMonth(selectedDate),
      endDate: endOfMonth(selectedDate),
    };
  }

  return {
    startDate: getYearStart(selectedDate),
    endDate: getYearEnd(selectedDate),
  };
}

export function isDateInRange(
  date: string,
  startDate: string,
  endDate: string,
): boolean {
  return date.localeCompare(startDate) >= 0 && date.localeCompare(endDate) <= 0;
}

export function buildSubjectColorMap(
  subjects: StudySubject[],
): Map<string, string> {
  return new Map(subjects.map((subject) => [subject.name, subject.color]));
}

function getActualTitle(actual: Actual, plan?: Plan): string {
  return actual.title?.trim() || plan?.title.trim() || '';
}

export function resolveMaterialEntry({
  actual,
  plan,
  materialsById,
  materialsByName,
  fallbackSubject,
}: {
  actual: Actual;
  plan?: Plan;
  materialsById: Map<string, StudyMaterial>;
  materialsByName: Map<string, StudyMaterial>;
  fallbackSubject: string;
}): MaterialEntrySeed {
  const actualMaterialId = actual.materialId?.trim() || '';
  const actualMaterialName = actual.materialName?.trim() || '';
  const planMaterialId = plan?.materialId?.trim() || '';
  const planMaterialName = plan?.materialName?.trim() || '';

  const materialId = actualMaterialId || planMaterialId;
  const materialName = actualMaterialName || planMaterialName;
  const material =
    (materialId ? materialsById.get(materialId) : undefined) ??
    (materialName ? materialsByName.get(materialName) : undefined);

  if (materialId || materialName) {
    return {
      key: material?.id
        ? `material:${material.id}`
        : `material-name:${materialName || materialId}`,
      label: materialName || material?.name || UNSET_MATERIAL_LABEL,
      subject: material?.subjectName || fallbackSubject,
    };
  }

  const title = getActualTitle(actual, plan);

  if (title) {
    return {
      key: `title:${title}`,
      label: title,
      subject: fallbackSubject,
    };
  }

  return {
    key: '__unset__',
    label: UNSET_MATERIAL_LABEL,
    subject: fallbackSubject,
  };
}

export function getMaterialColor(
  entry: { key: string; subject: string },
  index: number,
  subjectColorMap: Map<string, string>,
): string {
  if (entry.key === '__unset__') {
    return DEFAULT_SUBJECT_COLOR;
  }

  const subjectColor = subjectColorMap.get(entry.subject);

  if (subjectColor) {
    const variants = [
      { ratio: 76, target: 'white' },
      { ratio: 72, target: 'black' },
      { ratio: 58, target: 'white' },
      { ratio: 62, target: 'black' },
      { ratio: 88, target: 'white' },
      { ratio: 46, target: 'black' },
    ];
    const variant = variants[index % variants.length];

    return `color-mix(in srgb, ${subjectColor} ${variant.ratio}%, ${variant.target})`;
  }

  return MATERIAL_CHART_COLORS[index % MATERIAL_CHART_COLORS.length];
}

export function getMaterialChartEntries(
  entries: ReportTotalEntry[],
  limit = 6,
): ReportTotalEntry[] {
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
  const otherMinutes = hiddenEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );

  return [
    ...visibleEntries,
    {
      key: '__other_materials__',
      label: OTHER_MATERIAL_LABEL,
      minutes: otherMinutes,
      ratio: visibleTotalMinutes === 0 ? 0 : otherMinutes / visibleTotalMinutes,
      color: OTHER_MATERIAL_COLOR,
    },
  ];
}

export function getMaterialChartColor(
  entry: ReportTotalEntry,
  index: number,
): string {
  if (entry.color) {
    return entry.color;
  }

  if (entry.key === '__unset__') {
    return DEFAULT_SUBJECT_COLOR;
  }

  if (entry.key === '__other_materials__') {
    return OTHER_MATERIAL_COLOR;
  }

  return MATERIAL_CHART_COLORS[index % MATERIAL_CHART_COLORS.length];
}

export function buildReportSummary({
  startDate,
  endDate,
  plans,
  actuals,
  subjects,
  materials,
}: ReportSummaryInput): ReportSummary {
  const subjectColorMap = buildSubjectColorMap(subjects);
  const materialsById = new Map(
    materials.map((material) => [material.id, material]),
  );
  const materialsByName = new Map(
    materials.map((material) => [material.name, material]),
  );
  const rangePlans = expandPlansForDateRange(plans, startDate, endDate).filter(
    isStudyTimePlan,
  );
  const rangeRecords = normalizeStudyRecordsForDisplay({
    actuals,
    plans,
    subjects,
    materials,
    startDate,
    endDate,
  }).filter(isStudyRecordForDisplay);
  const actualByOccurrenceKey = new Map(
    rangeRecords
      .filter((record) => record.isLinkedToPlan)
      .map((record) => [record.occurrenceKey, record.actual]),
  );
  const rangeActuals = rangeRecords.map((record) => record.actual);
  const plannedMinutes = rangePlans.reduce(
    (sum, plan) => sum + getPlannedMinutes(plan),
    0,
  );
  const actualMinutes = sumStudyRecordMinutes(rangeRecords);
  const subjectMinutes = new Map<string, number>();
  const plannedSubjectMinutes = new Map<string, number>();
  const materialMinutes = new Map<
    string,
    { label: string; subject: string; minutes: number }
  >();
  const materialVariantCountsBySubject = new Map<string, number>();

  rangePlans.forEach((plan) => {
    const subject = plan.subject.trim() || UNSET_SUBJECT_LABEL;
    plannedSubjectMinutes.set(
      subject,
      (plannedSubjectMinutes.get(subject) ?? 0) + getPlannedMinutes(plan),
    );
  });

  rangeRecords.forEach((record) => {
    const actual = record.actual;
    const plan = record.plan;
    const minutes = record.durationMinutes;
    const subject = record.subjectLabel;
    const materialEntry = resolveMaterialEntry({
      actual,
      plan,
      materialsById,
      materialsByName,
      fallbackSubject: subject,
    });
    const currentMaterial = materialMinutes.get(materialEntry.key) ?? {
      label: materialEntry.label,
      subject: materialEntry.subject,
      minutes: 0,
    };

    subjectMinutes.set(subject, (subjectMinutes.get(subject) ?? 0) + minutes);
    materialMinutes.set(materialEntry.key, {
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
    }))
    .sort((left, right) => right.minutes - left.minutes)
    .map((entry, index) => {
      const subjectKey = entry.subject || UNSET_SUBJECT_LABEL;
      const subjectVariantIndex =
        materialVariantCountsBySubject.get(subjectKey) ?? 0;
      materialVariantCountsBySubject.set(subjectKey, subjectVariantIndex + 1);

      return {
        ...entry,
        color: getMaterialColor(
          entry,
          subjectColorMap.has(entry.subject) ? subjectVariantIndex : index,
          subjectColorMap,
        ),
      };
    });
  const unrecordedPlans = rangePlans.filter(
    (plan) =>
      !actualByOccurrenceKey.has(buildPlanOccurrenceKey(plan.id, plan.date)),
  );
  const standaloneActuals = rangeRecords
    .filter((record) => record.linkKind === 'standalone')
    .map((record) => record.actual);
  const learningDays = new Set(
    rangeRecords
      .filter((record) => record.durationMinutes > 0)
      .map((record) => record.date),
  ).size;
  const materialUnsetCount = rangeRecords.filter((record) => {
    const actual = record.actual;
    const plan = record.plan;

    return (
      !actual.materialId?.trim() &&
      !actual.materialName?.trim() &&
      !plan?.materialId?.trim() &&
      !plan?.materialName?.trim() &&
      !getActualTitle(actual, plan)
    );
  }).length;
  const subjectComparisons = [
    ...new Set([...plannedSubjectMinutes.keys(), ...subjectMinutes.keys()]),
  ].map<ReportSubjectComparison>((subject) => {
    const planned = plannedSubjectMinutes.get(subject) ?? 0;
    const actual = subjectMinutes.get(subject) ?? 0;

    return {
      key: subject,
      label: subject,
      minutes: Math.abs(actual - planned),
      ratio: 0,
      color: subjectColorMap.get(subject) ?? DEFAULT_SUBJECT_COLOR,
      plannedMinutes: planned,
      actualMinutes: actual,
    };
  });

  return {
    startDate,
    endDate,
    plannedMinutes,
    actualMinutes,
    achievementRate:
      plannedMinutes === 0 ? null : (actualMinutes / plannedMinutes) * 100,
    differenceMinutes: actualMinutes - plannedMinutes,
    unrecordedPlans,
    standaloneActuals,
    actuals: rangeActuals,
    subjectTotals,
    materialTotals,
    learningDays,
    materialUnsetCount,
    underPlannedSubjects: subjectComparisons
      .filter((entry) => entry.plannedMinutes > entry.actualMinutes)
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 3),
    extraStudiedSubjects: subjectComparisons
      .filter((entry) => entry.actualMinutes > entry.plannedMinutes)
      .sort((left, right) => right.minutes - left.minutes)
      .slice(0, 3),
  };
}

export function buildRangeDailyComparisons({
  startDate,
  endDate,
  plans,
  actuals,
  subjects,
  materials,
}: ReportSummaryInput): ReportPeriodComparison[] {
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

export function buildMonthWeekComparisons({
  selectedDate,
  plans,
  actuals,
  subjects,
  materials,
}: SelectedDateReportInput): ReportPeriodComparison[] {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);

  return getMonthWeeks(selectedDate).map((week) => {
    const startDate =
      week.startDate.localeCompare(monthStart) < 0 ? monthStart : week.startDate;
    const endDate =
      week.endDate.localeCompare(monthEnd) > 0 ? monthEnd : week.endDate;
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

export function buildYearMonthComparisons({
  selectedDate,
  plans,
  actuals,
  subjects,
  materials,
}: SelectedDateReportInput): ReportPeriodComparison[] {
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

export function getComparisonTickStep(minutes: number): number {
  if (minutes <= 360) {
    return 60;
  }

  if (minutes <= 600) {
    return 120;
  }

  if (minutes <= 1800) {
    return 300;
  }

  if (minutes <= 3600) {
    return 600;
  }

  if (minutes <= 7200) {
    return 1200;
  }

  return 3000;
}

export function getComparisonChartMax(minutes: number): number {
  const stepMinutes = getComparisonTickStep(minutes);
  let maxMinutes = Math.ceil(minutes / stepMinutes) * stepMinutes;

  if (maxMinutes < minutes * 1.08) {
    maxMinutes += stepMinutes;
  }

  return Math.max(60, maxMinutes);
}

export function getComparisonTicks(maxMinutes: number): number[] {
  const stepMinutes = getComparisonTickStep(maxMinutes);
  const ticks: number[] = [];

  for (let minutes = maxMinutes; minutes >= 0; minutes -= stepMinutes) {
    ticks.push(minutes);
  }

  return ticks[ticks.length - 1] === 0 ? ticks : [...ticks, 0];
}
