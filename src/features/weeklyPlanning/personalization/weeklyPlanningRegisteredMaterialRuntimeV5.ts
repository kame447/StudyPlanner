import type { StudyMaterial } from '../../../types/domain';

export const WEEKLY_PLANNING_REGISTERED_MATERIAL_CONTEXT_LIMIT_V5 = 12;
const REGISTERED_MATERIAL_ALIAS_LIMIT_V5 = 8;

export interface WeeklyPlanningRegisteredMaterialContextV5 {
  materialId: string;
  name: string;
  subjectName: string;
  catalogEntryId: string | null;
  catalogTitle: string | null;
  isbn10: string | null;
  isbn13: string | null;
  aliases: string[];
  paceEnabled: boolean;
  progressUnit: StudyMaterial['progressUnit'] | null;
  progressUnitLabel: string | null;
  totalUnits: number | null;
  currentUnit: number | null;
  remainingUnits: number | null;
  targetDate: string | null;
  estimatedMinutesPerUnit: number | null;
  maxUnitsPerDay: number | null;
}

interface RegisteredMaterialRuntimeEntryV5 {
  context: WeeklyPlanningRegisteredMaterialContextV5;
  matchTerms: string[];
  updatedAt: string;
}

const runtimeMaterials = new Map<string, RegisteredMaterialRuntimeEntryV5[]>();

function normalizedLookupText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u3000\-_・･.,，。:：/／\\()（）\[\]［］「」『』【】]/g, '');
}

function nullableFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uniqueAliases(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values ?? []) {
    const alias = value.trim();
    const normalized = normalizedLookupText(alias);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(alias);
    if (aliases.length >= REGISTERED_MATERIAL_ALIAS_LIMIT_V5) break;
  }
  return aliases;
}

function createEntry(material: StudyMaterial): RegisteredMaterialRuntimeEntryV5 | null {
  if (material.status === 'archived') return null;
  const name = material.name.trim();
  if (!name) return null;
  const aliases = uniqueAliases(material.aliases);
  const totalUnits = nullableFiniteNumber(material.totalUnits);
  const currentUnit = nullableFiniteNumber(material.currentUnit);
  const remainingUnits = totalUnits !== null && currentUnit !== null
    ? Math.max(0, totalUnits - currentUnit)
    : null;
  const matchTerms = [name, material.catalogTitle ?? '', ...aliases]
    .map(normalizedLookupText)
    .filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index);

  return {
    updatedAt: material.updatedAt,
    matchTerms,
    context: {
      materialId: material.id,
      name,
      subjectName: material.subjectName.trim(),
      catalogEntryId: material.catalogEntryId?.trim() || null,
      catalogTitle: material.catalogTitle?.trim() || null,
      isbn10: material.catalogIsbn10?.trim() || null,
      isbn13: material.catalogIsbn13?.trim() || null,
      aliases,
      paceEnabled: material.paceEnabled === true,
      progressUnit: material.progressUnit ?? null,
      progressUnitLabel: material.progressUnitLabel?.trim() || null,
      totalUnits,
      currentUnit,
      remainingUnits,
      targetDate: material.targetDate?.trim() || null,
      estimatedMinutesPerUnit: nullableFiniteNumber(material.estimatedMinutesPerUnit),
      maxUnitsPerDay: nullableFiniteNumber(material.maxUnitsPerDay),
    },
  };
}

export function setWeeklyPlanningRegisteredMaterialRuntimeV5(params: {
  ownerId: string;
  materials: readonly StudyMaterial[];
}): void {
  const ownerId = params.ownerId.trim();
  if (!ownerId) return;
  const entries = params.materials
    .map(createEntry)
    .filter((entry): entry is RegisteredMaterialRuntimeEntryV5 => entry !== null);
  runtimeMaterials.set(ownerId, entries);
}

export function getWeeklyPlanningRegisteredMaterialContextV5(params: {
  ownerId: string;
  userText?: string;
  limit?: number;
}): WeeklyPlanningRegisteredMaterialContextV5[] {
  const ownerId = params.ownerId.trim();
  if (!ownerId) return [];
  const query = normalizedLookupText(params.userText);
  const limit = Math.max(
    0,
    Math.min(
      Math.floor(params.limit ?? WEEKLY_PLANNING_REGISTERED_MATERIAL_CONTEXT_LIMIT_V5),
      WEEKLY_PLANNING_REGISTERED_MATERIAL_CONTEXT_LIMIT_V5,
    ),
  );
  if (limit === 0) return [];

  return (runtimeMaterials.get(ownerId) ?? [])
    .slice()
    .sort((left, right) => {
      const leftMatched = Boolean(query) && left.matchTerms.some((term) => query.includes(term));
      const rightMatched = Boolean(query) && right.matchTerms.some((term) => query.includes(term));
      if (leftMatched !== rightMatched) return leftMatched ? -1 : 1;
      return (
        right.updatedAt.localeCompare(left.updatedAt)
        || left.context.name.localeCompare(right.context.name, 'ja')
      );
    })
    .slice(0, limit)
    .map((entry) => structuredClone(entry.context));
}

export function clearWeeklyPlanningRegisteredMaterialRuntimeV5(ownerId: string): void {
  runtimeMaterials.delete(ownerId.trim());
}
