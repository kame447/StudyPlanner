import type { StudyMaterial, StudySubject } from '../types/domain';

export function getActiveStudyMaterials(
  materials: StudyMaterial[],
  userId: string,
): StudyMaterial[] {
  return materials.filter(
    (material) => material.userId === userId && material.status !== 'archived',
  );
}

export function buildSubjectsWithMaterialFallback({
  subjects,
  activeMaterials,
  userId,
  fallbackColor,
}: {
  subjects: StudySubject[];
  activeMaterials: StudyMaterial[];
  userId: string;
  fallbackColor: string;
}): StudySubject[] {
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const fallbackSubjects = new Map<string, StudySubject>();

  activeMaterials
    .filter((material) => !subjectIds.has(material.subjectId))
    .forEach((material) => {
      if (fallbackSubjects.has(material.subjectId)) {
        return;
      }

      fallbackSubjects.set(material.subjectId, {
        id: material.subjectId,
        userId,
        name: material.subjectName || '未分類',
        color: material.color || fallbackColor,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
      });
    });

  return [...subjects, ...fallbackSubjects.values()];
}

export function groupMaterialsBySubjectId(
  activeMaterials: StudyMaterial[],
): Map<string, StudyMaterial[]> {
  const grouped = new Map<string, StudyMaterial[]>();

  activeMaterials.forEach((material) => {
    const group = grouped.get(material.subjectId) ?? [];
    group.push(material);
    grouped.set(material.subjectId, group);
  });

  grouped.forEach((group) => {
    group.sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'ja') ||
        left.createdAt.localeCompare(right.createdAt),
    );
  });

  return grouped;
}
