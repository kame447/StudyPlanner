import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearUserPlanningContextForOwnerV1,
  finalizeStagedUserPlanningContextV1,
  loadUserPlanningContextSnapshotV1,
  resetUserPlanningContextRuntimeForTestV1,
  stageUserPlanningContextFactsV1,
} from './userPlanningContextSpace';
import { createEmptyUserPlanningContextSnapshotV1, type UserPlanningContextRecordV1 } from './userPlanningContextTypes';

const date = '2026-11-05';
const now = '2026-11-05T03:00:00.000Z';
const key = (owner: string) => `studyplanner.userPlanningContext.${owner}`;

function record(ownerId: string, status: UserPlanningContextRecordV1['status'] = 'active'): UserPlanningContextRecordV1 {
  return { id: `${ownerId}-record`, ownerId, kind: 'concern', label: '数学', value: '苦手',
    dateExpression: null, observedDate: date, resolvedDate: null, sourceText: '数学が苦手です',
    sourceConversationId: 'old-conversation', sourceTurnId: 'old-turn',
    recordedAt: '2026-11-04T00:00:00.000Z', status, origin: 'user_stated' };
}

function rawSnapshot(owner: string, status: UserPlanningContextRecordV1['status'] = 'active') {
  return JSON.stringify({ ...createEmptyUserPlanningContextSnapshotV1(owner), records: [record(owner, status)] });
}

function fakeStorage(entries: [string, string][], deniedOwners: string[] = []) {
  const values = new Map(entries);
  const getItem = vi.fn((k: string) => {
    if (deniedOwners.some(owner => key(owner) === k)) throw new Error('read unavailable');
    return values.get(k) ?? null;
  });
  const setItem = vi.fn((k: string, value: string) => { values.set(k, value); });
  const removeItem = vi.fn((k: string) => { values.delete(k); });
  vi.stubGlobal('window', { localStorage: { getItem, setItem, removeItem } });
  return { values, getItem, setItem, removeItem };
}

function addConcern(ownerId: string) {
  const identity = { ownerId, conversationId: `conversation-${ownerId}`, requestId: `request-${ownerId}` };
  stageUserPlanningContextFactsV1({ ...identity, observedDate: date, now,
    facts: [{ localId: 'fact-1', kind: 'concern', label: '数学', value: '苦手',
      dateExpression: null, sourceText: '数学が苦手です' }] });
  return () => finalizeStagedUserPlanningContextV1(identity);
}

// An unavailable read may be surfaced by an exception or another public result.
// The independent contract below is about storage effects, not the error representation.
function allowReadFailure(action: () => unknown) {
  try { action(); } catch { /* An explicit read/save rejection is an acceptable outcome. */ }
}

afterEach(() => { vi.unstubAllGlobals(); resetUserPlanningContextRuntimeForTestV1(); });

const invalidPayloads = [
  ['malformed JSON', '{"records": [不正な JSON'],
  ['oversize bytes', 'x'.repeat(256 * 1024 + 1)],
  ['schema invalid JSON', JSON.stringify({ version: 'wrong-version', ownerId: 'a', records: [] })],
] as const;

describe('UC-P1A independent read safety oracle', () => {
  it.each(invalidPayloads)('does not delete %s during a read', (_label, raw) => {
    const otherRaw = rawSnapshot('b');
    const storage = fakeStorage([[key('a'), raw], [key('b'), otherRaw]]);
    allowReadFailure(() => loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }));
    expect.soft(storage.values.get(key('a')) === raw).toBe(true);
    expect.soft(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.get(key('b'))).toBe(otherRaw);
  });

  it.each(invalidPayloads)('does not overwrite %s on a later mutation', (_label, raw) => {
    const storage = fakeStorage([[key('a'), raw]]);
    allowReadFailure(() => loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }));
    allowReadFailure(addConcern('a'));
    expect.soft(storage.values.get(key('a')) === raw).toBe(true);
    expect.soft(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('does not turn an unavailable read into an authoritative empty for a later mutation', () => {
    const original = JSON.stringify({ ...createEmptyUserPlanningContextSnapshotV1('a'),
      records: [record('a'), { ...record('a'), id: 'independent-record', label: '英語' }] });
    const storage = fakeStorage([[key('a'), original]], ['a']);
    allowReadFailure(() => loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }));
    const finalize = addConcern('a');
    allowReadFailure(finalize);
    expect(storage.getItem).toHaveBeenCalledWith(key('a'));
    expect.soft(storage.values.get(key('a'))).toBe(original);
    expect.soft(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps owner b readable and writable while owner a read is unavailable', () => {
    const originalA = rawSnapshot('a');
    const originalB = rawSnapshot('b');
    const storage = fakeStorage([[key('a'), originalA], [key('b'), originalB]], ['a']);
    allowReadFailure(() => loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }));
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'b', currentDate: date }).records).toEqual([record('b')]);
    expect(addConcern('b')()).not.toBeNull();
    const savedB = JSON.parse(storage.values.get(key('b'))!);
    expect(savedB.records).toEqual([expect.objectContaining({ ownerId: 'b', label: '数学', status: 'active', sourceTurnId: 'request-b' })]);
    expect(storage.values.get(key('a'))).toBe(originalA);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('treats a missing key as empty and permits a normal save', () => {
    const storage = fakeStorage([]);
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }).records).toEqual([]);
    expect(addConcern('a')()).not.toBeNull();
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }).records)
      .toEqual([expect.objectContaining({ ownerId: 'a', label: '数学', status: 'active' })]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('allows explicit clear for owner a without clearing owner b', () => {
    const originalB = rawSnapshot('b');
    const storage = fakeStorage([[key('a'), rawSnapshot('a')], [key('b'), originalB]]);
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }).records).toEqual([record('a')]);
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'b', currentDate: date }).records).toEqual([record('b')]);
    clearUserPlanningContextForOwnerV1('a');
    expect(storage.values.has(key('a'))).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(key('a'));
    expect(storage.values.get(key('b'))).toBe(originalB);
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'b', currentDate: date }).records).toEqual([record('b')]);
  });

  it('keeps a revoked record revoked when the same fact is staged again', () => {
    const original = rawSnapshot('a', 'revoked');
    const storage = fakeStorage([[key('a'), original]]);
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }).records).toEqual([record('a', 'revoked')]);
    expect(addConcern('a')()).toBeNull();
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'a', currentDate: date }).records).toEqual([record('a', 'revoked')]);
    expect(storage.values.get(key('a'))).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
