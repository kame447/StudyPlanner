import { getMaterialUnitLabel } from '../../../lib/materialPace';
import type {
  StudyMaterial,
  StudyMaterialProgressUnit,
} from '../../../types/domain';

const MAX_REGISTERED_MATERIALS = 120;
const registeredMaterialsByOwner = new Map<string, StudyMaterial[]>();

export interface WeeklyPlanningRegisteredMaterialSummaryV5 {
  publicId: string;
  name: string;
  aliases: string[];
  progressUnit: StudyMaterialProgressUnit | null;
  progressUnitLabel: string | null;
  totalUnits: number | null;
  currentUnit: number | null;
  estimatedMinutesPerUnit: number | null;
  targetDate: string | null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function normalizeWeeklyPlanningMaterialIdentityV5(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[\s\-‐‑‒–—―・･:：,，.．!！?？'"「」『』（）()【】\[\]]+/g, '');
}

export function setWeeklyPlanningRegisteredMaterialRuntimeV5(params: {
  ownerId: string;
  materials: readonly StudyMaterial[];
}): void {
  registeredMaterialsByOwner.set(
    params.ownerId,
    params.materials
      .filter((material) =>
        material.userId === params.ownerId && material.status !== 'archived')
      .slice(0, MAX_REGISTERED_MATERIALS)
      .map((material) => ({
        ...material,
        aliases: material.aliases ? [...material.aliases] : undefined,
      })),
  );
}

export function clearWeeklyPlanningRegisteredMaterialRuntimeV5(ownerId: string): void {
  registeredMaterialsByOwner.delete(ownerId);
}

export function getWeeklyPlanningRegisteredMaterialsV5(ownerId: string): StudyMaterial[] {
  return (registeredMaterialsByOwner.get(ownerId) ?? []).map((material) => ({
    ...material,
    aliases: material.aliases ? [...material.aliases] : undefined,
  }));
}

export function createWeeklyPlanningRegisteredMaterialSummariesV5(
  materials: readonly StudyMaterial[],
): WeeklyPlanningRegisteredMaterialSummaryV5[] {
  return materials.slice(0, MAX_REGISTERED_MATERIALS).map((material) => ({
    publicId: material.id,
    name: material.name,
    aliases: (material.aliases ?? []).filter(Boolean),
    progressUnit: material.progressUnit ?? null,
    progressUnitLabel: material.progressUnit === 'custom'
      ? material.progressUnitLabel?.trim() || null
      : getMaterialUnitLabel(material),
    totalUnits: finitePositive(material.totalUnits),
    currentUnit: finiteNonNegative(material.currentUnit),
    estimatedMinutesPerUnit: finitePositive(material.estimatedMinutesPerUnit),
    targetDate: material.targetDate?.trim() || null,
  }));
}

export function getWeeklyPlanningRegisteredMaterialSummariesV5(
  ownerId: string,
): WeeklyPlanningRegisteredMaterialSummaryV5[] {
  return createWeeklyPlanningRegisteredMaterialSummariesV5(
    getWeeklyPlanningRegisteredMaterialsV5(ownerId),
  );
}

function defaultUnitLabel(unit: StudyMaterialProgressUnit | null): string {
  switch (unit) {
    case 'page':
      return 'ページ';
    case 'problem':
      return '問';
    case 'section':
      return '章';
    case 'video':
      return '本';
    case 'word':
      return '語';
    default:
      return '単位';
  }
}

export function findRegisteredStudyMaterialForLabelV5(params: {
  label: string;
  materials: readonly WeeklyPlanningRegisteredMaterialSummaryV5[];
}): WeeklyPlanningRegisteredMaterialSummaryV5 | null {
  const normalizedLabel = normalizeWeeklyPlanningMaterialIdentityV5(params.label);
  if (!normalizedLabel) return null;
  const matches = params.materials.filter((material) => {
    const identities = [material.name, ...material.aliases]
      .map(normalizeWeeklyPlanningMaterialIdentityV5)
      .filter(Boolean);
    return identities.includes(normalizedLabel);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function registeredMaterialProgressQuestionV5(params: {
  label: string;
  materials: readonly WeeklyPlanningRegisteredMaterialSummaryV5[];
}): string | null {
  const material = findRegisteredStudyMaterialForLabelV5(params);
  if (!material) return null;
  const unitLabel = material.progressUnitLabel?.trim()
    || defaultUnitLabel(material.progressUnit);

  if (material.totalUnits !== null && material.currentUnit !== null) {
    return `「${params.label}」は全${material.totalUnits}${unitLabel}・現在${material.currentUnit}${unitLabel}までで登録されています。今回は続きから進めますか、それとも最初からやり直しますか？`;
  }
  if (material.totalUnits !== null) {
    return `「${params.label}」は全${material.totalUnits}${unitLabel}で登録されています。今どこまで終わっていますか？`;
  }
  if (material.currentUnit !== null) {
    return `「${params.label}」は今${material.currentUnit}${unitLabel}まで進んでいます。全部で何${unitLabel}くらいありますか？`;
  }

  switch (material.progressUnit) {
    case 'problem':
      return `「${params.label}」って、全部で何問くらいあって、今何問くらい終わっていますか？`;
    case 'word':
      return `「${params.label}」って、全部で何語くらいあって、今何語くらいまで確認できていますか？`;
    case 'section':
      return `「${params.label}」って、全部で何章くらいあって、今どこまで終わっていますか？`;
    case 'video':
      return `「${params.label}」って、全部で何本くらいあって、今何本くらい見終わっていますか？`;
    case 'custom':
      return `「${params.label}」って、全部で何${unitLabel}くらいあって、今どこまで終わっていますか？`;
    case 'page':
    default:
      return `「${params.label}」って、全部で何ページくらいあって、今何ページくらいまで終わっていますか？`;
  }
}

export function resetWeeklyPlanningRegisteredMaterialRuntimeForTestV5(): void {
  registeredMaterialsByOwner.clear();
}
