import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actual, createLocalFixture, DATE, deferred, microtasks, plan, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ActualDraft, User } from '../types/domain';
import { usePlannerAppState } from './usePlannerAppState';

type Loader = (owner: string) => Promise<void>;
const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
const auth = vi.hoisted(() => ({
  user: null as User | null,
  nextUser: null as User | null,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) { auth.listeners.add(listener); return () => { auth.listeners.delete(listener); }; },
  snapshot: () => auth.user,
  bootstrap: vi.fn<(load: Loader) => Promise<void>>(),
  signIn: vi.fn<() => Promise<User | null>>(),
  signOut: vi.fn<() => Promise<void>>(),
  noop: vi.fn(async () => undefined),
}));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
// The auth identity is stable while useSyncExternalStore supplies genuine React
// owner-change renders. Both application and planner-data hooks remain real.
vi.mock('./useAuthSessionState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { useAuthSessionState: () => ({
    booting: false, user: React.useSyncExternalStore(auth.subscribe, auth.snapshot, auth.snapshot),
    bootstrapSession: auth.bootstrap, signUpWithPassword: auth.noop,
    signInWithPassword: auth.signIn, signInWithGoogle: auth.signIn,
    sendPasswordReset: auth.noop, saveUserProfile: auth.noop, signOut: auth.signOut,
  }) };
});
vi.mock('../data/naturalLanguageCatalog', () => ({ loadNaturalLanguageCatalogWithOutcome: async () => { await auth.noop(); return { source: 'server' }; } }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({
  getWeeklyPlanningApprovalPlanRepository: () => ({ saveApprovedPlan: auth.noop, completeOperation: auth.noop }),
}));
const user = (id: string): User => ({ id, email: `${id}@example.test`, username: id, avatar: '', createdAt: STAMP });
const A = user('owner-a'), B = user('owner-b');
let state: ReturnType<typeof usePlannerAppState>;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerAppState(); return null; }
function publishUser(value: User | null) {
  auth.user = value;
  for (const listener of auth.listeners) listener();
}
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  auth.user = null;
  auth.nextUser = null;
  auth.listeners.clear();
  auth.bootstrap.mockReset();
  auth.signIn.mockReset().mockImplementation(async () => { publishUser(auth.nextUser); return auth.nextUser; });
  auth.signOut.mockReset().mockImplementation(async () => { publishUser(null); });
  auth.noop.mockClear();
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount() {
  const fixture = createLocalFixture();
  for (const owner of [A, B]) {
    await fixture.repository.upsertPlan(plan({ id: `plan-${owner.id}`, seriesId: `plan-${owner.id}`, userId: owner.id }));
    await fixture.repository.upsertActual(actual({ id: `actual-${owner.id}`, planId: `plan-${owner.id}`, userId: owner.id }));
  }
  boundary.repository = { ...fixture.repository };
  const getPlans = vi.spyOn(boundary.repository, 'getPlans');
  const session = deferred<User | null>();
  auth.bootstrap.mockImplementation(async load => {
    const current = await session.promise;
    publishUser(current);
    if (current) await load(current.id);
  });
  await act(async () => { renderer = create(<Harness />); });
  expect(auth.bootstrap).toHaveBeenCalledTimes(1);
  expect(getPlans).not.toHaveBeenCalled();
  const initialLoader = auth.bootstrap.mock.calls[0][0];
  await act(async () => { session.resolve(A); await auth.bootstrap.mock.results[0].value; await microtasks(); });
  expect(state.user?.id).toBe(A.id);
  expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: A.id });
  expect(auth.bootstrap).toHaveBeenCalledTimes(1);
  expect(getPlans).toHaveBeenCalledTimes(1);
  return { ...fixture, getPlans, initialLoader };
}

describe('real planner application bootstrap dependency stability', () => {
  it('bootstraps once through initial data-scope recreation, ordinary renders, notices and retained full refresh', async () => {
    const fixture = await mount();
    await act(async () => {
      state.setViewMode('day');
      state.selectDate('2026-10-06');
      state.openCreatePlan();
    });
    await act(async () => { state.closePlanEditor(); renderer!.update(<Harness />); });
    const current = state.actuals[0];
    const input: ActualDraft = { userId: A.id, planId: current.planId, occurrenceDate: DATE,
      actualStartTime: '09:00', actualEndTime: '10:00', title: 'Saved', subject: 'Math',
      isAlignedToPlan: false, note: 'Notice causes a real rerender', materialProgressUpdates: [] };
    await act(async () => { await state.saveActual(state.plans[0], input, current.id); });
    expect(state.notice?.text).toBe('記録を保存しました。');
    await act(async () => { state.dismissNotice(); });
    await act(async () => { await fixture.initialLoader(A.id); });
    expect(auth.bootstrap).toHaveBeenCalledTimes(1);
    expect(fixture.getPlans.mock.calls.map(call => call[0])).toEqual([A.id, A.id]);
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.actuals).toEqual(await fixture.repository.getActuals(A.id));
  });

  it.each(['signout-first', 'direct-owner-change'] as const)('does not re-bootstrap during %s followed by sign-out/reset and re-login', async transition => {
    const fixture = await mount();
    if (transition === 'signout-first') {
      await act(async () => { await state.signOut(); });
      expect(state.user).toBeNull();
      expect(state.plans).toEqual([]);
      expect(state.actuals).toEqual([]);
      expect(auth.bootstrap).toHaveBeenCalledTimes(1);
    }
    auth.nextUser = B;
    await act(async () => { await state.signInWithGoogle(); await microtasks(); });
    expect(state.user?.id).toBe(B.id);
    expect(state.plannerDataAvailability).toMatchObject({ status: 'ready', ownerId: B.id });
    expect(state.actuals.map(actual => actual.userId)).toEqual([B.id]);
    expect(auth.bootstrap).toHaveBeenCalledTimes(1);
    await act(async () => { await state.signOut(); });
    expect(state.user).toBeNull();
    expect(state.plans).toEqual([]);
    expect(state.actuals).toEqual([]);
    expect(auth.bootstrap).toHaveBeenCalledTimes(1);
    auth.nextUser = A;
    await act(async () => { await state.signInWithPassword('owner@example.test', 'test-only-placeholder'); });
    expect(state.user?.id).toBe(A.id);
    expect(auth.bootstrap).toHaveBeenCalledTimes(1);
    expect(fixture.getPlans.mock.calls.map(call => call[0])).toEqual([A.id, B.id, A.id]);
    expect(state.actuals).toEqual(await fixture.repository.getActuals(A.id));
    expect(auth.bootstrap.mock.calls[0][0]).toBe(fixture.initialLoader);
  });
});
