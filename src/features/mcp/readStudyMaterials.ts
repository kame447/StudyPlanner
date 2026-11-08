import type { MaterialStudyStatus, StudyMaterial, StudyMaterialProgressUnit, StudyMaterialStatus } from '../../types/domain';

/**
 * Rows one port call may return. The server-side query stops here without saying so, so a result this large cannot be
 * told apart from a cut-off one and is refused rather than returned as if complete (same limit as the todo reader).
 */
export const STUDY_MATERIAL_PORT_ROW_LIMIT = 500;

/**
 * Read port for one owner's study materials. An implementation must filter by an equality on `userId` in the query itself
 * (never read the whole collection), and must not trigger migration or any write. It is not composed anywhere yet.
 */
export interface StudyMaterialReadPort { listMaterialsByOwner(ownerId: string): Promise<StudyMaterial[]> }

/** Minimal fields only. Cover images, catalog data, aliases, color, `userId` and timestamps are deliberately not returned. */
export interface StudyMaterialListItem {
  id: string; name: string; subjectName: string; status: StudyMaterialStatus; studyStatus: MaterialStudyStatus;
}
export interface StudyMaterialListResult { materials: StudyMaterialListItem[] }
export type ListStudyMaterials = (actorOwnerId: string, input: unknown) => Promise<StudyMaterialListResult>;

/** Only active materials whose pace is enabled carry progress; archived ones are left out. The pace tuning values are not returned. */
export interface LearningProgressItem {
  id: string; name: string; progressUnit: StudyMaterialProgressUnit | null; progressUnitLabel: string | null;
  currentUnit: number | null; totalUnits: number | null; targetDate: string | null;
}
export interface LearningProgressResult { materials: LearningProgressItem[] }
export type ReadLearningProgress = (actorOwnerId: string, input: unknown) => Promise<LearningProgressResult>;

export class StudyMaterialReadError extends Error {
  constructor(readonly code: 'owner_mismatch' | 'invalid_input' | 'source_unavailable') {
    super(code);
    this.name = 'StudyMaterialReadError';
  }
}

/** The owner comes only from the authenticated actor; the same checks, in the same order, for both readers. */
async function readOwnerMaterials(source: { ownerId: string; port: StudyMaterialReadPort }, actorOwnerId: string, input: unknown) {
  if (!actorOwnerId || actorOwnerId !== source.ownerId) throw new StudyMaterialReadError('owner_mismatch');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 0) throw new StudyMaterialReadError('invalid_input');
  let records: StudyMaterial[];
  try { records = await source.port.listMaterialsByOwner(actorOwnerId); }
  catch { throw new StudyMaterialReadError('source_unavailable'); }
  if (records.length >= STUDY_MATERIAL_PORT_ROW_LIMIT) throw new StudyMaterialReadError('source_unavailable');
  // Repository identity is a trust boundary: reject the whole result rather than omit foreign records.
  if (records.some(record => record.userId !== actorOwnerId)) throw new StudyMaterialReadError('owner_mismatch');
  return [...records].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function createStudyMaterialLister(source: { ownerId: string; port: StudyMaterialReadPort }): ListStudyMaterials {
  return async (actorOwnerId, input) => ({
    materials: (await readOwnerMaterials(source, actorOwnerId, input)).map(record => ({
      id: record.id, name: record.name, subjectName: record.subjectName,
      status: record.status ?? 'active', studyStatus: record.studyStatus ?? 'studying' })),
  });
}

export function createLearningProgressReader(source: { ownerId: string; port: StudyMaterialReadPort }): ReadLearningProgress {
  return async (actorOwnerId, input) => ({
    materials: (await readOwnerMaterials(source, actorOwnerId, input)).filter(record => record.paceEnabled === true && record.status !== 'archived').map(record => ({
      id: record.id, name: record.name, progressUnit: record.progressUnit ?? null, progressUnitLabel: record.progressUnitLabel ?? null,
      currentUnit: record.currentUnit ?? null, totalUnits: record.totalUnits ?? null, targetDate: record.targetDate ?? null })),
  });
}
