import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyPlannerAppRoot } from './StudyPlannerAppRoot';
import { SplashScreen } from './SplashScreen';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { createLocalFixture, deferred, MemoryStorage, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { StartupSessionCapability } from '../lib/startupSessionScope';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { User } from '../types/domain';
const fixture = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository,
  profile: vi.fn(), memory: vi.fn(), content: vi.fn(), observe: vi.fn(), observation: 'off', markerObservation: 'off', marker: vi.fn(),
  policy: 'accepted', preferenceError: '', preferenceLoading: false, weekStartsOn: 'monday' as string | null }));
vi.mock('../repositories', () => ({ authRepository: { getCurrentUser: fixture.profile, observeStartupProfile: fixture.observe },
  plannerRepository: new Proxy({}, { get: (_, key) => fixture.repository[key as keyof PlannerRepository] }) }));
vi.mock('../lib/startupMarkerObservation', () => ({ get startupMarkerObservation() { return fixture.markerObservation; } }));
vi.mock('../lib/startupProfileObservation', () => ({ get startupProfileObservation() { return fixture.observation; } }));
vi.mock('../data/naturalLanguageCatalog', () => ({ loadNaturalLanguageCatalogWithOutcome: vi.fn(async () => ({ source: 'server' })) }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => true }));
vi.mock('../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy', () => ({ useWeeklyPlanningTracePolicy: () => ({ status: fixture.policy }) }));
vi.mock('../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile', () => ({
  useWeeklyPlanningPersonalizationProfile: () => ({ loading: fixture.preferenceLoading,
    profile: fixture.weekStartsOn ? { weekStartsOn: { value: fixture.weekStartsOn } } : null, error: fixture.preferenceError }) }));
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
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.clearAllMocks(); fixture.observation = 'off'; fixture.markerObservation = 'off'; fixture.marker.mockReset(); fixture.observe.mockReset(); fixture.policy = 'accepted'; fixture.preferenceError = ''; fixture.preferenceLoading = false; fixture.weekStartsOn = 'monday';
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

