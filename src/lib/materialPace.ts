import type {
  ActualMaterialProgressUpdate,
  StudyMaterial,
  StudyMaterialProgressUnit,
} from '../types/domain';

export type MaterialPaceStatus =
  | 'on-track'
  | 'completed'
  | 'no-target'
  | 'overdue'
  | 'invalid'
  | 'disabled';

export interface MaterialPaceResult {
  enabled: boolean;
  unitLabel: string;
  totalUnits: number | null;
  currentUnit: number;
  remainingUnits: number;
  targetDate: string | null;
  remainingDays: number | null;
  dailyQuota: number | null;
  suggestedDailyUnits: number | null;
  progressRate: number;
  estimatedDailyMinutes: number | null;
  status: MaterialPaceStatus;
}

export interface MaterialProgressDraftInput {
  materials: StudyMaterial[];
  materialId?: string | null;
  deltaUnitsInput?: string;
  toUnitInput?: string;
}

const UNIT_LABELS: Record<StudyMaterialProgressUnit, string> = {
  page: 'ページ',
  problem: '問',
  section: '章',
  video: '本',
  word: '語',
  custom: '単位',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeUnitCount(value: unknown): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return Math.max(0, value);
}

function normalizeProgressValue(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) {
    return undefined;
  }

  return value;
}

function parsePositiveProgressInput(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : undefined;
}

function clampUnit(value: number, totalUnits?: number): number {
  const lowerBounded = Math.max(0, value);

  return isFiniteNumber(totalUnits)
    ? Math.min(lowerBounded, Math.max(0, totalUnits))
    : lowerBounded;
}

function toLocalDate(dateString: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return null;
  }

  const date = new Date(`${dateString}T00:00:00`);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getMaterialUnitLabel(material: Pick<
  StudyMaterial,
  'progressUnit' | 'progressUnitLabel'
>): string {
  if (material.progressUnit === 'custom') {
    return material.progressUnitLabel?.trim() || UNIT_LABELS.custom;
  }

  return UNIT_LABELS[material.progressUnit ?? 'page'];
}

export function getRemainingUnits(material: Pick<
  StudyMaterial,
  'totalUnits' | 'currentUnit'
>): number | null {
  const totalUnits = normalizeUnitCount(material.totalUnits);

  if (totalUnits === null) {
    return null;
  }

  const currentUnit = normalizeUnitCount(material.currentUnit) ?? 0;
  return Math.max(totalUnits - currentUnit, 0);
}

export function getRemainingDays(
  today: string,
  targetDate: string | null | undefined,
): number | null {
  if (!targetDate) {
    return null;
  }

  const todayDate = toLocalDate(today);
  const target = toLocalDate(targetDate);

  if (!todayDate || !target) {
    return null;
  }

  const diffMs = target.getTime() - todayDate.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  return diffDays >= 0 ? diffDays + 1 : 0;
}

export function calculateDailyQuota(
  material: StudyMaterial,
  today: string,
): number | null {
  if (material.paceEnabled !== true) {
    return null;
  }

  const remainingUnits = getRemainingUnits(material);
  const remainingDays = getRemainingDays(today, material.targetDate);

  if (remainingUnits === null || remainingDays === null || remainingDays <= 0) {
    return null;
  }

  return remainingUnits / remainingDays;
}

export function calculateMaterialPace(
  material: StudyMaterial,
  today: string,
): MaterialPaceResult {
  const unitLabel = getMaterialUnitLabel(material);
  const totalUnits = normalizeUnitCount(material.totalUnits);
  const rawCurrentUnit = normalizeUnitCount(material.currentUnit) ?? 0;
  const currentUnit =
    totalUnits === null ? rawCurrentUnit : Math.min(rawCurrentUnit, totalUnits);
  const remainingUnits =
    totalUnits === null ? 0 : Math.max(totalUnits - currentUnit, 0);
  const targetDate = material.targetDate?.trim() || null;
  const remainingDays = getRemainingDays(today, targetDate);
  const progressRate =
    totalUnits && totalUnits > 0
      ? Math.min(100, Math.max(0, (currentUnit / totalUnits) * 100))
      : 0;

  if (material.paceEnabled !== true) {
    return {
      enabled: false,
      unitLabel,
      totalUnits,
      currentUnit,
      remainingUnits,
      targetDate,
      remainingDays,
      dailyQuota: null,
      suggestedDailyUnits: null,
      progressRate,
      estimatedDailyMinutes: null,
      status: 'disabled',
    };
  }

  if (totalUnits === null) {
    return {
      enabled: true,
      unitLabel,
      totalUnits,
      currentUnit,
      remainingUnits,
      targetDate,
      remainingDays,
      dailyQuota: null,
      suggestedDailyUnits: null,
      progressRate,
      estimatedDailyMinutes: null,
      status: 'invalid',
    };
  }

  if (remainingUnits <= 0) {
    return {
      enabled: true,
      unitLabel,
      totalUnits,
      currentUnit,
      remainingUnits,
      targetDate,
      remainingDays,
      dailyQuota: 0,
      suggestedDailyUnits: 0,
      progressRate: 100,
      estimatedDailyMinutes: 0,
      status: 'completed',
    };
  }

  if (!targetDate) {
    return {
      enabled: true,
      unitLabel,
      totalUnits,
      currentUnit,
      remainingUnits,
      targetDate,
      remainingDays,
      dailyQuota: null,
      suggestedDailyUnits: null,
      progressRate,
      estimatedDailyMinutes: null,
      status: 'no-target',
    };
  }

  if (remainingDays === null || remainingDays <= 0) {
    return {
      enabled: true,
      unitLabel,
      totalUnits,
      currentUnit,
      remainingUnits,
      targetDate,
      remainingDays,
      dailyQuota: null,
      suggestedDailyUnits: null,
      progressRate,
      estimatedDailyMinutes: null,
      status: 'overdue',
    };
  }

  const dailyQuota = remainingUnits / remainingDays;
  const suggestedDailyUnits = Math.ceil(dailyQuota);
  const estimatedMinutesPerUnit = normalizeUnitCount(
    material.estimatedMinutesPerUnit,
  );

  return {
    enabled: true,
    unitLabel,
    totalUnits,
    currentUnit,
    remainingUnits,
    targetDate,
    remainingDays,
    dailyQuota,
    suggestedDailyUnits,
    progressRate,
    estimatedDailyMinutes:
      estimatedMinutesPerUnit === null
        ? null
        : Math.ceil(suggestedDailyUnits * estimatedMinutesPerUnit),
    status: 'on-track',
  };
}

