import { createAuthSessionService } from '../services/authSession';
import { PlannerAppBootstrap } from './PlannerAppBootstrap';
import { createStartupSessionScope } from '../lib/startupSessionScope';
import { createFirebaseAuthRepository } from '../repositories/firebaseAuthRepository';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LaplanceAppRoot } from './LaplanceAppRoot';
import { AuthScreen } from './AuthScreen';
import { SplashScreen } from './SplashScreen';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { createLocalFixture, deferred, MemoryStorage, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { User } from '../types/domain';
const semanticLifecycle = vi.hoisted(() => ({ ownerChanged: vi.fn(), connect: vi.fn(() => ({ publish: vi.fn(), dispose: vi.fn() })) }));
vi.mock('../features/userPlanningContext/semanticMemory/index/semanticMemoryApplication', () => ({ semanticMemoryApplication: semanticLifecycle }));
const fixture = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository,
  profile: vi.fn(), memory: vi.fn(), content: vi.fn(), observe: vi.fn(), observation: 'off', markerObservation: 'off', marker: vi.fn(),
  realApp: false, reducedMotion: true, policy: 'accepted', preferenceError: '', preferenceLoading: false, weekStartsOn: 'monday' as string | null }));
// This suite isolates planner/navigation behavior; streak persistence has its own provider integration tests.
vi.mock('./StudyStreakContext', () => ({
  StudyStreakProvider: ({ children }: { children: import('react').ReactNode }) => children,
  useSharedStudyStreak: () => null,
}));
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
  const { default: RealApp } = await vi.importActual<typeof import('../App')>('../App');
  const React = await import('react');
  const { usePlannerAppState } = await import('../hooks/usePlannerAppState');
  const { useRootStartupReady } = await import('./RootStartupReadyContext');
  const { useStartupContentVisible } = await import('./StartupSurface');
  function Probe({ state, onReady }: any) {
    const ready = useRootStartupReady();
    const visible = useStartupContentVisible();
    React.useEffect(() => { if (!state.booting) ready?.(); }, [state.booting, ready]);
    React.useEffect(() => { if (!state.booting && visible) onReady?.(); }, [state.booting, visible, onReady]);
    fixture.content(state);
    return <span data-testid="surface" data-visible={visible}>{state.notice?.text ?? 'ready'}</span>;
  }
  function Standalone() { const visible = useStartupContentVisible(); const state = usePlannerAppState({ noticeAutoDismiss: visible }); return <Probe state={state} />; }
  return { default: ({ state, onReady }: any) => fixture.realApp ? <RealApp state={state} onReady={onReady} /> : state ? <Probe state={state} onReady={onReady} /> : <Standalone /> };
});
vi.mock('../features/weeklyPlanning/application/useWeeklyPlanningApplication', () => ({
  useWeeklyPlanningApplication: () => ({ pendingDraftBlocks: [], canEditDraftBlocks: false }),
}));
vi.mock('../lib/preloadAppViews', () => ({ scheduleAppViewPreload: () => () => {} }));
const owner = (id: string): User => ({ id, username: id, email: `${id}@example.test`, avatar: '', createdAt: STAMP });
let renderer: ReactTestRenderer | undefined;
let fake: ReturnType<typeof createFakeAuthSession>;
let memoryGate: ReturnType<typeof deferred>;
let plannerGate: ReturnType<typeof deferred>;
let snapshotSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fixture.realApp = false; fixture.reducedMotion = true;
  vi.stubGlobal('window', { location: { pathname: '/' }, localStorage: new MemoryStorage(), setTimeout, clearTimeout,
    matchMedia: () => ({ matches: fixture.reducedMotion }) });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), hidden: false, documentElement: { dataset: {}, style: { setProperty: vi.fn() } } });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.clearAllMocks(); fixture.observation = 'off'; fixture.markerObservation = 'off'; fixture.marker.mockReset(); fixture.observe.mockReset(); fixture.policy = 'accepted'; fixture.preferenceError = ''; fixture.preferenceLoading = false; fixture.weekStartsOn = 'monday';
  fixture.repository = { ...createLocalFixture().repository }; sdk.read.mockReset(); sdk.write.mockReset(); sdk.persist.mockResolvedValue(undefined); sdk.write.mockResolvedValue(undefined);
  memoryGate = deferred(); plannerGate = deferred();
  fixture.memory.mockImplementation(async (_id, snapshot) => { await memoryGate.promise; return { snapshot, shared: true }; });
  fixture.profile.mockResolvedValue(owner('a'));
  snapshotSpy = vi.fn(async () => { await plannerGate.promise; return { plans: [], monthEvents: [] }; }); fixture.repository.getScheduleSnapshot = snapshotSpy;
  fake = createFakeAuthSession({ currentUser: { id: 'a', requiresEmailVerification: false } });
});
afterEach(async () => { await act(async () => { await vi.dynamicImportSettled(); }); act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount() { await act(async () => { renderer = create(<LaplanceAppRoot authSession={fake.session} />); await microtasks(); }); }
async function release(gate: ReturnType<typeof deferred>) { await act(async () => { gate.resolve(undefined); await microtasks(); }); }
const splash = () => renderer!.root.findAllByType(SplashScreen).length;

it('invalidates semantic work synchronously on account switch and sign-out, not same-owner events', async () => {
  await mount();
  act(() => fake.emit({ id: 'a', requiresEmailVerification: false }));
  expect(semanticLifecycle.ownerChanged).not.toHaveBeenCalled();
  act(() => {
    fake.emit({ id: 'b', requiresEmailVerification: false });
    expect(semanticLifecycle.ownerChanged).toHaveBeenCalledOnce();
    fake.emit(null);
    expect(semanticLifecycle.ownerChanged).toHaveBeenCalledTimes(2);
  });
});

it.each([true, false])('forgets leftover semantic indexes on first resolved sign-out (auth available: %s)', async available => {
  fake = createFakeAuthSession({ currentUser: null, available });
  fixture.profile.mockResolvedValue(null);
  await mount();
  if (available) {
    expect(semanticLifecycle.ownerChanged).not.toHaveBeenCalled();
    act(() => fake.emit(null));
  }
  expect(semanticLifecycle.ownerChanged).toHaveBeenCalledOnce();
  expect(semanticLifecycle.connect).not.toHaveBeenCalled();
  act(() => fake.emit(null));
  expect(semanticLifecycle.ownerChanged).toHaveBeenCalledOnce();
});

// Keep the actual auth repository and normalization/write path. All SDK calls
// are fail-closed local doubles; no Firebase service or production data is used.
const sdk = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), persist: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {}, setPersistence: (...args: unknown[]) => sdk.persist(...args),
  onAuthStateChanged: () => { throw new Error('Unexpected SDK auth subscription'); },
  signOut: (...args: unknown[]) => sdk.signOut(...args),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: (...args: unknown[]) => sdk.read(...args),
  setDoc: (...args: unknown[]) => sdk.write(...args),
  serverTimestamp: () => ({ syntheticTimestamp: true }),
  onSnapshot: () => { throw new Error('Unexpected profile observer'); },
}));
vi.mock('../lib/firebaseClient', () => ({ getFirestoreDb: () => null, getFirebaseAuth: () => null, createGoogleProvider: () => { throw new Error('Unexpected sign-in'); } }));
const sdkUser = (id = 'a') => ({ uid: id, email: `${id}@example.test`, displayName: id,
  emailVerified: true, providerData: [{ providerId: 'password' }], metadata: { creationTime: STAMP } });
