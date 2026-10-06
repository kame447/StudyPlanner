import { StartupSchedulePreview } from './StartupSchedulePreview';
import { readStartupSchedulePreview, saveStartupSchedulePreview } from '../lib/startupSchedulePreview';
import { plan } from '../repositories/localPersistenceConcurrency.testUtils';
import { todayIsoDate } from '../lib/date';
import { createPlanDraftFromPlan } from '../domain/planner';
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
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
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

function seedPreview(id = 'a') {
  saveStartupSchedulePreview({ ownerId: id, plans: [plan({ userId: id, date: todayIsoDate(), title: `Cached ${id}` })],
    monthEvents: [], scheduleTemplates: [], timetableTerms: [] });
}
const previews = () => renderer!.root.findAllByType(StartupSchedulePreview);
it('shows cached schedules without mounting App until both authoritative gates complete', async () => {
  seedPreview(); await mount();
  expect(previews()).toHaveLength(1); expect(splash()).toBe(0); expect(fixture.content).not.toHaveBeenCalled();
  await release(memoryGate); expect(previews()).toHaveLength(1); expect(fixture.content).not.toHaveBeenCalled();
  await release(plannerGate); expect(previews()).toHaveLength(0); expect(fixture.content).toHaveBeenCalled();
  expect(readStartupSchedulePreview('a')?.rows).toEqual([]);
});
it.each(['required', 'unavailable', 'preference-loading', 'preference-missing'])('does not bypass %s with a stored preview', async gate => {
  seedPreview();
  if (gate.startsWith('preference')) { fixture.preferenceLoading = gate.endsWith('loading'); fixture.weekStartsOn = gate.endsWith('missing') ? null : 'monday'; }
  else fixture.policy = gate;
  await mount(); expect(previews()).toHaveLength(0); expect(plansSpy).not.toHaveBeenCalled();
});
it('keeps failed current-data startup read-only and does not replace its prior copy', async () => {
  seedPreview(); await mount(); await release(memoryGate);
  await act(async () => { plannerGate.reject(new Error('load failed')); await microtasks(); });
  expect(previews()).toHaveLength(1); expect(previews()[0].props.failed).toBe(true);
  expect(fixture.content).not.toHaveBeenCalled();
  expect(readStartupSchedulePreview('a')?.rows[0].title).toBe('Cached a');
});
it('cache removal in another tab cannot mount App while the current read is pending', async () => {
  const listeners: (() => void)[] = [];
  Object.assign(window, { addEventListener: (event: string, listener: () => void) => { if (event === 'storage') listeners.push(listener); }, removeEventListener: vi.fn() });
  seedPreview(); await mount(); await release(memoryGate);
  act(() => { window.localStorage.clear(); listeners.forEach(listener => listener()); });
  expect(previews()).toHaveLength(0); expect(splash()).toBe(1); expect(fixture.content).not.toHaveBeenCalled();
  await act(async () => { plannerGate.reject(new Error('load failed')); await microtasks(); });
  expect(previews()[0].props.failed).toBe(true); expect(fixture.content).not.toHaveBeenCalled();
});
it('revokes stored copies and old captures across batched signout and same-owner return', async () => {
  seedPreview(); await mount(); const oldMemory = memoryGate, oldPlanner = plannerGate;
  memoryGate = deferred(); plannerGate = deferred();
  await act(async () => { fake.emit(null); fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
  expect(readStartupSchedulePreview('a')).toBeNull(); expect(previews()).toHaveLength(0);
  await release(oldMemory); await release(oldPlanner);
  expect(readStartupSchedulePreview('a')).toBeNull();
  await release(memoryGate); await release(plannerGate);
  expect(readStartupSchedulePreview('a')).not.toBeNull();
});
it('does not cache optimistic edits that later fail', async () => {
  await mount(); await release(memoryGate); await release(plannerGate);
  const initial = readStartupSchedulePreview('a'); expect(initial?.rows).toEqual([]);
  const write = deferred<any>(); fixture.repository.upsertPlan = vi.fn(() => write.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.content.mock.lastCall![0].savePlanDraft(createPlanDraftFromPlan(plan({ userId: 'a', date: todayIsoDate(), title: 'Uncommitted' }))); pending.catch(() => {}); });
  expect(readStartupSchedulePreview('a')).toEqual(initial);
  await act(async () => { write.reject(new Error('write failed')); try { await pending; } catch {} await microtasks(); });
  expect(readStartupSchedulePreview('a')).toEqual(initial);
  expect(previews()).toHaveLength(0);
});
