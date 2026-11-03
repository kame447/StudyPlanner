import { ActualSaveReadbackUnknownError, type ActualSaveServerReadback, type ConfirmedActual } from '../../../domain/actualSaveReadback';
import { vnextActualRecordId, type VNextActualRecord } from './weeklyPlanningVNextStudyRecords';

export { ActualSaveReadbackUnknownError } from '../../../domain/actualSaveReadback';
export type { ActualSaveServerReadback, ConfirmedActual } from '../../../domain/actualSaveReadback';

export type ActualSaveIntentRecord = Pick<VNextActualRecord, 'id' | 'occurrenceDate' | 'subject' | 'minutes'>;

export interface ActualSaveReadbackClassification {
  status: 'saved' | 'not_saved' | 'partial';
  confirmedIds: string[];
  /** Missing or different from the confirmed intent. Reuse these IDs only after an explicit retry decision. */
  unconfirmedRecords: ActualSaveIntentRecord[];
  /** Existing server documents with different values need review before a replacement write. */
  conflictingIds: string[];
}

function assertOwnedIntent(ownerId: string, attempted: readonly ActualSaveIntentRecord[]): void {
  if (!ownerId.trim() || attempted.length === 0) throw new Error('No owner-bound actual save intent.');
  const seen = new Set<string>();
  for (const record of attempted) {
    if (record.id !== vnextActualRecordId(ownerId, record.occurrenceDate, record.subject) || seen.has(record.id)) {
      throw new Error('Actual save intent does not belong to this owner.');
    }
    seen.add(record.id);
  }
}

/** Pure classification of a server-confirmed read; optimistic planner rows are never evidence of a save. */
export function classifyActualSaveReadback(
  ownerId: string, attempted: readonly ActualSaveIntentRecord[], serverRecords: readonly ConfirmedActual[],
): ActualSaveReadbackClassification {
  assertOwnedIntent(ownerId, attempted);
  const expected = new Set(attempted.map(record => record.id));
  const seen = new Set<string>();
  for (const record of serverRecords) {
    if (record.userId !== ownerId || !expected.has(record.id) || seen.has(record.id)) {
      throw new Error('Actual save readback is not owner-bound.');
    }
    seen.add(record.id);
  }
  const byId = new Map(serverRecords.map(record => [record.id, record]));
  const confirmedIds: string[] = [], unconfirmedRecords: ActualSaveIntentRecord[] = [], conflictingIds: string[] = [];
  for (const record of attempted) {
    const saved = byId.get(record.id);
    if (saved && saved.occurrenceDate === record.occurrenceDate && saved.subject === record.subject.trim()
      && saved.actualDurationMinutes === record.minutes) confirmedIds.push(record.id);
    else {
      unconfirmedRecords.push(record);
      if (saved) conflictingIds.push(record.id);
    }
  }
  return { status: confirmedIds.length === attempted.length ? 'saved' : serverRecords.length === 0 ? 'not_saved' : 'partial',
    confirmedIds, unconfirmedRecords, conflictingIds };
}

/** The port must make a server-only owner query; cached or pending-write snapshots cannot certify a commit. */
export async function readAndClassifyActualSave(params: {
  ownerId: string;
  attempted: readonly ActualSaveIntentRecord[];
  readConfirmed(ownerId: string, ids: readonly string[]): Promise<ActualSaveServerReadback>;
}): Promise<ActualSaveReadbackClassification> {
  assertOwnedIntent(params.ownerId, params.attempted);
  const readback = await params.readConfirmed(params.ownerId, params.attempted.map(record => record.id));
  if (readback.fromCache || readback.hasPendingWrites) throw new ActualSaveReadbackUnknownError('unconfirmed_snapshot');
  return classifyActualSaveReadback(params.ownerId, params.attempted, readback.records);
}