const snapshot = (data: unknown) => ({ exists: () => data !== null, data: () => data,
  metadata: { fromCache: false, hasPendingWrites: false } });
function realRepository() {
  const live = { currentUser: sdkUser() };
  const repo = createFirebaseAuthRepository(live as unknown as Auth, {} as Firestore);
  fixture.profile.mockImplementation(() => repo.getCurrentUser());
  return live;
}
const recovery = () => renderer!.root.findByProps({ 'data-testid': 'profile-restore-recovery' });
const retry = () => recovery().findByType('button');
async function failRestore(phase: 'read' | 'repair' | 'create' = 'read') {
  const rejected = deferred<any>();
  if (phase === 'read') sdk.read.mockReturnValueOnce(rejected.promise);
  else {
    sdk.read.mockResolvedValueOnce(snapshot(phase === 'create' ? null : { ...owner('a'), username: ' a ' }));
    sdk.write.mockReturnValueOnce(rejected.promise);
  }
  await mount();
  await release(memoryGate);
  expect(splash()).toBe(1);
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  await act(async () => { rejected.reject(new Error('private restore failure')); await microtasks(); });
  expect(splash()).toBe(0);
  expect(fake.session.getCurrentUser()?.id).toBe('a');
  expect(snapshotSpy).not.toHaveBeenCalled();
}

