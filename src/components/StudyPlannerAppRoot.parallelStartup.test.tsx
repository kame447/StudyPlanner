import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyPlannerAppRoot } from './StudyPlannerAppRoot';
import { SplashScreen } from './SplashScreen';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { createLocalFixture, deferred, MemoryStorage, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { User } from '../types/domain';
const fixture = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository,
  profile: vi.fn(), memory: vi.fn(), content: vi.fn(),
  policy: 'accepted', preferenceLoading: false, weekStartsOn: 'monday' as string | null }));
vi.mock('../repositories', () => ({ authRepository: { getCurrentUser: fixture.profile },
  plannerRepository: new Proxy({}, { get: (_, key) => fixture.repository[key as keyof PlannerRepository] }) }));
vi.mock('../data/naturalLanguageCatalog', () => ({ loadNaturalLanguageCatalog: vi.fn(async () => undefined) }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => true }));
vi.mock('../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy', () => ({ useWeeklyPlanningTracePolicy: () => ({ status: fixture.policy }) }));
vi.mock('../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile', () => ({
  useWeeklyPlanningPersonalizationProfile: () => ({ loading: fixture.preferenceLoading,
    profile: fixture.weekStartsOn ? { weekStartsOn: { value: fixture.weekStartsOn } } : null, error: '' }) }));
