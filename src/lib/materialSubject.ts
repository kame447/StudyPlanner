import type { StudyMaterial, StudySubject } from '../types/domain';

const NON_SUBJECT_LABELS = new Set(['予定', '記録']);

export function resolveMaterialSubjectName(
  material: StudyMaterial | null | undefined,
  subjects: StudySubject[],
): string {
  if (!material) {
    return '';
  }

  const subjectNameById =
    subjects.find((subject) => subject.id === material.subjectId)?.name.trim() ?? '';

  if (subjectNameById && !NON_SUBJECT_LABELS.has(subjectNameById)) {
    return subjectNameById;
  }

  const materialSubjectName = material.subjectName.trim();

  return NON_SUBJECT_LABELS.has(materialSubjectName) ? '' : materialSubjectName;
}