it.each(['read', 'repair', 'create'] as const)('retains terminal %s failure and explicitly re-reads without replaying the old write', async phase => {
  realRepository(); await failRestore(phase);
  expect(recovery()).toBeDefined();
  expect(fixture.content.mock.lastCall?.[0].user ?? null).toBeNull();
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('private restore failure');
  sdk.read.mockResolvedValueOnce(snapshot({ ...owner('a'), username: 'Fresh A' }));
  await act(async () => { retry().props.onClick(); await microtasks(); });
  expect(recovery().props['aria-busy']).toBe(true);
  expect(sdk.read).toHaveBeenCalledTimes(2);
  expect(sdk.write).toHaveBeenCalledTimes(phase === 'read' ? 0 : 1);
  await release(plannerGate);
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  expect(fixture.content.mock.lastCall?.[0].user.username).toBe('Fresh A');
  expect(snapshotSpy).toHaveBeenCalledOnce();
});

it('keeps the failure beyond notice dismissal and same-owner auth events do not retry', async () => {
  vi.useFakeTimers(); window.setTimeout = setTimeout as any; window.clearTimeout = clearTimeout as any;
  realRepository(); await failRestore();
  const screen = recovery();
  await act(async () => { vi.advanceTimersByTime(10_000); fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
  expect(recovery()).toBe(screen);
  expect(retry().props.disabled).toBe(false);
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(sdk.read).toHaveBeenCalledOnce();
  expect(snapshotSpy).not.toHaveBeenCalled(); expect(sdk.signOut).not.toHaveBeenCalled();
});

it('admits one same-batch retry and keeps the same screen through pending profile and planner reads', async () => {
  realRepository(); await failRestore();
  const pending = deferred<any>(); sdk.read.mockReturnValueOnce(pending.promise);
  const screen = recovery(), retained = retry().props.onClick;
  await act(async () => { retained(); retained(); retained(); await microtasks(); });
  expect(sdk.read).toHaveBeenCalledTimes(2); expect(retry().props.disabled).toBe(true);
  expect(recovery()).toBe(screen); expect(splash()).toBe(0);
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  await act(async () => { retained(); pending.resolve(snapshot(owner('a'))); await microtasks(); });
  expect(recovery()).toBe(screen); expect(retry().props.disabled).toBe(true);
  expect(snapshotSpy).toHaveBeenCalledOnce();
  await act(async () => { retained(); await microtasks(); });
  expect(sdk.read).toHaveBeenCalledTimes(2);
  await release(plannerGate);
  await act(async () => { retained(); await microtasks(); });
  expect(sdk.read).toHaveBeenCalledTimes(2);
  expect(fixture.content.mock.lastCall?.[0].user.id).toBe('a');
});

it.each(['repair', 'create'] as const)('fresh retry retains the existing required %s path', async phase => {
  realRepository(); await failRestore('repair');
  const write = deferred<any>();
  sdk.read.mockResolvedValueOnce(snapshot(phase === 'create' ? null : { ...owner('a'), username: ' Current A ' }));
  sdk.write.mockReturnValueOnce(write.promise);
  await act(async () => { retry().props.onClick(); await microtasks(); });
  expect(sdk.read).toHaveBeenCalledTimes(2); expect(sdk.write).toHaveBeenCalledTimes(2);
  expect(sdk.write.mock.calls[1][1]).toMatchObject({ id: 'a', username: phase === 'create' ? 'a' : 'Current A' });
  expect(retry().props.disabled).toBe(true); expect(snapshotSpy).not.toHaveBeenCalled();
  await release(write); await release(plannerGate);
  expect(fixture.content.mock.lastCall?.[0].user.username).toBe(phase === 'create' ? 'a' : 'Current A');
});

it('retains repeat failure and only re-arms after the rejected retry settles', async () => {
  realRepository(); await failRestore();
  const rejected = deferred<any>(); sdk.read.mockReturnValueOnce(rejected.promise);
  const retained = retry().props.onClick;
  await act(async () => { retained(); retained(); await microtasks(); });
  expect(sdk.read).toHaveBeenCalledTimes(2);
  await act(async () => { rejected.reject(new Error('second private failure')); await microtasks(); });
  expect(retry().props.disabled).toBe(false); expect(snapshotSpy).not.toHaveBeenCalled();
  sdk.read.mockResolvedValueOnce(snapshot(owner('a')));
  await act(async () => { retry().props.onClick(); await microtasks(); });
  await release(plannerGate);
  expect(sdk.read).toHaveBeenCalledTimes(3); expect(snapshotSpy).toHaveBeenCalledOnce();
});

it.each(['read', 'repair', 'create'] as const)('does not expose recovery or restart an unresolved initial %s after 60 seconds', async phase => {
  vi.useFakeTimers(); window.setTimeout = setTimeout as any; window.clearTimeout = clearTimeout as any;
  realRepository(); const pending = deferred<any>();
  if (phase === 'read') sdk.read.mockReturnValueOnce(pending.promise);
  else {
    sdk.read.mockResolvedValueOnce(snapshot(phase === 'create' ? null : { ...owner('a'), username: ' a ' }));
    sdk.write.mockReturnValueOnce(pending.promise);
  }
  await mount(); await release(memoryGate);
  await act(async () => { vi.advanceTimersByTime(60_000); fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
  expect(splash()).toBe(1); expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(sdk.read).toHaveBeenCalledOnce();
  expect(sdk.write).toHaveBeenCalledTimes(phase === 'read' ? 0 : 1); expect(snapshotSpy).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(phase === 'read' ? snapshot(owner('a')) : undefined); await microtasks(); });
  await release(plannerGate);
  expect(splash()).toBe(0); expect(snapshotSpy).toHaveBeenCalledOnce();
});

it('keeps failed restoration behind memory and unfinished intro without replaying the intro on retry', async () => {
  fixture.reducedMotion = false;
  realRepository(); sdk.read.mockRejectedValueOnce(new Error('restore failed'));
  await mount();
  const video = renderer!.root.findByType('video');
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  expect(renderer!.root.findByType(SplashScreen).props.canSkip).toBe(false);
  await release(memoryGate);
  expect(recovery()).toBeDefined(); expect(splash()).toBe(1);
  expect(renderer!.root.findByType('video')).toBe(video);
  expect(renderer!.root.findByType(SplashScreen).props.canSkip).toBe(true);
  act(() => video.props.onEnded()); expect(splash()).toBe(0);
  sdk.read.mockResolvedValueOnce(snapshot(owner('a')));
  await act(async () => { retry().props.onClick(); await microtasks(); });
  expect(splash()).toBe(0); expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  await release(plannerGate); expect(splash()).toBe(0);
});

it.each(['b', null] as const)('revokes a retained retry before React commits owner %s', async id => {
  realRepository(); await failRestore();
  const retained = retry().props.onClick;
  fixture.profile.mockReturnValueOnce(deferred<User | null>().promise);
  await act(async () => { fake.emit(id ? { id, requiresEmailVerification: false } : null); retained(); await microtasks(); });
  // The new root may bootstrap, but the retired handler must not touch Firebase.
  expect(sdk.read).toHaveBeenCalledOnce(); expect(snapshotSpy).not.toHaveBeenCalled();
});

it('revokes a retained retry across batched A-to-null-to-A before commit', async () => {
  realRepository(); await failRestore();
  const retained = retry().props.onClick;
  sdk.read.mockResolvedValueOnce(snapshot({ ...owner('a'), username: 'New session' }));
  await act(async () => { fake.emit(null); fake.emit({ id: 'a', requiresEmailVerification: false }); retained(); await microtasks(); });
  await release(plannerGate);
  expect(sdk.read).toHaveBeenCalledTimes(2); expect(fixture.content.mock.lastCall?.[0].user.username).toBe('New session');
});

it.each(['success', 'failure'] as const)('discards old retry %s across batched A-to-B-to-A', async outcome => {
  const live = realRepository(); await failRestore();
  const pending = deferred<any>(); sdk.read.mockReturnValueOnce(pending.promise);
  await act(async () => { retry().props.onClick(); await microtasks(); });
  sdk.read.mockResolvedValueOnce(snapshot({ ...owner('a'), username: 'New A' }));
  await act(async () => {
    live.currentUser = sdkUser('b'); fake.emit({ id: 'b', requiresEmailVerification: false });
    live.currentUser = sdkUser(); fake.emit({ id: 'a', requiresEmailVerification: false });
    if (outcome === 'success') pending.resolve(snapshot({ ...owner('a'), username: 'Old A' }));
    else pending.reject(new Error('retired failure'));
    await microtasks();
  });
  await release(plannerGate);
  expect(sdk.read).toHaveBeenCalledTimes(3); expect(snapshotSpy).toHaveBeenCalledOnce();
  expect(fixture.content.mock.lastCall?.[0].user.username).toBe('New A');
  expect(fixture.content.mock.lastCall?.[0].notice).toBeNull();
});

it.each(['success', 'failure'] as const)('discards retry %s and retained admission after unmount', async outcome => {
  realRepository(); await failRestore();
  const pending = deferred<any>(); sdk.read.mockReturnValueOnce(pending.promise);
  const retained = retry().props.onClick;
  await act(async () => { retained(); await microtasks(); });
  act(() => renderer!.unmount()); renderer = undefined;
  const prior = fixture.content.mock.calls.length;
  await act(async () => {
    retained();
    if (outcome === 'success') pending.resolve(snapshot(owner('a'))); else pending.reject(new Error('old failure'));
    await microtasks();
  });
  expect(sdk.read).toHaveBeenCalledTimes(2); expect(snapshotSpy).not.toHaveBeenCalled();
  expect(fixture.content).toHaveBeenCalledTimes(prior);
});

it('requires the matching live identity in addition to an unrevoked root scope', async () => {
  realRepository(); await failRestore();
  const retained = retry().props.onClick;
  const current = vi.spyOn(fake.session, 'getCurrentUser').mockReturnValue({ id: 'b', requiresEmailVerification: false });
  await act(async () => { retained(); await microtasks(); });
  expect(sdk.read).toHaveBeenCalledOnce(); expect(retry().props.disabled).toBe(false);
  current.mockRestore();
  sdk.read.mockResolvedValueOnce(snapshot(owner('a')));
  await act(async () => { retained(); await microtasks(); }); await release(plannerGate);
  expect(sdk.read).toHaveBeenCalledTimes(2);
});

it('leaves planner failure after successful profile retry to existing planner recovery', async () => {
  realRepository(); await failRestore();
  sdk.read.mockResolvedValueOnce(snapshot(owner('a')));
  snapshotSpy.mockRejectedValueOnce(new Error('planner read failed'));
  await act(async () => { retry().props.onClick(); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  const state = fixture.content.mock.lastCall?.[0];
  expect(state.user.id).toBe('a'); expect(state.profileRestoreRecovery).toBeNull();
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(state.notice.text).toBe('planner read failed');
});

it('keeps ordinary null-user startup and genuine sign-out out of profile recovery', async () => {
  fixture.profile.mockResolvedValue(null);
  await mount(); await release(memoryGate);
  expect(splash()).toBe(0); expect(fixture.content.mock.lastCall?.[0].user).toBeNull();
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  await act(async () => { fake.emit(null); await microtasks(); });
  expect(fixture.content.mock.lastCall?.[0].user).toBeNull(); expect(snapshotSpy).not.toHaveBeenCalled();
});


it('the real App and AuthScreen are not mounted after authenticated failure, but signed-out startup still offers registration', async () => {
  fixture.realApp = true;
  realRepository(); await failRestore();
  expect(recovery()).toBeDefined();
  expect(renderer!.root.findAllByType(AuthScreen)).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ role: 'tablist', 'aria-label': '認証モード' })).toHaveLength(0);
  fixture.profile.mockResolvedValueOnce(null);
  await act(async () => { fake.emit(null); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  expect(renderer!.root.findAllByType(AuthScreen)).toHaveLength(1);
  expect(renderer!.root.findByProps({ role: 'tab', 'data-intent': 'sign-in' }).props['aria-selected']).toBe(true);
  expect(renderer!.root.findByProps({ role: 'tab', 'data-intent': 'sign-up' }).props['aria-selected']).toBe(false);
});


it.each(['neither', 'scope-only', 'auth-only'] as const)('preserves standalone bootstrap when optional session ports are %s', async ports => {
  const options = ports === 'scope-only' ? { startupScope: createStartupSessionScope() }
    : ports === 'auth-only' ? { authSession: fake.session } : {};
  let state: any;
  await act(async () => {
    renderer = create(<PlannerAppBootstrap ownerId="a" {...options}>{value => { state = value; return null; }}</PlannerAppBootstrap>);
    await microtasks();
  });
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(snapshotSpy).toHaveBeenCalledOnce();
  await release(plannerGate);
  expect(state.booting).toBe(false); expect(state.user.id).toBe('a'); expect(state.profileRestoreRecovery).toBeNull();
});


it.each([
  { mode: 'light', accent: '#2f6fc2' },
  { mode: 'dark', accent: '#6fb2ff' },
])('restores saved $mode/ocean on the cold failure surface before App ever mounts', async ({ mode, accent }) => {
  window.localStorage.setItem('study-planner-theme-mode', mode);
  window.localStorage.setItem('study-planner-theme-palette', 'ocean');
  realRepository(); sdk.read.mockRejectedValueOnce(new Error('cold profile failure'));
  await mount();
  expect(fixture.content).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  await release(memoryGate);
  expect(recovery()).toBeDefined();
  expect(fixture.content).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe(mode);
  expect(document.documentElement.style.setProperty).toHaveBeenCalledWith('--accent', accent);
  expect(window.localStorage.getItem('study-planner-theme-mode')).toBe(mode);
  expect(window.localStorage.getItem('study-planner-theme-palette')).toBe('ocean');
});


function installPublicHistory(pathname = '/contact') {
  const listeners = new Map<string, Set<() => void>>();
  const location = { pathname };
  const dispatch = (type: string) => { [...listeners.get(type) ?? []].forEach(listener => listener()); };
  vi.stubGlobal('HTMLElement', class {});
  Object.assign(window, { location,
    history: { state: null, pushState: (_state: unknown, _title: string, path: string) => { location.pathname = path; } },
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => listeners.get(type)?.delete(listener),
    dispatchEvent: (event: Event) => dispatch(event.type),
  });
  vi.mocked(createAuthSessionService).mockReturnValue(fake.session);
  return { pop(path: string) { location.pathname = path; dispatch('popstate'); }, listeners };
}
async function returnFromPublicPage() {
  await act(async () => {
    renderer!.root.findAllByType('a').find(link => link.props.href === '/')!.props.onClick({ button: 0, preventDefault: vi.fn() });
    await microtasks();
  });
}

it.each(['read', 'write'] as const)('composes direct contact, theme %s failure and retained profile recovery without duplicate startup', async failure => {
  const history = installPublicHistory();
  window.localStorage.setItem('study-planner-theme-mode', 'dark');
  window.localStorage.setItem('study-planner-theme-palette', 'ocean');
  const read = window.localStorage.getItem.bind(window.localStorage);
  const write = window.localStorage.setItem.bind(window.localStorage);
  const reads = vi.spyOn(window.localStorage, 'getItem').mockImplementation(key => {
    if (failure === 'read' && key.startsWith('study-planner-theme-')) throw new Error('blocked theme read');
    return read(key);
  });
  vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
    if (failure === 'write' && key.startsWith('study-planner-theme-')) throw new Error('blocked theme write');
    write(key, value);
  });
  fixture.profile.mockRejectedValueOnce(new Error('profile unavailable'));
  await mount();
  expect(fixture.profile).not.toHaveBeenCalled();
  expect(snapshotSpy).not.toHaveBeenCalled(); expect(splash()).toBe(0);
  expect(renderer!.root.findAllByType('h1').map(heading => heading.children.join(''))).toContain('お問い合わせ');
  expect(document.documentElement.dataset.theme).toBe(failure === 'read' ? 'light' : 'dark');
  expect(read('study-planner-theme-mode')).toBe('dark');
  await returnFromPublicPage(); await release(memoryGate);
  const retained = recovery();
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(snapshotSpy).not.toHaveBeenCalled();
  const readsAfterRecovery = reads.mock.calls.length;
  await act(async () => { history.pop('/contact'); await microtasks(); });
  expect(recovery()).toBe(retained);
  expect(renderer!.root.findByProps({ className: 'public-page-planner' }).props.hidden).toBe(true);
  await returnFromPublicPage();
  expect(recovery()).toBe(retained); expect(fixture.profile).toHaveBeenCalledOnce();
  expect(reads).toHaveBeenCalledTimes(readsAfterRecovery);
  expect(read('study-planner-theme-mode')).toBe('dark');
});

it('settles a pending recovery behind contact and revokes its old callback on hidden sign-out', async () => {
  const history = installPublicHistory('/');
  fixture.profile.mockRejectedValueOnce(new Error('profile unavailable'));
  await mount(); await release(memoryGate);
  const retainedRetry = retry().props.onClick;
  const pending = deferred<User>(); fixture.profile.mockReturnValueOnce(pending.promise);
  await act(async () => { retainedRetry(); retainedRetry(); await microtasks(); });
  expect(fixture.profile).toHaveBeenCalledTimes(2);
  await act(async () => { history.pop('/contact'); await microtasks(); });
  await act(async () => { pending.resolve(owner('a')); await microtasks(); });
  expect(recovery().props['aria-busy']).toBe(true);
  expect(snapshotSpy).toHaveBeenCalledOnce();
  await release(plannerGate);
  expect(renderer!.root.findAllByProps({ 'data-testid': 'profile-restore-recovery' })).toHaveLength(0);
  expect(fixture.content.mock.lastCall?.[0].user.id).toBe('a');
  // The repository must reflect the same sign-out as the auth event.
  fixture.profile.mockResolvedValue(null);
  await act(async () => { fake.emit(null); await microtasks(); retainedRetry(); await microtasks(); });
  expect(fixture.content.mock.lastCall?.[0].user).toBeNull();
  await returnFromPublicPage();
  expect(fixture.content.mock.lastCall?.[0].user).toBeNull();
  expect(fixture.profile).toHaveBeenCalledTimes(3); // The ordinary signed-out bootstrap, never the stale retry.
  act(() => renderer!.unmount()); renderer = undefined;
  expect([...history.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});
