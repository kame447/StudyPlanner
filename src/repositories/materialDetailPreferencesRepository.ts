import {
  getDefaultMaterialDetailPreferences,
  type MaterialDetailPreferences,
  type MaterialStructureItem,
} from '../lib/bookshelfMaterialDetails';

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
): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const storage = window.localStorage;
    if (!storage) return false;
    storage.setItem(
      getStorageKey(userId, materialId),
      JSON.stringify(preferences),
    );
    return true;
  } catch {
    return false;
  }
}
