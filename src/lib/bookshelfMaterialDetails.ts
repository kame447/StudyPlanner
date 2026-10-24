import { getEntryDurationMinutes } from './entryTimeRange';
import type { Actual, Plan, StudyMaterial } from '../types/domain';

export interface MaterialStructureItem {
  id: string;
  title: string;
  startUnit?: number;
  endUnit?: number;
  progressRate?: number;
  children?: MaterialStructureItem[];
}

export interface MaterialDetailPreferences {
  structureEnabled: boolean;
  structureVisible: boolean;
  favorite: boolean;
  structureItems: MaterialStructureItem[];
}

export interface MaterialActivitySummary {
  actuals: Actual[];
  plans: Plan[];
  recentActuals: Actual[];
  upcomingPlans: Plan[];
  actualMinutes: number;
  plannedMinutes: number;
  sessionCount: number;
  lastStudyDate: string | null;
}

export function getDefaultMaterialDetailPreferences(): MaterialDetailPreferences {
  return {
    structureEnabled: false,
    structureVisible: true,
    favorite: false,
    structureItems: [],
  };
}

export function isRecordForMaterial(
  record: Pick<Plan | Actual, 'materialId' | 'materialName'>,
  material: StudyMaterial,
): boolean {
  if (record.materialId) {
    return record.materialId === material.id;
  }

  return Boolean(record.materialName?.trim()) && record.materialName?.trim() === material.name;
}

export function buildMaterialActivitySummary(
  material: StudyMaterial,
  plans: Plan[],
  actuals: Actual[],
  today: string,
): MaterialActivitySummary {
  const materialActuals = actuals
    .filter((actual) => isRecordForMaterial(actual, material))
    .slice()
    .sort(
      (left, right) =>
        right.occurrenceDate.localeCompare(left.occurrenceDate) ||
        right.actualStartTime.localeCompare(left.actualStartTime),
    );
  const materialPlans = plans
    .filter((plan) => isRecordForMaterial(plan, material))
    .slice()
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
    );
  const actualMinutes = materialActuals.reduce(
    (sum, actual) =>
      sum + Math.max(0, getEntryDurationMinutes(actual.actualStartTime, actual.actualEndTime)),
    0,
  );
  const plannedMinutes = materialPlans.reduce(
    (sum, plan) => sum + Math.max(0, getEntryDurationMinutes(plan.startTime, plan.endTime)),
    0,
  );

  return {
    actuals: materialActuals,
    plans: materialPlans,
    recentActuals: materialActuals.slice(0, 5),
    upcomingPlans: materialPlans.filter((plan) => plan.date >= today).slice(0, 5),
    actualMinutes,
    plannedMinutes,
    sessionCount: materialActuals.length,
    lastStudyDate: materialActuals[0]?.occurrenceDate ?? null,
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function getStructureItemProgress(
  item: MaterialStructureItem,
  currentUnit?: number,
): number {
  if (typeof item.progressRate === 'number' && Number.isFinite(item.progressRate)) {
    return clampPercent(item.progressRate);
  }

  if (
    typeof currentUnit === 'number' &&
    Number.isFinite(currentUnit) &&
    typeof item.startUnit === 'number' &&
    Number.isFinite(item.startUnit) &&
    typeof item.endUnit === 'number' &&
    Number.isFinite(item.endUnit) &&
    item.endUnit >= item.startUnit
  ) {
    if (currentUnit < item.startUnit) {
      return 0;
    }
    if (currentUnit >= item.endUnit) {
      return 100;
    }

    const span = Math.max(1, item.endUnit - item.startUnit);
    return clampPercent(((currentUnit - item.startUnit) / span) * 100);
  }

  if (item.children?.length) {
    const childProgress = item.children.map((child) =>
      getStructureItemProgress(child, currentUnit),
    );
    return childProgress.reduce((sum, value) => sum + value, 0) / childProgress.length;
  }

  return 0;
}

export function getCurrentStructureItem(
  items: MaterialStructureItem[],
  currentUnit?: number,
): MaterialStructureItem | null {
  for (const item of items) {
    const progress = getStructureItemProgress(item, currentUnit);
    if (progress < 100) {
      if (item.children?.length) {
        return getCurrentStructureItem(item.children, currentUnit) ?? item;
      }
      return item;
    }
  }

  return items.length > 0 ? items[items.length - 1] : null;
}
