import {
  addDays,
  addMonths,
  formatCompactDate,
  formatMinutes,
  getWeekdayLabel,
  startOfMonth,
  startOfWeek,
} from './date';
import { expandPlansForDateRange } from './planRecurrence';
import {
  buildReportSummary,
  buildSubjectColorMap,
  endOfMonth,
  getMaterialColor,
  resolveMaterialEntry,
} from './reportAnalytics';
import { getPlannedMinutes, isStudyTimePlan } from './studyAnalytics';
import {
  dedupeLinkedStudyActuals,
  isStudyRecordForDisplay,
  normalizeStudyRecordForDisplay,
  normalizeStudyRecordsForDisplay,
  sumStudyRecordMinutes,
  type NormalizedStudyRecordForDisplay,
} from './studyRecords';
import type { Actual, Plan, StudyMaterial, StudySubject } from '../types/domain';

export type LearningReportScope = 'day' | 'week' | 'month';

export const ALL_MATERIALS_FILTER = '__all_materials__';
const UNSET_BREAKDOWN_LABEL = '未設定';

export interface LearningReportRange {
  startDate: string;
  endDate: string;
}

export interface LearningReportOverview {
  todayMinutes: number;
  todayPlannedMinutes: number;
  weekMinutes: number;
  weekPlannedMinutes: number;
  monthMinutes: number;
  monthPlannedMinutes: number;
  lifetimeMinutes: number;
}

export interface LearningReportMaterialOption {
  value: string;
  label: string;
}

export interface LearningReportTrendBucket {
  key: string;
  label: string;
  sublabel?: string;
  actualMinutes: number;
  plannedMinutes: number;
}

export interface LearningReportBreakdownEntry {
  key: string;
  label: string;
  subject: string;
  minutes: number;
  ratio: number;
  color: string;
}

export interface LearningReportModel {
  scope: LearningReportScope;
  startDate: string;
  endDate: string;
  actualMinutes: number;
  plannedMinutes: number;
  buckets: LearningReportTrendBucket[];
  breakdown: LearningReportBreakdownEntry[];
  insight: string | null;
}

