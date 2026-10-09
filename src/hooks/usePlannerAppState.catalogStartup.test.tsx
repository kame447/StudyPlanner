import '../data/naturalLanguageCatalog';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLocalFixture, deferred, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { User } from '../types/domain';
import { usePlannerAppState } from './usePlannerAppState';
import { getNaturalLanguageCatalog, loadNaturalLanguageCatalog } from '../data/naturalLanguageCatalog';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
const fixture = vi.hoisted(() => ({ user: null as User | null, listeners: new Set<() => void>(),
  subscribe(listener: () => void) { fixture.listeners.add(listener); return () => { fixture.listeners.delete(listener); }; },
  snapshot: () => fixture.user, noop: vi.fn(async () => undefined), read: vi.fn(), enabled: true,
}));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
vi.mock('./useAuthSessionState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { useAuthSessionState: () => ({ booting: false,
    user: React.useSyncExternalStore(fixture.subscribe, fixture.snapshot, fixture.snapshot),
    bootstrapSession: fixture.noop, signUpWithPassword: fixture.noop, signInWithPassword: fixture.noop,
    signInWithGoogle: fixture.noop, sendPasswordReset: fixture.noop, saveUserProfile: fixture.noop, signOut: fixture.noop,
  }) };
});
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({ getWeeklyPlanningApprovalPlanRepository: () => ({}) }));
vi.mock('../lib/firebaseClient', () => ({ getFirestoreDb: () => fixture.enabled ? {} : null }));
vi.mock('firebase/firestore', () => ({ doc: () => ({ catalog: true }), getDoc: fixture.read }));
const remote = { version: 987, subjects: [{ label: 'Remote subject', keywords: ['unique remote keyword'] }], planTypes: [], actionWords: [] };
const snapshot = (fromCache: boolean | undefined = false) => ({ exists: () => true, data: () => remote, metadata: { fromCache } });
const owner = (id: string): User => ({ id, email: `${id}@example.test`, username: id, avatar: '', createdAt: STAMP });
let renderer: ReactTestRenderer | undefined;
function Harness({ expectedUserId }: { expectedUserId?: string }) { usePlannerAppState({ expectedUserId }); return null; }
async function mount(expectedUserId?: string) { await act(async () => { renderer = create(<Harness expectedUserId={expectedUserId} />); await microtasks(); }); }
async function restore(id = 'a') { await act(async () => { fixture.user = owner(id); fixture.listeners.forEach(listener => listener()); await microtasks(); }); }
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  fixture.user = null; fixture.listeners.clear(); fixture.enabled = true;
  fixture.read.mockReset().mockResolvedValue(snapshot());
  boundary.repository = { ...createLocalFixture().repository };
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('starts before profile restoration and reuses only this startup successful server read', async () => {
  await mount('a');
  expect(fixture.read).toHaveBeenCalledTimes(1);
  expect(getNaturalLanguageCatalog().subjects).toEqual(remote.subjects);
  await restore();
  expect(fixture.read).toHaveBeenCalledTimes(1);
  act(() => renderer!.unmount()); renderer = undefined;
  await mount('a');
  expect(fixture.read).toHaveBeenCalledTimes(2);
});
it.each(['error', 'missing', 'cache', 'unknown'] as const)('retains the owner-transition retry after %s', async kind => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (kind === 'error') fixture.read.mockRejectedValueOnce(new Error('synthetic unavailable'));
  else fixture.read.mockResolvedValueOnce(kind === 'missing' ? { exists: () => false } : snapshot(kind === 'cache' ? true : undefined));
  // Passing undefined uses the helper default; explicitly remove provenance.
  if (kind === 'unknown') fixture.read.mockReset().mockResolvedValueOnce({ exists: () => true, data: () => remote }).mockResolvedValue(snapshot());
  await mount('a'); await restore();
  expect(fixture.read).toHaveBeenCalledTimes(2);
});
it.each([false, true])('overlapping reads share one attempt without adding retries after failure=%s', async failure => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const pending = deferred<ReturnType<typeof snapshot>>(); fixture.read.mockReturnValueOnce(pending.promise);
  await mount('a'); await restore(); expect(fixture.read).toHaveBeenCalledTimes(1);
  await act(async () => { if (failure) pending.reject(new Error('synthetic unavailable')); else pending.resolve(snapshot()); await microtasks(); });
  expect(fixture.read).toHaveBeenCalledTimes(1);
});
it('retains standalone anonymous-to-owner refresh and the original catalog return shape', async () => {
  await mount(); await restore(); expect(fixture.read).toHaveBeenCalledTimes(2);
  expect(await loadNaturalLanguageCatalog()).toEqual(getNaturalLanguageCatalog());
  expect(fixture.read).toHaveBeenCalledTimes(3);
});
it('does not carry success across an expected-owner change or a missing local backend', async () => {
  await mount('a');
  await act(async () => { renderer!.update(<Harness expectedUserId="b" />); await microtasks(); });
  expect(fixture.read).toHaveBeenCalledTimes(2);
  act(() => renderer!.unmount()); renderer = undefined; fixture.read.mockClear(); fixture.enabled = false;
  await mount('a'); expect(fixture.read).not.toHaveBeenCalled();
  fixture.enabled = true; await restore(); expect(fixture.read).toHaveBeenCalledTimes(1);
});
it('does not start an unresolved import after unmount or reuse a late old-mount success', async () => {
  act(() => { renderer = create(<Harness expectedUserId="a" />); });
  act(() => renderer!.unmount()); renderer = undefined;
  await act(async () => { await microtasks(); });
  expect(fixture.read).not.toHaveBeenCalled();
  const pending = deferred<ReturnType<typeof snapshot>>(); fixture.read.mockReturnValueOnce(pending.promise);
  await mount('a'); act(() => renderer!.unmount()); renderer = undefined;
  await act(async () => { pending.resolve(snapshot()); await microtasks(); });
  await mount('a'); expect(fixture.read).toHaveBeenCalledTimes(2);
});