export function normalizeMaterialProgressUpdate(
  update: ActualMaterialProgressUpdate,
  material: StudyMaterial,
): ActualMaterialProgressUpdate | null {
  if (!update.materialId || update.materialId !== material.id) {
    return null;
  }

  const fromUnit = normalizeProgressValue(update.fromUnit);
  const toUnit = normalizeProgressValue(update.toUnit);
  const deltaUnits = normalizeProgressValue(update.deltaUnits);

  if (toUnit === undefined && deltaUnits === undefined) {
    return null;
  }

  return {
    materialId: material.id,
    progressUnit: update.progressUnit ?? material.progressUnit,
    progressUnitLabel:
      update.progressUnit === 'custom' || material.progressUnit === 'custom'
        ? update.progressUnitLabel ?? material.progressUnitLabel
        : undefined,
    fromUnit,
    toUnit,
    deltaUnits,
  };
}

export function buildActualMaterialProgressUpdatesFromInput({
  materials,
  materialId,
  deltaUnitsInput,
  toUnitInput,
}: MaterialProgressDraftInput): ActualMaterialProgressUpdate[] | undefined {
  if (!materialId) {
    return undefined;
  }

  const material = materials.find(
    (item) => item.id === materialId && item.paceEnabled === true,
  );

  if (!material) {
    return undefined;
  }

  const deltaUnits = parsePositiveProgressInput(deltaUnitsInput);
  const toUnit = parsePositiveProgressInput(toUnitInput);

  if (deltaUnits === undefined && toUnit === undefined) {
    return undefined;
  }

  return [
    {
      materialId: material.id,
      progressUnit: material.progressUnit,
      progressUnitLabel:
        material.progressUnit === 'custom'
          ? material.progressUnitLabel
          : undefined,
      fromUnit: normalizeUnitCount(material.currentUnit) ?? 0,
      toUnit,
      deltaUnits,
    },
  ];
}

export function calculateNextMaterialUnit(
  material: StudyMaterial,
  update: ActualMaterialProgressUpdate,
): number | null {
  if (material.paceEnabled !== true || update.materialId !== material.id) {
    return null;
  }

  const normalizedUpdate = normalizeMaterialProgressUpdate(update, material);

  if (!normalizedUpdate) {
    return null;
  }

  const currentUnit = normalizeUnitCount(material.currentUnit) ?? 0;
  const totalUnits = normalizeUnitCount(material.totalUnits) ?? undefined;
  const nextUnit =
    normalizedUpdate.toUnit !== undefined
      ? normalizedUpdate.toUnit
      : currentUnit + (normalizedUpdate.deltaUnits ?? 0);

  return clampUnit(nextUnit, totalUnits);
}

export function applyMaterialProgressUpdate(
  material: StudyMaterial,
  update: ActualMaterialProgressUpdate,
): StudyMaterial {
  const nextCurrentUnit = calculateNextMaterialUnit(material, update);

  if (nextCurrentUnit === null) {
    return material;
  }

  return {
    ...material,
    currentUnit: nextCurrentUnit,
    updatedAt: new Date().toISOString(),
  };
}

export function applyMaterialProgressUpdates(
  materials: StudyMaterial[],
  updates: ActualMaterialProgressUpdate[] | null | undefined,
): StudyMaterial[] {
  if (!updates || updates.length === 0) {
    return materials;
  }

  return materials.map((material) =>
    updates.reduce(
      (currentMaterial, update) =>
        applyMaterialProgressUpdate(currentMaterial, update),
      material,
    ),
  );
}