interface LearningReportDataInput {
  plans: Plan[];
  actuals: Actual[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}

export interface BuildLearningReportOverviewInput extends LearningReportDataInput {
  referenceDate: string;
}

export interface BuildLearningReportModelInput extends LearningReportDataInput {
  scope: LearningReportScope;
  anchorDate: string;
  materialFilter: string;
}

interface ResolvedBreakdownSeed {
  key: string;
  label: string;
  subject: string;
}

function formatFullDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${year}年${month}月${day}日`;
}

function buildMaterialsById(materials: StudyMaterial[]): Map<string, StudyMaterial> {
  return new Map(materials.map((material) => [material.id, material]));
}

function buildMaterialsByName(materials: StudyMaterial[]): Map<string, StudyMaterial> {
  return new Map(materials.map((material) => [material.name, material]));
}

function resolvePlanMaterialKey(
  plan: Plan,
  materialsById: Map<string, StudyMaterial>,
  materialsByName: Map<string, StudyMaterial>,
): string | null {
  const materialId = plan.materialId?.trim() || '';
  const materialName = plan.materialName?.trim() || '';
  const material =
    (materialId ? materialsById.get(materialId) : undefined) ??
    (materialName ? materialsByName.get(materialName) : undefined);

  if (!materialId && !materialName) {
    return null;
  }

  if (material?.id) {
    return `material:${material.id}`;
  }

  return `material-name:${materialName || materialId}`;
}

function resolveRecordMaterial(
  record: NormalizedStudyRecordForDisplay,
  materialsById: Map<string, StudyMaterial>,
  materialsByName: Map<string, StudyMaterial>,
) {
  return resolveMaterialEntry({
    actual: record.actual,
    plan: record.plan,
    materialsById,
    materialsByName,
    fallbackSubject: record.subjectLabel,
  });
}

function resolveBreakdownSeed(
  record: NormalizedStudyRecordForDisplay,
  materialsById: Map<string, StudyMaterial>,
  materialsByName: Map<string, StudyMaterial>,
): ResolvedBreakdownSeed {
  if (record.materialId || record.materialName) {
    return resolveRecordMaterial(record, materialsById, materialsByName);
  }

  const subject = record.subjectLabel.trim() || UNSET_BREAKDOWN_LABEL;
  return {
    key: `subject:${subject}`,
    label: subject,
    subject,
  };
}

function filterRecordsByMaterial(
  records: NormalizedStudyRecordForDisplay[],
  materialFilter: string,
  materialsById: Map<string, StudyMaterial>,
  materialsByName: Map<string, StudyMaterial>,
): NormalizedStudyRecordForDisplay[] {
  if (materialFilter === ALL_MATERIALS_FILTER) {
    return records;
  }

  return records.filter(
    (record) =>
      resolveRecordMaterial(record, materialsById, materialsByName).key ===
      materialFilter,
  );
}

function filterPlansByMaterial(
  plans: Plan[],
  materialFilter: string,
  materialsById: Map<string, StudyMaterial>,
  materialsByName: Map<string, StudyMaterial>,
): Plan[] {
  if (materialFilter === ALL_MATERIALS_FILTER) {
    return plans;
  }

  return plans.filter(
    (plan) =>
      resolvePlanMaterialKey(plan, materialsById, materialsByName) ===
      materialFilter,
  );
}

function getStudyRecordsInRange({
  startDate,
  endDate,
  plans,
  actuals,
  subjects,
  materials,
  materialFilter,
}: LearningReportDataInput &
  LearningReportRange & {
    materialFilter: string;
  }): NormalizedStudyRecordForDisplay[] {
  const materialsById = buildMaterialsById(materials);
  const materialsByName = buildMaterialsByName(materials);
  const records = normalizeStudyRecordsForDisplay({
    actuals,
    plans,
    subjects,
    materials,
    startDate,
    endDate,
  }).filter(isStudyRecordForDisplay);

  return filterRecordsByMaterial(
    records,
    materialFilter,
    materialsById,
    materialsByName,
  );
}

function getStudyPlansInRange({
  startDate,
  endDate,
  plans,
  materials,
  materialFilter,
}: Pick<LearningReportDataInput, 'plans' | 'materials'> &
  LearningReportRange & {
    materialFilter: string;
  }): Plan[] {
  const materialsById = buildMaterialsById(materials);
  const materialsByName = buildMaterialsByName(materials);
  const expandedPlans = expandPlansForDateRange(plans, startDate, endDate).filter(
    isStudyTimePlan,
  );

  return filterPlansByMaterial(
    expandedPlans,
    materialFilter,
    materialsById,
    materialsByName,
  );
}

function sumLifetimeStudyMinutes({
  plans,
  actuals,
  subjects,
  materials,
}: LearningReportDataInput): number {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const records = dedupeLinkedStudyActuals(actuals)
    .map((actual) =>
      normalizeStudyRecordForDisplay({
        actual,
        plan: actual.planId ? planById.get(actual.planId) : undefined,
        subjects,
        materials,
      }),
    )
    .filter(isStudyRecordForDisplay);

  return sumStudyRecordMinutes(records);
}

function buildBreakdown({
  records,
  subjects,
  materials,
}: {
  records: NormalizedStudyRecordForDisplay[];
  subjects: StudySubject[];
  materials: StudyMaterial[];
}): LearningReportBreakdownEntry[] {
  const totalMinutes = sumStudyRecordMinutes(records);
  const materialsById = buildMaterialsById(materials);
  const materialsByName = buildMaterialsByName(materials);
  const subjectColorMap = buildSubjectColorMap(subjects);
  const grouped = new Map<
    string,
    { label: string; subject: string; minutes: number }
  >();

  records.forEach((record) => {
    const seed = resolveBreakdownSeed(record, materialsById, materialsByName);
    const current = grouped.get(seed.key) ?? {
      label: seed.label,
      subject: seed.subject,
      minutes: 0,
    };

    grouped.set(seed.key, {
      ...current,
      minutes: current.minutes + record.durationMinutes,
    });
  });

  const subjectVariantCounts = new Map<string, number>();

  return [...grouped.entries()]
    .map(([key, entry]) => ({
      key,
      ...entry,
    }))
    .filter((entry) => entry.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes)
    .map((entry, index) => {
      const subjectKey = entry.subject || UNSET_BREAKDOWN_LABEL;
      const subjectVariantIndex = subjectVariantCounts.get(subjectKey) ?? 0;
      subjectVariantCounts.set(subjectKey, subjectVariantIndex + 1);

      return {
        ...entry,
        ratio: totalMinutes === 0 ? 0 : entry.minutes / totalMinutes,
        color: getMaterialColor(
          entry,
          subjectColorMap.has(entry.subject) ? subjectVariantIndex : index,
          subjectColorMap,
        ),
      };
    });
}

function buildDailyBuckets({
  startDate,
  endDate,
  records,
  plans,
}: LearningReportRange & {
  records: NormalizedStudyRecordForDisplay[];
  plans: Plan[];
}): LearningReportTrendBucket[] {
  const actualByDate = new Map<string, number>();
  const plannedByDate = new Map<string, number>();

  records.forEach((record) => {
    actualByDate.set(
      record.date,
      (actualByDate.get(record.date) ?? 0) + record.durationMinutes,
    );
  });

  plans.forEach((plan) => {
    plannedByDate.set(
      plan.date,
      (plannedByDate.get(plan.date) ?? 0) + getPlannedMinutes(plan),
    );
  });

  const buckets: LearningReportTrendBucket[] = [];
  let cursor = startDate;

  while (cursor.localeCompare(endDate) <= 0) {
    buckets.push({
      key: cursor,
      label: formatCompactDate(cursor),
      sublabel: getWeekdayLabel(cursor),
      actualMinutes: actualByDate.get(cursor) ?? 0,
      plannedMinutes: plannedByDate.get(cursor) ?? 0,
    });
    cursor = addDays(cursor, 1);
  }

  return buckets;
}

function buildDaySessionBuckets(
  records: NormalizedStudyRecordForDisplay[],
): LearningReportTrendBucket[] {
  return records.map((record) => ({
    key: record.id,
    label: record.startTime || '記録',
    sublabel: record.materialLabel || record.subjectLabel,
    actualMinutes: record.durationMinutes,
    plannedMinutes: 0,
  }));
}

function getPreviousRange(
  scope: LearningReportScope,
  range: LearningReportRange,
): LearningReportRange {
  if (scope === 'day') {
    const previous = addDays(range.startDate, -1);
    return { startDate: previous, endDate: previous };
  }

  if (scope === 'week') {
    return {
      startDate: addDays(range.startDate, -7),
      endDate: addDays(range.endDate, -7),
    };
  }

  const previousMonth = addMonths(range.startDate, -1);
  return {
    startDate: startOfMonth(previousMonth),
    endDate: endOfMonth(previousMonth),
  };
}

function buildInsight({
  scope,
  currentMinutes,
  previousMinutes,
  breakdown,
}: {
  scope: LearningReportScope;
  currentMinutes: number;
  previousMinutes: number;
  breakdown: LearningReportBreakdownEntry[];
}): string | null {
  if (currentMinutes <= 0) {
    return null;
  }

  if (previousMinutes > 0 && currentMinutes !== previousMinutes) {
    const difference = currentMinutes - previousMinutes;
    return `前の期間より${formatMinutes(Math.abs(difference))}${difference > 0 ? '多く' : '少なく'}学習しています。`;
  }

  const topEntry = breakdown[0];

  if (topEntry && breakdown.length > 1 && topEntry.ratio >= 0.5) {
    return `${topEntry.label}がこの期間の学習時間の${Math.round(topEntry.ratio * 100)}%を占めています。`;
  }

  const scopeLabel = scope === 'day' ? '今日' : scope === 'week' ? 'この週' : 'この月';
  return `${scopeLabel}の学習時間は${formatMinutes(currentMinutes)}です。`;
}

export function getLearningReportRange(
  scope: LearningReportScope,
  anchorDate: string,
): LearningReportRange {
  if (scope === 'day') {
    return { startDate: anchorDate, endDate: anchorDate };
  }

  if (scope === 'week') {
    const startDate = startOfWeek(anchorDate);
    return { startDate, endDate: addDays(startDate, 6) };
  }

  return {
    startDate: startOfMonth(anchorDate),
    endDate: endOfMonth(anchorDate),
  };
}

export function shiftLearningReportAnchor(
  scope: LearningReportScope,
  anchorDate: string,
  direction: -1 | 1,
): string {
  if (scope === 'day') {
    return addDays(anchorDate, direction);
  }

  if (scope === 'week') {
    return addDays(anchorDate, direction * 7);
  }

  return addMonths(anchorDate, direction);
}

export function formatLearningReportRangeLabel(
  scope: LearningReportScope,
  anchorDate: string,
): string {
  const range = getLearningReportRange(scope, anchorDate);

  if (scope === 'day') {
    return formatFullDate(range.startDate);
  }

  if (scope === 'month') {
    const [year, month] = range.startDate.split('-');
    return `${year}年${month}月`;
  }

  return `${formatFullDate(range.startDate)}〜${formatFullDate(range.endDate)}`;
}

export function buildLearningReportMaterialOptions(
  materials: StudyMaterial[],
): LearningReportMaterialOption[] {
  return [
    { value: ALL_MATERIALS_FILTER, label: 'すべての教材' },
    ...materials
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, 'ja'))
      .map((material) => ({
        value: `material:${material.id}`,
        label: material.name,
      })),
  ];
}

export function buildLearningReportOverview({
  referenceDate,
  plans,
  actuals,
  subjects,
  materials,
}: BuildLearningReportOverviewInput): LearningReportOverview {
  const today = buildReportSummary({
    startDate: referenceDate,
    endDate: referenceDate,
    plans,
    actuals,
    subjects,
    materials,
  });
  const weekRange = getLearningReportRange('week', referenceDate);
  const week = buildReportSummary({
    ...weekRange,
    plans,
    actuals,
    subjects,
    materials,
  });
  const monthRange = getLearningReportRange('month', referenceDate);
  const month = buildReportSummary({
    ...monthRange,
    plans,
    actuals,
    subjects,
    materials,
  });

  return {
    todayMinutes: today.actualMinutes,
    todayPlannedMinutes: today.plannedMinutes,
    weekMinutes: week.actualMinutes,
    weekPlannedMinutes: week.plannedMinutes,
    monthMinutes: month.actualMinutes,
    monthPlannedMinutes: month.plannedMinutes,
    lifetimeMinutes: sumLifetimeStudyMinutes({
      plans,
      actuals,
      subjects,
      materials,
    }),
  };
}

export function buildLearningReportModel({
  scope,
  anchorDate,
  materialFilter,
  plans,
  actuals,
  subjects,
  materials,
}: BuildLearningReportModelInput): LearningReportModel {
  const range = getLearningReportRange(scope, anchorDate);
  const records = getStudyRecordsInRange({
    ...range,
    plans,
    actuals,
    subjects,
    materials,
    materialFilter,
  });
  const rangePlans = getStudyPlansInRange({
    ...range,
    plans,
    materials,
    materialFilter,
  });
  const actualMinutes = sumStudyRecordMinutes(records);
  const plannedMinutes = rangePlans.reduce(
    (sum, plan) => sum + getPlannedMinutes(plan),
    0,
  );
  const breakdown = buildBreakdown({ records, subjects, materials });
  const buckets =
    scope === 'day'
      ? buildDaySessionBuckets(records)
      : buildDailyBuckets({
          ...range,
          records,
          plans: rangePlans,
        });
  const previousRange = getPreviousRange(scope, range);
  const previousMinutes = sumStudyRecordMinutes(
    getStudyRecordsInRange({
      ...previousRange,
      plans,
      actuals,
      subjects,
      materials,
      materialFilter,
    }),
  );

  return {
    scope,
    ...range,
    actualMinutes,
    plannedMinutes,
    buckets,
    breakdown,
    insight: buildInsight({
      scope,
      currentMinutes: actualMinutes,
      previousMinutes,
      breakdown,
    }),
  };
}
