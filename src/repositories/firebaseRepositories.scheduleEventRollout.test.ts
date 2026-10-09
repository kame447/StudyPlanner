import { createStartupSessionScope } from '../lib/startupSessionScope';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirebaseRepositories } from './firebaseRepositories';
import type { PlannerRepository } from './repositoryContracts';
import { deferred } from './localPersistenceConcurrency.testUtils';

const sdk = vi.hoisted(() => ({ observe: vi.fn(), marker: vi.fn(), transactionGet: vi.fn(), runTransaction: vi.fn(),
  query: vi.fn(), set: vi.fn(), legacy: {} as PlannerRepository }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collectionName: string, id: string) => ({ collectionName, id }),
  collection: (_db: unknown, name: string) => ({ name }),
  getDoc: () => { throw new Error('Cache-eligible capability reads are not allowed.'); },
  getDocFromServer: sdk.marker, getDocs: sdk.query, onSnapshot: sdk.observe,
  query: (...parts: unknown[]) => ({ parts }), where: (...parts: unknown[]) => ({ parts }),
  runTransaction: sdk.runTransaction, setDoc: sdk.set, deleteDoc: vi.fn(),
  writeBatch: () => ({ set: sdk.set, delete: vi.fn(), commit: async () => undefined }),
}));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({}), getFirestoreDb: () => ({}) }));
vi.mock('./firebaseAuthRepository', () => ({ createFirebaseAuthRepository: () => ({}) }));
vi.mock('./firebasePlannerRepository', () => ({ createFirebasePlannerRepository: () => sdk.legacy }));
vi.mock('./observedPlannerRepository', () => ({ createObservedPlannerRepository: (repository: PlannerRepository) => repository }));
const completed = (userId = 'owner') => ({ schemaVersion: 1, migrationVersion: 1, status: 'completed', userId });
const snapshot = (value: object | null, fromCache = false, hasPendingWrites = false) => ({
  exists: () => value !== null, data: () => value, metadata: { fromCache, hasPendingWrites },
});
beforeEach(() => {
  vi.resetAllMocks();
  sdk.legacy = { getPlans: vi.fn(async () => []), getMonthEvents: vi.fn(async () => []) } as unknown as PlannerRepository;
  sdk.marker.mockResolvedValue(snapshot(completed()));
  sdk.transactionGet.mockResolvedValue(snapshot(completed()));
  sdk.runTransaction.mockImplementation(async (_db, action) => action({ get: sdk.transactionGet, set: sdk.set }));
  sdk.query.mockResolvedValue({ docs: [] });
});

describe('real Firebase composition migration startup', () => {
  it('shares one clean server marker read and no transaction for completed owner startup', async () => {
    const repo = createFirebaseRepositories().plannerRepository;
    const gate = deferred<ReturnType<typeof snapshot>>(); sdk.marker.mockReturnValueOnce(gate.promise);
    const plans = repo.getPlans('owner'), events = repo.getMonthEvents('owner');
    expect(sdk.marker).toHaveBeenCalledExactlyOnceWith({ collectionName: 'schedule_event_migrations', id: 'owner' });
    expect(sdk.query).not.toHaveBeenCalled();
    gate.resolve(snapshot(completed())); await Promise.all([plans, events]);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    expect(sdk.query).toHaveBeenCalledTimes(2);
    expect(sdk.legacy.getPlans).not.toHaveBeenCalled(); expect(sdk.legacy.getMonthEvents).not.toHaveBeenCalled();
  });

  it('retains transaction acquisition for cached, pending, missing and migrating markers', async () => {
    const cases = [snapshot(completed(), true), snapshot(completed(), false, true), snapshot(null),
      snapshot({ ...completed(), status: 'migrating' }), { exists: () => true, data: () => completed() }];
    for (const read of cases) {
      sdk.marker.mockResolvedValueOnce(read); sdk.runTransaction.mockClear();
      // Another client may finish before acquisition; the transaction is authoritative.
      await createFirebaseRepositories().plannerRepository.getPlans('owner');
      expect(sdk.runTransaction).toHaveBeenCalledOnce();
    }
    expect(sdk.legacy.getPlans).not.toHaveBeenCalled();
  });

  it('uses legacy only for marker capability denial and retries that capability next time', async () => {
    const repo = createFirebaseRepositories().plannerRepository;
    sdk.marker.mockRejectedValueOnce({ code: 'permission-denied', message: 'marker unavailable' });
    await repo.getPlans('owner');
    expect(sdk.legacy.getPlans).toHaveBeenCalledOnce(); expect(sdk.query).not.toHaveBeenCalled();
    await repo.getPlans('owner');
    expect(sdk.marker).toHaveBeenCalledTimes(2); expect(sdk.query).toHaveBeenCalledOnce();
    expect(sdk.legacy.getPlans).toHaveBeenCalledOnce();
  });

  it('fails closed on network/auth probe errors and evicts failed promises for retry', async () => {
    for (const code of ['unavailable', 'unauthenticated']) {
      const repo = createFirebaseRepositories().plannerRepository;
      const error = { code, message: 'fixture' }; sdk.marker.mockRejectedValueOnce(error);
      await expect(repo.getPlans('owner')).rejects.toBe(error);
      expect(sdk.legacy.getPlans).not.toHaveBeenCalled();
      await expect(repo.getPlans('owner')).resolves.toEqual([]);
    }
  });

  it('does not classify downstream permission denial as rollout compatibility', async () => {
    const denial = { code: 'permission-denied', message: 'downstream denied' };
    sdk.marker.mockResolvedValueOnce(snapshot(null)); sdk.runTransaction.mockRejectedValueOnce(denial);
    await expect(createFirebaseRepositories().plannerRepository.getPlans('owner')).rejects.toThrow('downstream denied');
    sdk.query.mockRejectedValueOnce(denial);
    await expect(createFirebaseRepositories().plannerRepository.getPlans('owner')).rejects.toThrow('downstream denied');
    expect(sdk.legacy.getPlans).not.toHaveBeenCalled(); expect(sdk.legacy.getMonthEvents).not.toHaveBeenCalled();
  });

  it('rejects unsupported marker versions through the existing authority validation', async () => {
    const unsupported = snapshot({ ...completed(), migrationVersion: 99 });
    sdk.marker.mockResolvedValueOnce(unsupported); sdk.transactionGet.mockResolvedValueOnce(unsupported);
    await expect(createFirebaseRepositories().plannerRepository.getPlans('owner')).rejects.toThrow('Unsupported');
    expect(sdk.query).not.toHaveBeenCalled(); expect(sdk.legacy.getPlans).not.toHaveBeenCalled();
  });

  it('keeps migration capability promises and canonical queries owner-scoped', async () => {
    sdk.marker.mockImplementation(async ref => snapshot(completed(ref.id)));
    const repo = createFirebaseRepositories().plannerRepository;
    await Promise.all([repo.getPlans('a'), repo.getMonthEvents('a'), repo.getPlans('b')]);
    expect(sdk.marker.mock.calls.map(([ref]) => ref.id).sort()).toEqual(['a', 'b']);
    expect(sdk.query).toHaveBeenCalledTimes(3);
    const ownerIds = sdk.query.mock.calls.map(([query]) => query.parts[1].parts[2]);
    expect(ownerIds.sort()).toEqual(['a', 'a', 'b']);
  });
});

