import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadUserPlanningContextSnapshotV1 } from './userPlanningContextSpace';
import { createEmptyUserPlanningContextSnapshotV1 } from './userPlanningContextTypes';

const ownerId = 'owner-a';
const otherOwnerId = 'owner-b';
const ownerKey = `studyplanner.userPlanningContext.${ownerId}`;
const otherOwnerKey = `studyplanner.userPlanningContext.${otherOwnerId}`;
const currentDate = '2026-11-05';

function useFakeStorage(initialValues: [string, string][]) {
  const values = new Map(initialValues);
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  const removeItem = vi.fn((key: string) => { values.delete(key); });
  vi.stubGlobal('window', { localStorage: { getItem, setItem, removeItem } });
  return { values, getItem, setItem, removeItem };
}

afterEach(() => vi.unstubAllGlobals());

describe('user planning context storage reads', () => {
  it('retains malformed owner bytes without removing them', () => {
    const malformed = '{"records": [不正な JSON';
    const otherRaw = JSON.stringify(createEmptyUserPlanningContextSnapshotV1(otherOwnerId));
    const storage = useFakeStorage([[ownerKey, malformed], [otherOwnerKey, otherRaw]]);

    loadUserPlanningContextSnapshotV1({ ownerId, currentDate });

    expect(storage.getItem).toHaveBeenCalledWith(ownerKey);
    expect.soft(storage.values.get(ownerKey)).toBe(malformed);
    expect.soft(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.values.get(otherOwnerKey)).toBe(otherRaw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('reads a valid snapshot while preserving both owner keys', () => {
    const snapshot = {
      ...createEmptyUserPlanningContextSnapshotV1(ownerId),
      records: [{
        id: 'record-1', ownerId, kind: 'concern' as const, label: '数学', value: '苦手',
        dateExpression: null, observedDate: currentDate, resolvedDate: null,
        sourceText: '数学が苦手です', sourceConversationId: 'conversation-1',
        sourceTurnId: 'turn-1', recordedAt: '2026-11-05T00:00:00.000Z',
        status: 'active' as const, origin: 'user_stated' as const,
      }],
    };
    const raw = JSON.stringify(snapshot);
    const otherRaw = JSON.stringify(createEmptyUserPlanningContextSnapshotV1(otherOwnerId));
    const storage = useFakeStorage([[ownerKey, raw], [otherOwnerKey, otherRaw]]);

    expect(loadUserPlanningContextSnapshotV1({ ownerId, currentDate })).toEqual(snapshot);
    expect(storage.values.get(ownerKey)).toBe(raw);
    expect(storage.values.get(otherOwnerKey)).toBe(otherRaw);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
