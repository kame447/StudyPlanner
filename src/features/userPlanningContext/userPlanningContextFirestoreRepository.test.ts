import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyUserPlanningContextSnapshotV1,
  USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION,
  type UserPlanningContextRecordV1,
} from './userPlanningContextTypes';

// The Firestore SDK is replaced by a one-document in-memory fake; the Rules are covered by
// tests/firestore/userPlanningContextAndApprovalRules.emulator.test.ts.
const fake = vi.hoisted(() => ({
  data: undefined as unknown,
  sets: [] as unknown[],
  listener: null as null | { next: (snapshot: { exists(): boolean; data(): unknown }) => void; error: (error: unknown) => void },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  runTransaction: async (_db: unknown, update: (transaction: unknown) => Promise<unknown>) => update({
    get: async () => ({ exists: () => fake.data !== undefined, data: () => fake.data }),
    set: (_ref: unknown, value: unknown) => { fake.sets.push(value); fake.data = value; },
  }),
  onSnapshot: (_ref: unknown, next: never, error: never) => { fake.listener = { next, error }; return () => undefined; },
}));
vi.mock('../../lib/firebaseClient', () => ({ getFirestoreDb: () => ({}) }));

const OWNER = 'owner-a';
const MALFORMED = '共有されている長期記憶の形式が不正です。';

function record(overrides: Partial<UserPlanningContextRecordV1> = {}): UserPlanningContextRecordV1 {
  return {
    id: 'record-1', ownerId: OWNER, kind: 'study_goal', label: '第一志望', value: '国公立大学の理系',
    dateExpression: null, observedDate: '2026-08-28', resolvedDate: null, sourceText: '国公立大学の理系を志望しています',
    sourceConversationId: 'conversation-1', sourceTurnId: 'turn-1', recordedAt: '2026-08-28T00:00:00.000Z',
    status: 'active', origin: 'ai_inferred', ...overrides,
  };
}
function cloudDocument(overrides: Record<string, unknown> = {}, records = [record()]) {
  return {
    schemaVersion: USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION, ownerId: OWNER, revision: 3,
    snapshot: { ...createEmptyUserPlanningContextSnapshotV1(OWNER), records }, updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}
async function repository() {
  const module = await import('./userPlanningContextRepository');
  module.resetUserPlanningContextRepositoryForTestV1();
  return module.getUserPlanningContextRepositoryV1();
}

beforeEach(() => { fake.data = undefined; fake.sets = []; fake.listener = null; });

describe('FirestoreUserPlanningContextRepositoryV1 against the SDK fake', () => {
  const writes = (repo: Awaited<ReturnType<typeof repository>>) => ({
    initialize: () => repo.initialize(OWNER, createEmptyUserPlanningContextSnapshotV1(OWNER)),
    upsert: () => repo.upsertInferredRecords(OWNER, [record({ id: 'new', label: '別の目標' })]),
    confirm: () => repo.saveUserConfirmedRecord(OWNER, record({ id: 'confirmed', origin: 'user_confirmed' })),
    remove: () => repo.removeRecord(OWNER, 'record-1'),
  });

  it.each([
    ['another owner', { ownerId: 'someone-else' }],
    ['an unknown schema version', { schemaVersion: 'other' }],
    ['a negative revision', { revision: -1 }],
    ['a fractional revision', { revision: 1.5 }],
    ['an invalid updatedAt', { updatedAt: 'not-a-date' }],
    ['a snapshot of another owner', { snapshot: { ...createEmptyUserPlanningContextSnapshotV1('someone-else') } }],
  ])('rejects %s without overwriting it, for every write', async (_label, override) => {
    const repo = await repository();
    for (const write of Object.values(writes(repo))) {
      fake.data = cloudDocument(override);
      const stored = structuredClone(fake.data);
      await expect(write()).rejects.toThrow(MALFORMED);
      expect(fake.sets).toEqual([]);
      expect(fake.data).toEqual(stored);
    }
  });

  it('rejects a non-object document', async () => {
    const repo = await repository();
    fake.data = 'not a document';
    await expect(repo.removeRecord(OWNER, 'record-1')).rejects.toThrow(MALFORMED);
    expect(fake.sets).toEqual([]);
  });

  it('creates revision 1, then raises the revision by exactly one on every write', async () => {
    const repo = await repository();
    expect((await repo.initialize(OWNER, createEmptyUserPlanningContextSnapshotV1(OWNER))).revision).toBe(1);
    expect((await repo.upsertInferredRecords(OWNER, [record()])).revision).toBe(2);
    expect((await repo.saveUserConfirmedRecord(OWNER, record({ id: 'confirmed', origin: 'user_confirmed', label: '確認済み' }))).revision).toBe(3);
    expect((await repo.removeRecord(OWNER, 'record-1')).revision).toBe(4);
    expect(fake.sets.map(value => (value as { revision: number }).revision)).toEqual([1, 2, 3, 4]);
  });

  it('keeps an existing valid document on initialize instead of replacing it with the local snapshot', async () => {
    const repo = await repository();
    fake.data = cloudDocument();
    const state = await repo.initialize(OWNER, createEmptyUserPlanningContextSnapshotV1(OWNER));
    expect(state).toMatchObject({ revision: 3, shared: true });
    expect(state.snapshot.records).toHaveLength(1);
    expect(fake.sets).toEqual([]);
  });

  it('throws when forgetting from an absent document and writes nothing', async () => {
    const repo = await repository();
    await expect(repo.removeRecord(OWNER, 'record-1')).rejects.toThrow('共有されている長期記憶が見つかりません。');
    expect(fake.sets).toEqual([]);
  });

  it('rejects an empty inferred write without touching the document', async () => {
    const repo = await repository();
    fake.data = cloudDocument();
    await expect(repo.upsertInferredRecords(OWNER, [])).rejects.toThrow('同期する長期記憶がありません。');
    expect(fake.sets).toEqual([]);
  });

  it('does not notify when the document is absent, reports a malformed one, and notifies a valid one', async () => {
    const repo = await repository();
    const onChange = vi.fn(); const onError = vi.fn();
    repo.subscribe(OWNER, onChange, onError);
    fake.listener!.next({ exists: () => false, data: () => undefined });
    expect(onChange).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    fake.listener!.next({ exists: () => true, data: () => cloudDocument({ ownerId: 'someone-else' }) });
    expect(onChange).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledWith(new Error(MALFORMED));
    fake.listener!.next({ exists: () => true, data: () => cloudDocument() });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 3, shared: true }));
  });
});
