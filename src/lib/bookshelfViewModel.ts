import {
  getDefaultMaterialDetailPreferences,
  isRecordForMaterial,
  type MaterialDetailPreferences,
  type MaterialStructureItem,
} from './bookshelfMaterialDetails';
import type { Actual, MaterialStudyStatus, StudyMaterial } from '../types/domain';

export function filterBookshelfMaterials({
  materials,
  activeSubjectId,
  searchQuery,
  studyStatus = 'all',
}: {
  materials: readonly StudyMaterial[];
  activeSubjectId: string;
  searchQuery: string;
  studyStatus?: MaterialStudyStatus | 'all';
}): StudyMaterial[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja');

  return materials.filter((material) => {
    if (studyStatus !== 'all' && (material.studyStatus ?? 'studying') !== studyStatus) {
      return false;
    }
    if (activeSubjectId !== 'all' && material.subjectId !== activeSubjectId) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [material.name, material.subjectName, ...(material.aliases ?? [])]
      .join(' ')
      .toLocaleLowerCase('ja')
      .includes(normalizedQuery);
  });
}

export function selectFrequentBookshelfMaterials({
  materials,
  actuals,
  preferencesByMaterialId,
}: {
  materials: readonly StudyMaterial[];
  actuals: readonly Actual[];
  preferencesByMaterialId: ReadonlyMap<string, MaterialDetailPreferences>;
}): StudyMaterial[] {
  return materials
    .slice()
    .sort((left, right) => {
      const leftPreferences =
        preferencesByMaterialId.get(left.id) ?? getDefaultMaterialDetailPreferences();
      const rightPreferences =
        preferencesByMaterialId.get(right.id) ?? getDefaultMaterialDetailPreferences();
      if (leftPreferences.favorite !== rightPreferences.favorite) {
        return leftPreferences.favorite ? -1 : 1;
      }

      const leftCount = actuals.filter((actual) => isRecordForMaterial(actual, left)).length;
      const rightCount = actuals.filter((actual) => isRecordForMaterial(actual, right)).length;
      return rightCount - leftCount || right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, 3);
}

export function selectRecentBookshelfMaterials(
  materials: readonly StudyMaterial[],
): StudyMaterial[] {
  return materials
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 3);
}

function prepareStructureItems(items: MaterialStructureItem[]): MaterialStructureItem[] {
  return items.map(item => ({
    ...item,
    title: item.title.trim(),
    ...(item.children ? { children: prepareStructureItems(item.children) } : {}),
  })).filter(item => item.title.length > 0);
}

export function prepareBookshelfStructurePreferences(
  preferences: MaterialDetailPreferences,
): MaterialDetailPreferences {
  return {
    ...preferences,
    structureVisible: preferences.structureEnabled
      ? preferences.structureVisible
      : false,
    structureItems: prepareStructureItems(preferences.structureItems),
  };
}
