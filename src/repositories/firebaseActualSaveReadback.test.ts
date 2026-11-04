import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vnextActualRecordId } from '../features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords';
import { ActualSaveReadbackUnknownError, type ActualSaveIntentRecord } from '../features/weeklyPlanning/vnext/weeklyPlanningVNextActualSaveReadback';
import { readAndClassifyActualSaveFromServer } from '../features/weeklyPlanning/vnext/weeklyPlanningVNextActualSaveServerReadback';

const sdk = vi.hoisted(() => ({ getDocs: vi.fn(), getDocsFromServer: vi.fn() }));
vi.mock('firebase/firestore', () => ({ ...sdk,
  collection: (_db: unknown, name: string) => ({ name }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
}));

const OWNER = 'owner-a';
const attempted: ActualSaveIntentRecord[] = ['数学', '英語', '国語', '化学', '物理', '生物'].map((subject, index) => {
  const occurrenceDate = `2026-10-${26 + index}`;
  return { id: vnextActualRecordId(OWNER, occurrenceDate, subject), occurrenceDate, subject, minutes: 30 + index * 5 };
});
const saved = (record: ActualSaveIntentRecord) => ({ id: record.id, userId: OWNER,
  occurrenceDate: record.occurrenceDate, subject: record.subject, actualDurationMinutes: record.minutes });
const db = {} as Firestore;
const authState: { currentUser: { uid: string } | null } = { currentUser: { uid: OWNER } };
const auth = authState as unknown as Auth;
const run = () => readAndClassifyActualSaveFromServer({ firestoreDb: db, firebaseAuth: auth, ownerId: OWNER, attempted });

describe('actual-save server-only readback port', () => {
  beforeEach(() => {
    vi.clearAllMocks(); authState.currentUser = { uid: OWNER };
    sdk.getDocsFromServer.mockResolvedValue({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
  });

  it.each([
    { label: 'zero', rows: [], status: 'not_saved', confirmed: 0, conflicts: 0 },
    { label: 'six', rows: attempted.map(saved), status: 'saved', confirmed: 6, conflicts: 0 },
    { label: 'partial', rows: attempted.slice(0, 3).map(saved), status: 'partial', confirmed: 3, conflicts: 0 },
    { label: 'different minutes', rows: attempted.map((record, index) => ({ ...saved(record),
      actualDurationMinutes: index === 5 ? record.minutes + 1 : record.minutes })), status: 'partial', confirmed: 5, conflicts: 1 },
  ])('classifies $label from exact owner ranges without cache reads', async ({ rows, status, confirmed, conflicts }) => {
    sdk.getDocsFromServer.mockImplementation(async (request: { source: { name: string }; constraints: Array<{ field: string; op: string; value: string }> }) => {
      expect(request.source.name).toBe('actuals');
      expect(request.constraints).toHaveLength(3);
      const [owner, lower, upper] = request.constraints;
      expect(owner).toEqual({ field: 'userId', op: '==', value: OWNER });
      expect(lower).toEqual({ field: '__name__', op: '>=', value: upper.value });
      expect(upper).toEqual({ field: '__name__', op: '<=', value: lower.value });
      const found = rows.find(row => row.id === lower.value);
      return { docs: found ? [{ id: found.id, data: () => found }] : [],
        metadata: { fromCache: false, hasPendingWrites: false } };
    });
    const result = await run();
    expect(result.status).toBe(status);
    expect(result.confirmedIds).toHaveLength(confirmed);
    expect(result.conflictingIds).toHaveLength(conflicts);
    expect(sdk.getDocsFromServer).toHaveBeenCalledTimes(6);
    expect(sdk.getDocsFromServer.mock.calls.map(([request]) => request.constraints[1].value))
      .toEqual(attempted.map(record => record.id));
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });

  it.each([
    { metadata: { fromCache: true, hasPendingWrites: false }, reason: 'unconfirmed_snapshot' },
    { metadata: { fromCache: false, hasPendingWrites: true }, reason: 'unconfirmed_snapshot' },
    { metadata: undefined, reason: 'unconfirmed_snapshot' },
  ])('keeps unconfirmed metadata unknown: $metadata', async ({ metadata, reason }) => {
    sdk.getDocsFromServer.mockResolvedValue({ docs: [], metadata });
    await expect(run()).rejects.toMatchObject({ name: 'ActualSaveReadbackUnknownError', reason });
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });

  it.each([{ code: 'unavailable', reason: 'unavailable' }, { code: 'permission-denied', reason: 'permission_denied' }])
  ('keeps $code unknown without a fallback', async ({ code, reason }) => {
    sdk.getDocsFromServer.mockRejectedValue({ code });
    await expect(run()).rejects.toMatchObject({ name: 'ActualSaveReadbackUnknownError', reason });
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });

  it('rejects missing or changed auth before accepting any server result', async () => {
    authState.currentUser = null;
    await expect(run()).rejects.toBeInstanceOf(ActualSaveReadbackUnknownError);
    expect(sdk.getDocsFromServer).not.toHaveBeenCalled();
    authState.currentUser = { uid: OWNER };
    sdk.getDocsFromServer.mockImplementation(async () => {
      authState.currentUser = { uid: 'other-owner' };
      return { docs: [], metadata: { fromCache: false, hasPendingWrites: false } };
    });
    await expect(run()).rejects.toMatchObject({ reason: 'auth_mismatch' });
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });
});