it('observed marker metadata cannot certify cutover or change ordinary migration decisions', async () => {
  for (const read of [snapshot(completed(), true), snapshot(completed(), false, true), snapshot(null),
    snapshot({ ...completed(), status: 'migrating' }), snapshot(completed())]) {
    const repo = createFirebaseRepositories().plannerRepository;
    const scope = createStartupSessionScope(), stop = vi.fn();
    sdk.observe.mockReset().mockReturnValue(stop); sdk.marker.mockClear(); sdk.query.mockClear(); sdk.runTransaction.mockClear();
    sdk.marker.mockResolvedValueOnce(read);
    repo.observeStartupScheduleMarker!('owner', scope);
    expect(sdk.observe).toHaveBeenCalledExactlyOnceWith({ collectionName: 'schedule_event_migrations', id: 'owner' },
      { includeMetadataChanges: true }, expect.any(Function), expect.any(Function));
    const data = vi.fn(() => { throw new Error('observer must not inspect marker body'); });
    sdk.observe.mock.calls[0][2]({ metadata: { fromCache: false, hasPendingWrites: false }, data });
    expect(data).not.toHaveBeenCalled(); expect(sdk.marker).not.toHaveBeenCalled();
    expect(sdk.query).not.toHaveBeenCalled(); expect(sdk.runTransaction).not.toHaveBeenCalled();
    await repo.getPlans('owner');
    const markerData = read.data();
    const clean = read.exists() && read.metadata.fromCache === false && read.metadata.hasPendingWrites === false
      && markerData !== null && 'status' in markerData && markerData.status === 'completed';
    expect(sdk.runTransaction).toHaveBeenCalledTimes(clean ? 0 : 1);
    expect(sdk.marker).toHaveBeenCalledOnce();
    scope.invalidate(); expect(stop).toHaveBeenCalledOnce();
  }
});
it('observer failures preserve permission fallback and synchronous scope disposal', async () => {
  const repo = createFirebaseRepositories().plannerRepository, scope = createStartupSessionScope();
  const stop = vi.fn(); sdk.observe.mockReset().mockReturnValue(stop);
  repo.observeStartupScheduleMarker!('owner', scope);
  sdk.observe.mock.calls[0][3](new Error('optional observation failed'));
  expect(stop).toHaveBeenCalledOnce();
  sdk.marker.mockRejectedValueOnce({ code: 'permission-denied' });
  await repo.getPlans('owner'); expect(sdk.legacy.getPlans).toHaveBeenCalledWith('owner');
  scope.invalidate(); expect(stop).toHaveBeenCalledOnce();
});