it('keeps the same visible Splash across unresolved auth, consent, preferences and bootstrap', async () => {
  fake = createFakeAuthSession();
  fixture.policy = 'loading';
  await mount();
  const initialSplash = renderer!.root.findByType(SplashScreen);
  await act(async () => { fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
  expect(renderer!.root.findByType(SplashScreen)).toBe(initialSplash);
  fixture.policy = 'accepted'; fixture.preferenceError = ''; fixture.preferenceLoading = true;
  await act(async () => { renderer!.update(<StudyPlannerAppRoot authSession={fake.session} />); });
  expect(renderer!.root.findByType(SplashScreen)).toBe(initialSplash);
  fixture.preferenceLoading = false;
  await act(async () => { renderer!.update(<StudyPlannerAppRoot authSession={fake.session} />); await microtasks(); });
  expect(renderer!.root.findByType(SplashScreen)).toBe(initialSplash);
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(plansSpy).toHaveBeenCalledOnce();
  await release(memoryGate);
  expect(renderer!.root.findByType(SplashScreen)).toBe(initialSplash);
  await release(plannerGate); expect(splash()).toBe(0);
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(plansSpy).toHaveBeenCalledOnce();
});


it('retires an old preview copy and follows the ordinary current-data startup', async () => {
  window.localStorage.setItem('studyplanner.startup-schedule.v1:a', JSON.stringify({ rows: [{ title: 'Old display copy' }] }));
  await mount();
  expect(splash()).toBe(1);
  expect(window.localStorage.getItem('studyplanner.startup-schedule.v1:a')).toBeNull();
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('Old display copy');
  await release(memoryGate); expect(splash()).toBe(1);
  await release(plannerGate); expect(splash()).toBe(0);
  expect(window.localStorage.getItem('studyplanner.startup-schedule.v1:a')).toBeNull();
});

it('batched signout and same-owner return cannot accept an old startup completion', async () => {
  await mount(); const oldMemory = memoryGate, oldPlanner = plannerGate;
  memoryGate = deferred(); plannerGate = deferred();
  await act(async () => { fake.emit(null); fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
  await release(oldMemory); await release(oldPlanner);
  expect(splash()).toBe(1); expect(fixture.content).not.toHaveBeenCalled();
  await release(memoryGate); await release(plannerGate); expect(splash()).toBe(0);
});

function enableObservation() {
  fixture.observation = 'observe'; fixture.preferenceLoading = true;
  const stops: ReturnType<typeof vi.fn>[] = [];
  fixture.observe.mockImplementation((_owner: string, scope: StartupSessionCapability) => {
    let closed = false; const disposed = vi.fn(); stops.push(disposed);
    const stop = () => { if (!closed) { closed = true; disposed(); } };
    scope.onInvalidate(stop); return stop;
  });
  return stops;
}
async function updateRoot() {
  await act(async () => { renderer!.update(<StudyPlannerAppRoot authSession={fake.session} />); await microtasks(); });
}
it('diagnostic profile observation overlaps preferences without advancing write-capable bootstrap', async () => {
  const stops = enableObservation(); fixture.policy = 'loading'; await mount();
  expect(fixture.observe).not.toHaveBeenCalled();
  fixture.policy = 'accepted'; await updateRoot();
  expect(fixture.observe).toHaveBeenCalledOnce();
  expect(fixture.profile).not.toHaveBeenCalled(); expect(fixture.memory).not.toHaveBeenCalled();
  expect(plansSpy).not.toHaveBeenCalled(); expect(splash()).toBe(1);
  fixture.preferenceLoading = false; await updateRoot();
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(stops[0]).not.toHaveBeenCalled();
  await release(plannerGate); expect(stops[0]).not.toHaveBeenCalled(); expect(splash()).toBe(1);
  await release(memoryGate); expect(stops[0]).toHaveBeenCalledOnce(); expect(splash()).toBe(0);
});
it('missing preferences terminate the diagnostic observer permanently before onboarding retry', async () => {
  const stops = enableObservation(); await mount();
  fixture.preferenceLoading = false; fixture.weekStartsOn = null; await updateRoot();
  expect(stops[0]).toHaveBeenCalledOnce(); expect(fixture.profile).not.toHaveBeenCalled();
  fixture.preferenceLoading = true; await updateRoot();
  fixture.preferenceLoading = false; fixture.weekStartsOn = 'monday'; await updateRoot();
  expect(fixture.observe).toHaveBeenCalledOnce(); expect(fixture.profile).toHaveBeenCalledOnce();
  await release(memoryGate); await release(plannerGate); expect(splash()).toBe(0);
});
it.each(['b', 'a'])('auth event revokes observation synchronously before React commits the next %s session', async nextOwner => {
  const stops = enableObservation(); await mount();
  const firstScope = fixture.observe.mock.calls[0][1] as StartupSessionCapability;
  await act(async () => {
    if (nextOwner === 'a') {
      fake.emit(null);
      expect(stops[0]).toHaveBeenCalledOnce(); expect(firstScope.isCurrent()).toBe(false);
    }
    fake.emit({ id: nextOwner, requiresEmailVerification: false });
    expect(stops[0]).toHaveBeenCalledOnce(); expect(firstScope.isCurrent()).toBe(false);
    await microtasks();
  });
  expect(fixture.observe).toHaveBeenCalledTimes(2);
  expect(fixture.observe.mock.calls[1][0]).toBe(nextOwner);
  expect(stops[1]).not.toHaveBeenCalled(); expect(fixture.profile).not.toHaveBeenCalled();
  act(() => renderer!.unmount()); renderer = undefined; expect(stops[1]).toHaveBeenCalledOnce();
});

it('a preference error stops observation even when a previous preference value is retained', async () => {
  const stops = enableObservation(); await mount();
  fixture.preferenceLoading = false; fixture.preferenceError = 'settings unavailable'; await updateRoot();
  expect(stops[0]).toHaveBeenCalledOnce();
  fixture.preferenceError = ''; fixture.preferenceLoading = true; await updateRoot();
  expect(fixture.observe).toHaveBeenCalledOnce();
});

function enableMarkerObservation() {
  fixture.markerObservation = 'observe';
  const stops: ReturnType<typeof vi.fn>[] = [];
  fixture.marker.mockImplementation((_owner: string, scope: StartupSessionCapability) => {
    let closed = false; const disposed = vi.fn(); stops.push(disposed);
    const stop = () => { if (!closed) { closed = true; disposed(); } };
    scope.onInvalidate(stop); return stop;
  });
  fixture.repository.observeStartupScheduleMarker = fixture.marker;
  return stops;
}
it('starts marker observation after preferences, overlaps profile, and retains it until all planner reads finish', async () => {
  const stops = enableMarkerObservation(); fixture.preferenceLoading = true;
  const profile = deferred<User | null>();
  fixture.profile.mockImplementation(() => { expect(fixture.marker).toHaveBeenCalledOnce(); return profile.promise; });
  await mount(); expect(fixture.marker).not.toHaveBeenCalled(); expect(fixture.profile).not.toHaveBeenCalled();
  fixture.preferenceLoading = false; await updateRoot(); expect(stops[0]).not.toHaveBeenCalled();
  await act(async () => { profile.resolve(owner('a')); await microtasks(); });
  expect(plansSpy).toHaveBeenCalledOnce(); expect(stops[0]).not.toHaveBeenCalled();
  await release(plannerGate); expect(stops[0]).toHaveBeenCalledOnce(); expect(splash()).toBe(1);
  await release(memoryGate); expect(splash()).toBe(0); expect(fixture.marker).toHaveBeenCalledOnce();
});
it.each(['error', 'null', 'mismatch'])('closes marker observation on profile %s without waiting for memory or an auth event', async result => {
  const stops = enableMarkerObservation();
  if (result === 'error') fixture.profile.mockRejectedValue(new Error('profile unavailable'));
  else fixture.profile.mockResolvedValue(result === 'null' ? null : owner('b'));
  await mount(); expect(stops[0]).toHaveBeenCalledOnce(); expect(plansSpy).not.toHaveBeenCalled();
  expect(splash()).toBe(1); expect(fixture.marker).toHaveBeenCalledOnce();
});
it('synchronously revokes the old marker observer on batched same-owner return and ignores stale profile settlement', async () => {
  const stops = enableMarkerObservation(), oldProfile = deferred<User | null>(), nextProfile = deferred<User | null>();
  fixture.profile.mockReturnValueOnce(oldProfile.promise).mockReturnValueOnce(nextProfile.promise);
  await mount();
  await act(async () => {
    fake.emit(null); expect(stops[0]).toHaveBeenCalledOnce();
    fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks();
  });
  expect(fixture.marker).toHaveBeenCalledTimes(2); expect(stops[1]).not.toHaveBeenCalled();
  await act(async () => { oldProfile.resolve(owner('a')); await microtasks(); });
  expect(stops[1]).not.toHaveBeenCalled(); expect(plansSpy).not.toHaveBeenCalled();
  await act(async () => { nextProfile.resolve(owner('a')); await microtasks(); });
  await release(plannerGate); expect(stops[1]).toHaveBeenCalledOnce();
});
it('an unavailable or failing optional marker port cannot fail normal startup', async () => {
  enableMarkerObservation(); fixture.marker.mockImplementation(() => { throw new Error('optional observer'); });
  await mount(); await release(plannerGate); await release(memoryGate);
  expect(splash()).toBe(0); expect(plansSpy).toHaveBeenCalledOnce();
});

it('retained preference values with an error cannot start or later restart marker observation', async () => {
  enableMarkerObservation(); fixture.preferenceError = 'settings unavailable';
  await mount(); expect(fixture.marker).not.toHaveBeenCalled();
  fixture.preferenceError = ''; await updateRoot(); expect(fixture.marker).not.toHaveBeenCalled();
  await release(plannerGate); await release(memoryGate); expect(splash()).toBe(0);
});
it('closes the observer when bootstrap rejects even if another planner read is still pending', async () => {
  const stops = enableMarkerObservation(), otherRead = deferred<any[]>();
  plansSpy.mockRejectedValue(new Error('plans unavailable'));
  fixture.repository.getMonthEvents = () => otherRead.promise;
  await mount(); expect(stops[0]).toHaveBeenCalledOnce();
  await release(memoryGate); expect(splash()).toBe(0);
  expect(fixture.content.mock.lastCall?.[0].notice?.text).toBe('plans unavailable');
  await act(async () => { otherRead.resolve([]); await microtasks(); });
  expect(fixture.marker).toHaveBeenCalledOnce(); expect(stops[0]).toHaveBeenCalledOnce();
});
