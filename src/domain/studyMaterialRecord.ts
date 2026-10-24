import type { StudyMaterial, StudyMaterialDraft, StudySubject } from '../types/domain';

/** Prepare a record from already-admitted inputs; no IDs, clocks or writes here. */
export function prepareStudyMaterialRecord({
  draft, subject, currentMaterial, userId, materialId, name, now,
}: {
  draft: StudyMaterialDraft;
  subject: StudySubject;
  currentMaterial: StudyMaterial | undefined;
  userId: string;
  materialId: string;
  name: string;
  now: string;
}): StudyMaterial {
  const paceEnabled = draft.paceEnabled === true;
  const totalUnits =
    typeof draft.totalUnits === 'number' && Number.isFinite(draft.totalUnits)
      ? Math.max(0, draft.totalUnits)
      : undefined;
  const currentUnit =
    typeof draft.currentUnit === 'number' && Number.isFinite(draft.currentUnit)
      ? Math.min(Math.max(0, draft.currentUnit), totalUnits ?? draft.currentUnit)
      : undefined;
  const estimatedMinutesPerUnit =
    typeof draft.estimatedMinutesPerUnit === 'number' &&
    Number.isFinite(draft.estimatedMinutesPerUnit)
      ? Math.max(0, draft.estimatedMinutesPerUnit)
      : undefined;
  const maxUnitsPerDay =
    typeof draft.maxUnitsPerDay === 'number' && Number.isFinite(draft.maxUnitsPerDay)
      ? Math.max(0, draft.maxUnitsPerDay)
      : undefined;
  return {
    id: materialId,
    userId,
    name,
    subjectId: subject.id,
    subjectName: subject.name,
    color: draft.color ?? subject.color,
    coverImageUrl: draft.coverImageUrl || undefined,
    coverImageDataUrl: draft.coverImageDataUrl || undefined,
    catalogEntryId: draft.catalogEntryId?.trim() || currentMaterial?.catalogEntryId,
    catalogTitle: draft.catalogTitle?.trim() || currentMaterial?.catalogTitle,
    catalogIsbn10: draft.catalogIsbn10?.trim() || currentMaterial?.catalogIsbn10,
    catalogIsbn13: draft.catalogIsbn13?.trim() || currentMaterial?.catalogIsbn13,
    aliases: draft.aliases ?? currentMaterial?.aliases ?? [],
    status: draft.status ?? currentMaterial?.status ?? 'active',
    studyStatus: draft.studyStatus ?? currentMaterial?.studyStatus ?? 'studying',
    paceEnabled,
    progressUnit: draft.progressUnit ?? currentMaterial?.progressUnit ?? 'page',
    progressUnitLabel:
      draft.progressUnit === 'custom'
        ? draft.progressUnitLabel?.trim() || undefined
        : undefined,
    totalUnits,
    currentUnit,
    targetDate: draft.targetDate?.trim() || undefined,
    estimatedMinutesPerUnit,
    maxUnitsPerDay,
    createdAt: currentMaterial?.createdAt ?? now,
    updatedAt: now,
  };
}
