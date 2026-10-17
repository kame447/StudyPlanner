import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

/** A search-only, non-authoritative index result from an optional Hy Memory service. */
export type HyMemoryCandidateRead =
  | { status: 'unavailable' }
  | {
      status: 'ready';
      ownerId: string;
      sourceRevision: number;
      recordIds: readonly string[];
    };

export type ResolvedHyMemoryCandidates =
  | { status: 'unavailable'; records: [] }
  | { status: 'ready'; records: UserPlanningContextRecordV1[] };

const MAX_INDEX_CANDIDATES = 64;
const MAX_SELECTED_RECORDS = 10;

/**
 * Hy Memory ranks candidate IDs, but the current canonical snapshot decides
 * which records exist and may be shown to the conversation model.
 */
export function resolveHyMemoryCandidates(params: {
  ownerId: string;
  sourceRevision: number;
  records: readonly UserPlanningContextRecordV1[];
  indexRead: HyMemoryCandidateRead;
  limit?: number;
}): ResolvedHyMemoryCandidates {
  const { ownerId, sourceRevision, records, indexRead } = params;
  if (
    indexRead.status !== 'ready'
    || indexRead.ownerId !== ownerId
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
    || indexRead.sourceRevision !== sourceRevision
    || !Array.isArray(indexRead.recordIds)
  ) {
    return { status: 'unavailable', records: [] };
  }

  const activeById = new Map(
    records
      .filter((record) => record.ownerId === ownerId && record.status === 'active')
      .map((record) => [record.id, record] as const),
  );
  const requestedLimit = params.limit ?? MAX_SELECTED_RECORDS;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(0, Math.min(requestedLimit, MAX_SELECTED_RECORDS))
    : MAX_SELECTED_RECORDS;
  const selected: UserPlanningContextRecordV1[] = [];
  const seen = new Set<string>();

  for (const id of indexRead.recordIds.slice(0, MAX_INDEX_CANDIDATES)) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const record = activeById.get(id);
    if (record) selected.push(record);
    if (selected.length >= limit) break;
  }

  return { status: 'ready', records: selected.slice(0, limit) };
}
