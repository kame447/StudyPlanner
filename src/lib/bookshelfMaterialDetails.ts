import { minutesBetween } from './date';
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

const STORAGE_PREFIX = 'studyplanner:material-detail:v1';

function getStorageKey(userId: string, materialId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${materialId}`;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStructureItem(value: unknown): MaterialStructureItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<MaterialStructureItem>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const title = typeof source.title === 'string' ? source.title.trim() : '';

  if (!id || !title) {
    return null;
  }

  const children = Array.isArray(source.children)
    ? source.children
        .map(normalizeStructureItem)
        .filter((item): item is MaterialStructureItem => item !== null)
    : undefined;

  return {
    id,
    title,
    startUnit: normalizeNumber(source.startUnit),
    endUnit: normalizeNumber(source.endUnit),
    progressRate: normalizeNumber(source.progressRate),
    ...(children && children.length > 0 ? { children } : {}),
  };
}

export function getDefaultMaterialDetailPreferences(): MaterialDetailPreferences {
  return {
    structureEnabled: false,
    structureVisible: true,
    favorite: false,
    structureItems: [],
  };
}

export function loadMaterialDetailPreferences(
  userId: string,
  materialId: string,
): MaterialDetailPreferences {
  if (typeof window === 'undefined' || !window.localStorage) {
    return getDefaultMaterialDetailPreferences();
  }

  try {
    const stored = window.localStorage.getItem(getStorageKey(userId, materialId));
    if (!stored) {
      return getDefaultMaterialDetailPreferences();
    }

    const parsed = JSON.parse(stored) as Partial<MaterialDetailPreferences>;
    const structureItems = Array.isArray(parsed.structureItems)
      ? parsed.structureItems
          .map(normalizeStructureItem)
          .filter((item): item is MaterialStructureItem => item !== null)
      : [];

    return {
      structureEnabled: parsed.structureEnabled === true,
      structureVisible: parsed.structureVisible !== false,
      favorite: parsed.favorite === true,
      structureItems,
    };
  } catch {
    return getDefaultMaterialDetailPreferences();
  }
}

export function saveMaterialDetailPreferences(
  userId: string,
  materialId: string,
  preferences: MaterialDetailPreferences,
): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      getStorageKey(userId, materialId),
      JSON.stringify(preferences),
    );
  } catch {
    // UI preferences are non-critical. Persistence failure must not block the bookshelf.
  }
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
      sum + Math.max(0, minutesBetween(actual.actualStartTime, actual.actualEndTime)),
    0,
  );
  const plannedMinutes = materialPlans.reduce(
    (sum, plan) => sum + Math.max(0, minutesBetween(plan.startTime, plan.endTime)),
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