vi.mock('../features/userPlanningContext/userPlanningContextRepository', () => ({ getUserPlanningContextRepositoryV1: () => ({
  initialize: fixture.memory, subscribe: () => () => {},
}) }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({
  getWeeklyPlanningApprovalPlanRepository: () => ({}) }));
// Keep the actual root, memory provider, auth hook and planner bootstrap. Only
// replace the expensive UI/AI subtree with a probe of its mounting boundary.
vi.mock('../App', async () => {
  const React = await import('react');
  const { usePlannerAppState } = await import('../hooks/usePlannerAppState');
  const { useRootStartupReady } = await import('./RootStartupReadyContext');
  function Probe({ state, onReady }: any) {
    const ready = useRootStartupReady();
    React.useEffect(() => { if (!state.booting) { ready?.(); onReady?.(); } }, [state.booting, ready, onReady]);
    fixture.content(state);
    return <span data-testid="surface">{state.notice?.text ?? 'ready'}</span>;
  }
  function Standalone() { const state = usePlannerAppState(); return <Probe state={state} />; }
  return { default: ({ state, onReady }: any) => state ? <Probe state={state} onReady={onReady} /> : <Standalone /> };
});
const owner = (id: string): User => ({ id, username: id, email: `${id}@example.test`, avatar: '', createdAt: STAMP });
let renderer: ReactTestRenderer | undefined;
let fake: ReturnType<typeof createFakeAuthSession>;
let memoryGate: ReturnType<typeof deferred>;
let plannerGate: ReturnType<typeof deferred>;
let plansSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('window', { location: { pathname: '/' }, localStorage: new MemoryStorage(), setTimeout, clearTimeout });
  vi.clearAllMocks(); fixture.policy = 'accepted'; fixture.preferenceLoading = false; fixture.weekStartsOn = 'monday';
  fixture.repository = { ...createLocalFixture().repository };
  memoryGate = deferred(); plannerGate = deferred();
  fixture.memory.mockImplementation(async (_id, snapshot) => { await memoryGate.promise; return { snapshot, shared: true }; });
  fixture.profile.mockResolvedValue(owner('a'));
  plansSpy = vi.fn(async () => { await plannerGate.promise; return []; }); fixture.repository.getPlans = plansSpy;
  fake = createFakeAuthSession({ currentUser: { id: 'a', requiresEmailVerification: false } });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount() { await act(async () => { renderer = create(<StudyPlannerAppRoot authSession={fake.session} />); await microtasks(); }); }
async function release(gate: ReturnType<typeof deferred>) { await act(async () => { gate.resolve(undefined); await microtasks(); }); }
const splash = () => renderer!.root.findAllByType(SplashScreen).length;
it.each(['memory-first', 'planner-first'])('overlaps bootstrap with memory and retains both gates: %s', async order => {
  await mount();
  expect(fixture.memory).toHaveBeenCalledOnce();
  expect(fixture.profile).toHaveBeenCalledOnce();
  expect(plansSpy).toHaveBeenCalledOnce();
  expect(fixture.content).not.toHaveBeenCalled(); expect(splash()).toBe(1);
  await release(order === 'memory-first' ? memoryGate : plannerGate);
  expect(splash()).toBe(1);
  if (order === 'planner-first') expect(fixture.content).not.toHaveBeenCalled();
  await release(order === 'memory-first' ? plannerGate : memoryGate);
  expect(splash()).toBe(0);
  expect(fixture.content).toHaveBeenCalled(); expect(plansSpy).toHaveBeenCalledOnce();
  expect(fixture.profile).toHaveBeenCalledOnce();
});
it('retains early startup errors throughout a long memory wait', async () => {
  vi.useFakeTimers(); window.setTimeout = setTimeout as any; window.clearTimeout = clearTimeout as any;
  fixture.profile.mockRejectedValue(new Error('profile unavailable'));
  await mount();
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(fixture.content).not.toHaveBeenCalled();
  await release(memoryGate);
  expect(splash()).toBe(0);
  expect(renderer!.root.findByProps({ 'data-testid': 'surface' }).children).toContain('profile unavailable');
  await act(async () => { vi.advanceTimersByTime(3599); });
  expect(renderer!.root.findByProps({ 'data-testid': 'surface' }).children).toContain('profile unavailable');
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(renderer!.root.findByProps({ 'data-testid': 'surface' }).children).toEqual(['ready']);
});
it('releases existing memory failure without bypassing the pending planner read', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await mount();
  await act(async () => { memoryGate.reject(new Error('memory unavailable')); await microtasks(); });
  expect(splash()).toBe(1);
  await release(plannerGate); expect(splash()).toBe(0);
});
it.each(['loading', 'required', 'unavailable', 'preference-loading', 'preference-missing'])('does not bootstrap before %s gate', async gate => {
  if (gate.startsWith('preference')) { fixture.preferenceLoading = gate.endsWith('loading'); fixture.weekStartsOn = gate.endsWith('missing') ? null : 'monday'; }
  else fixture.policy = gate;
  await mount(); expect(fixture.profile).not.toHaveBeenCalled(); expect(fixture.memory).not.toHaveBeenCalled();
});
it('a late old owner cannot release or populate a newer startup', async () => {
  await mount();
  const oldMemory = memoryGate, oldPlanner = plannerGate;
  memoryGate = deferred(); plannerGate = deferred(); fixture.profile.mockResolvedValue(owner('b'));
  await act(async () => { fake.emit({ id: 'b', requiresEmailVerification: false }); await microtasks(); });
  expect(fixture.memory).toHaveBeenCalledTimes(2); expect(plansSpy).toHaveBeenCalledTimes(2);
  await release(oldMemory); await release(oldPlanner);
  expect(splash()).toBe(1); expect(fixture.content).not.toHaveBeenCalled();
  await release(memoryGate); await release(plannerGate);
  expect(splash()).toBe(0);
  expect(fixture.content.mock.lastCall?.[0].user.id).toBe('b');
});
it('requires a fresh gate when the same owner signs out and returns', async () => {
  await mount(); await release(memoryGate); await release(plannerGate); expect(splash()).toBe(0);
  fixture.profile.mockResolvedValue(null);
  await act(async () => { fake.emit(null); await microtasks(); });
  memoryGate = deferred(); plannerGate = deferred(); fixture.profile.mockResolvedValue(owner('a'));
  fixture.content.mockClear();
  await act(async () => { fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
  expect(splash()).toBe(1); expect(fixture.content).not.toHaveBeenCalled();
  await release(plannerGate); expect(splash()).toBe(1);
  await release(memoryGate); expect(splash()).toBe(0);
});
it('revokes pending profile restoration on unmount before starting any planner reads', async () => {
  const profile = deferred<User | null>(); fixture.profile.mockReturnValue(profile.promise);
  await mount(); act(() => renderer!.unmount()); renderer = undefined;
  await act(async () => { profile.resolve(owner('a')); await microtasks(); });
  expect(plansSpy).not.toHaveBeenCalled();
});
it('does not read another returned identity under the current root consent boundary', async () => {
  fixture.profile.mockResolvedValue(owner('b'));
  await mount();
  expect(plansSpy).not.toHaveBeenCalled();
  await release(memoryGate);
  expect(splash()).toBe(1);
  expect(fixture.content.mock.lastCall?.[0].user).toBeNull();
  expect(fixture.content.mock.lastCall?.[0].booting).toBe(true);
  memoryGate = deferred(); plannerGate = deferred();
  await act(async () => { fake.emit({ id: 'b', requiresEmailVerification: false }); await microtasks(); });
  expect(splash()).toBe(1); expect(plansSpy).toHaveBeenCalledExactlyOnceWith('b');
  await release(memoryGate); await release(plannerGate);
  expect(splash()).toBe(0); expect(fixture.content.mock.lastCall?.[0].user.id).toBe('b');
});
