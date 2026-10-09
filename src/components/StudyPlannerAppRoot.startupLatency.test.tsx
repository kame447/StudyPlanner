import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyPlannerAppRoot } from './StudyPlannerAppRoot';
import { SplashScreen } from './SplashScreen';
import { StartupSurface } from './StartupSurface';
import { InitialPrivacyConsentScreen } from './InitialPrivacyConsentScreen';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { createLocalFixture, deferred, MemoryStorage, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import { PERSONALIZATION_READ_TIMEOUT_MS } from '../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile';
import { WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS } from '../features/weeklyPlanning/trace/weeklyPlanningTracePrivacyClient';
import { createStartupTimingRecorder } from '../lib/startupTiming';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { User } from '../types/domain';

const fixture = vi.hoisted(() => ({
  repository: null as unknown as PlannerRepository,
  profile: vi.fn(), memory: vi.fn(), preferences: vi.fn(), token: vi.fn(), fetch: vi.fn(), content: vi.fn(),
  clock: null as unknown as ReturnType<typeof createStartupTimingRecorder>,
}));
vi.mock('../repositories', () => ({ authRepository: { getCurrentUser: fixture.profile }, get plannerRepository() { return fixture.repository; } }));
vi.mock('../data/naturalLanguageCatalog', () => ({ loadNaturalLanguageCatalogWithOutcome: vi.fn(async () => ({ source: 'server' })) }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: { uid: 'a', getIdToken: fixture.token } }), getFirestoreDb: () => null }));
vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://trace.example.test' }));
vi.mock('../lib/startupProfileObservation', () => ({ startupProfileObservation: 'off' }));
vi.mock('../lib/startupMarkerObservation', () => ({ startupMarkerObservation: 'off' }));
vi.mock('../lib/startupTiming', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/startupTiming')>(),
  startupTiming: {
    begin: (...args: Parameters<typeof fixture.clock.begin>) => fixture.clock.begin(...args),
    measure: (phase: Parameters<typeof fixture.clock.begin>[0], action: () => Promise<unknown>) => fixture.clock.measure(phase, action),
    markOnce: (...args: Parameters<typeof fixture.clock.markOnce>) => fixture.clock.markOnce(...args),
  },
}));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => true }));
vi.mock('../features/weeklyPlanning/trace/weeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceEnabled: () => true }));
vi.mock('../features/weeklyPlanning/personalization/weeklyPlanningPersonalizationRepository', () => ({
  getWeeklyPlanningPersonalizationRepository: () => ({ getProfile: fixture.preferences }),
}));
vi.mock('../features/userPlanningContext/userPlanningContextRepository', () => ({ getUserPlanningContextRepositoryV1: () => ({
  initialize: fixture.memory, subscribe: () => () => {},
}) }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({ getWeeklyPlanningApprovalPlanRepository: () => ({}) }));
// Keep real consent HTTP client/hook, preference hook, root, memory provider,
// profile and planner bootstrap. This measures the React-ready boundary, not
// asset download, browser paint, real Firebase latency, or a working Home UI.
vi.mock('../App', async () => {
  const { usePlannerAppState } = await import('../hooks/usePlannerAppState');
  const { useRootStartupReady } = await import('./RootStartupReadyContext');
  function Probe({ state, onReady }: any) {
    const ready = useRootStartupReady();
    useEffect(() => {
      if (!state.booting) { fixture.content(Date.now()); ready?.(); onReady?.(); }
    }, [state.booting, ready, onReady]);
    return <span data-testid="ready-probe">{state.booting ? 'loading' : 'ready'}</span>;
  }
  function Standalone() { const state = usePlannerAppState(); return <Probe state={state} />; }
  return { default: ({ state, onReady }: any) => state ? <Probe state={state} onReady={onReady} /> : <Standalone /> };
});

const owner: User = { id: 'a', username: 'a', email: 'a@example.test', avatar: '', createdAt: STAMP };
const accepted = { policyVersion: '2026-07-18-v1', accepted: true, acceptedAt: STAMP };
const savedPreferences = { weekStartsOn: { value: 'monday' } };
let renderer: ReactTestRenderer | undefined;
let fake: ReturnType<typeof createFakeAuthSession>;
let plannerReads: ReturnType<typeof vi.fn>[];
let requests: { phase: string; time: number }[];
function latency<T>(phase: string, milliseconds: number, value: T): Promise<T> {
  requests.push({ phase, time: Date.now() });
  return milliseconds === 0 ? Promise.resolve(value) : new Promise(resolve => setTimeout(() => resolve(value), milliseconds));
}
function configureDelays({ token = 0, policy = 0, preferences = 0, profile = 0, memory = 0, planner = 0 }) {
  fixture.token.mockImplementation(() => latency('token', token, 'fixture-token'));
  fixture.fetch.mockImplementation(() => latency('policy', policy, new Response(JSON.stringify(accepted))));
  fixture.preferences.mockImplementation(() => latency('preferences', preferences, savedPreferences));
  fixture.profile.mockImplementation(() => latency('profile', profile, owner));
  fixture.memory.mockImplementation((_owner, snapshot) => latency('memory', memory, { snapshot, shared: true }));
  const methods = ['getActuals', 'getDayNotes', 'getTodos', 'getStudySubjects', 'getStudyMaterials', 'getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods'] as const;
  plannerReads = methods.map(method => {
    const read = vi.fn(() => latency(method, planner, []));
    fixture.repository[method] = read;
    return read;
  });
  const schedule = vi.fn(() => latency('getScheduleSnapshot', planner, { plans: [], monthEvents: [] }));
  fixture.repository.getScheduleSnapshot = schedule;
  plannerReads.push(schedule);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); requests = [];
  vi.stubGlobal('window', { location: { pathname: '/' }, localStorage: new MemoryStorage(), setTimeout, clearTimeout });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', fixture.fetch);
  fixture.clock = createStartupTimingRecorder(true, () => Date.now());
  fixture.repository = { ...createLocalFixture().repository };
  fake = createFakeAuthSession();
  configureDelays({});
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(completeIntro = true) {
  await act(async () => { renderer = create(<StudyPlannerAppRoot authSession={fake.session} />); await microtasks(); });
  // Most cases isolate data readiness after a genuinely completed intro.
  // The combined cases below retain the video and assert the separate gate.
  if (completeIntro) act(() => renderer!.root.findByType('video').props.onEnded());
}
async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); await microtasks(); });
}
async function authenticate(milliseconds = 0) {
  await advance(milliseconds);
  await act(async () => { fake.emit({ id: 'a', requiresEmailVerification: false }); await microtasks(); });
}
const splash = () => renderer!.root.findAllByType(SplashScreen).length;
const appLoading = () => renderer!.root.findByType(StartupSurface).props.loading as boolean;

it.each([
  { name: 'cold-client synthetic delays', auth: 120, token: 180, policy: 700, preferences: 400, profile: 600, memory: 900, planner: 800 },
  { name: 'warm-client synthetic delays', auth: 10, token: 10, policy: 80, preferences: 30, profile: 40, memory: 90, planner: 60 },
])('isolates serial gates and already-parallel reads: $name', async delays => {
  configureDelays(delays);
  await mount(); await authenticate(delays.auth);
  const consentMs = delays.token + delays.policy;
  await advance(delays.token); await advance(delays.policy);
  expect(fixture.preferences).toHaveBeenCalledOnce();
  expect(fixture.profile).not.toHaveBeenCalled();
  await advance(delays.preferences);
  expect(fixture.profile).toHaveBeenCalledOnce(); expect(fixture.memory).toHaveBeenCalledOnce();
  plannerReads.forEach(read => expect(read).not.toHaveBeenCalled());
  await advance(delays.profile);
  plannerReads.forEach(read => expect(read).toHaveBeenCalledOnce());
  const readyAt = delays.auth + consentMs + delays.preferences + Math.max(delays.memory, delays.profile + delays.planner);
  await advance(readyAt - Date.now() - 1);
  expect(splash()).toBe(1);
  await advance(1);
  expect(splash()).toBe(0); expect(fixture.content).toHaveBeenCalledWith(readyAt);
  const spans = fixture.clock.getSnapshot();
  expect(spans.find(row => row.phase === 'auth-session')?.durationMs).toBe(delays.auth);
  expect(spans.find(row => row.phase === 'consent')?.durationMs).toBe(consentMs);
  expect(spans.find(row => row.phase === 'preferences')?.durationMs).toBe(delays.preferences);
  expect(spans.find(row => row.phase === 'profile')?.durationMs).toBe(delays.profile);
  expect(spans.find(row => row.phase === 'memory')?.durationMs).toBe(delays.memory);
  expect(spans.find(row => row.phase === 'bootstrap')?.durationMs).toBe(delays.profile + delays.planner);
  expect(new Set(requests.filter(row => row.phase.startsWith('get')).map(row => row.time)).size).toBe(1);
});

it.each(['token', 'response', 'body'] as const)('bounds an independent consent %s wait without granting consent or starting planner reads', async phase => {
  const pending = deferred<any>();
  if (phase === 'token') fixture.token.mockReturnValue(pending.promise);
  else fixture.token.mockResolvedValue('fixture-token');
  if (phase === 'response') fixture.fetch.mockReturnValue(pending.promise);
  if (phase === 'body') fixture.fetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: () => pending.promise });
  await mount(); await authenticate(); await advance(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS - 1);
  expect(splash()).toBe(1);
  await advance(1);
  expect(splash()).toBe(0);
  expect(fixture.preferences).not.toHaveBeenCalled(); expect(fixture.profile).not.toHaveBeenCalled();
  expect(fixture.memory).not.toHaveBeenCalled(); plannerReads.forEach(read => expect(read).not.toHaveBeenCalled());
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(true);
  expect(fixture.clock.getSnapshot().find(row => row.phase === 'consent')).toMatchObject({
    durationMs: WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS, outcome: 'error',
  });
  const callsAtTimeout = fixture.fetch.mock.calls.length;
  if (phase !== 'token') expect(fixture.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(phase === 'token' ? 'late-token' : phase === 'response' ? new Response(JSON.stringify(accepted)) : accepted);
    await microtasks();
  });
  expect(fixture.fetch).toHaveBeenCalledTimes(callsAtTimeout);
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(true);
  expect(fixture.preferences).not.toHaveBeenCalled();
});


it('only a fresh successful retry resumes ordinary startup after a timeout', async () => {
  const oldResponse = deferred<Response>();
  fixture.fetch.mockReturnValueOnce(oldResponse.promise);
  await mount(); await authenticate(); await advance(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS);
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(true);
  const retry = renderer!.root.findByType(InitialPrivacyConsentScreen).props.onRetry;
  await act(async () => { await retry(); await microtasks(); });
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
  expect(splash()).toBe(0);
  expect(fixture.profile).toHaveBeenCalledOnce(); plannerReads.forEach(read => expect(read).toHaveBeenCalledOnce());
  expect(fixture.content).toHaveBeenCalled();
  await act(async () => { oldResponse.resolve(new Response(JSON.stringify({ ...accepted, accepted: false }))); await microtasks(); });
  expect(renderer!.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(0);
  expect(fixture.profile).toHaveBeenCalledOnce();
});

it.each(['b', 'a'])('retires the old consent request on an owner/session transition to %s', async nextOwner => {
  const oldResponse = deferred<Response>(), nextResponse = deferred<Response>();
  fixture.fetch.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(nextResponse.promise);
  await mount(); await authenticate();
  const oldSignal = fixture.fetch.mock.calls[0][1].signal as AbortSignal;
  await act(async () => {
    if (nextOwner === 'a') fake.emit(null);
    fake.emit({ id: nextOwner, requiresEmailVerification: false }); await microtasks();
  });
  expect(oldSignal.aborted).toBe(true); expect(fixture.fetch).toHaveBeenCalledTimes(2);
  await act(async () => { oldResponse.resolve(new Response(JSON.stringify(accepted))); await microtasks(); });
  expect(splash()).toBe(1); expect(fixture.preferences).not.toHaveBeenCalled();
  await act(async () => { nextResponse.resolve(new Response(JSON.stringify({ ...accepted, accepted: false }))); await microtasks(); });
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(false);
  expect(fixture.profile).not.toHaveBeenCalled(); plannerReads.forEach(read => expect(read).not.toHaveBeenCalled());
});

it('aborts a pending policy request and releases its deadline on root unmount', async () => {
  fixture.fetch.mockReturnValue(deferred<Response>().promise);
  await mount(); await authenticate();
  const signal = fixture.fetch.mock.calls[0][1].signal as AbortSignal;
  await act(async () => { renderer!.unmount(); renderer = undefined; await microtasks(); });
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});


it('shows a waiting surface throughout a retry and returns to recovery if the retry also stalls', async () => {
  fixture.fetch.mockImplementation(() => deferred<Response>().promise);
  await mount(); await authenticate(); await advance(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS);
  const retry = renderer!.root.findByType(InitialPrivacyConsentScreen).props.onRetry;
  let retryResult!: Promise<void>;
  await act(async () => { retryResult = retry(); await microtasks(); });
  expect(splash()).toBe(1);
  expect(renderer!.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(0);
  await advance(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS);
  await retryResult;
  expect(splash()).toBe(0);
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(true);
  expect(fixture.preferences).not.toHaveBeenCalled(); expect(fixture.content).not.toHaveBeenCalled();
});

it.each(['success', 'failure'] as const)('keeps preference retry visible until %s without bypassing bootstrap', async outcome => {
  const pending = deferred<typeof savedPreferences>();
  fixture.preferences.mockRejectedValueOnce(new Error('settings unavailable')).mockReturnValueOnce(pending.promise);
  await mount(); await authenticate();
  expect(splash()).toBe(0);
  const retry = renderer!.root.findByType(InitialWeekStartPreferenceScreen).props.onRetry;
  let result!: Promise<void>;
  await act(async () => { result = retry(); await microtasks(); });
  await advance(PERSONALIZATION_READ_TIMEOUT_MS - 1);
  expect(splash()).toBe(1);
  expect(renderer!.root.findAllByType(InitialWeekStartPreferenceScreen)).toHaveLength(0);
  expect(fixture.profile).not.toHaveBeenCalled();
  expect(fixture.content).not.toHaveBeenCalled();
  plannerReads.forEach(read => expect(read).not.toHaveBeenCalled());
  await act(async () => {
    if (outcome === 'success') pending.resolve(savedPreferences);
    else pending.reject(new Error('settings retry unavailable'));
    await result; await microtasks();
  });
  expect(splash()).toBe(0);
  if (outcome === 'success') {
    expect(fixture.content).toHaveBeenCalled();
    plannerReads.forEach(read => expect(read).toHaveBeenCalledOnce());
  } else {
    expect(renderer!.root.findByType(InitialWeekStartPreferenceScreen).props.error).toBe('settings retry unavailable');
    expect(fixture.profile).not.toHaveBeenCalled();
    expect(fixture.content).not.toHaveBeenCalled();
  }
});


// Combined full-length intro + read-load contract: real policy hook/client.
it.each(['ended', 'error'] as const)('media %s cannot release the real policy timeout, retry, or schedule snapshot gates', async event => {
  const oldResponse = deferred<Response>();
  const retryResponse = deferred<Response>();
  const schedule = deferred<{ plans: never[]; monthEvents: never[] }>();
  fixture.fetch.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(retryResponse.promise);
  fixture.repository.getScheduleSnapshot = vi.fn(() => schedule.promise);
  await mount(false); await authenticate();
  expect(renderer!.root.findAllByType('video')).toHaveLength(1);
  act(() => renderer!.root.findByType('video').props[event === 'ended' ? 'onEnded' : 'onError']());
  expect(splash()).toBe(1); expect(appLoading()).toBe(true);
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(fixture.preferences).not.toHaveBeenCalled();
  await advance(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS);
  expect(splash()).toBe(0);
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(true);
  expect(fixture.repository.getScheduleSnapshot).not.toHaveBeenCalled();
  const retry = renderer!.root.findByType(InitialPrivacyConsentScreen).props.onRetry;
  let retryResult!: Promise<void>;
  await act(async () => { retryResult = retry(); await microtasks(); });
  expect(splash()).toBe(1); expect(appLoading()).toBe(true);
  // A retry restores pending presentation, not a second intro playback.
  expect(renderer!.root.findAllByType('video')).toHaveLength(0);
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
  expect(fixture.content).not.toHaveBeenCalled();
  await act(async () => { retryResponse.resolve(new Response(JSON.stringify(accepted))); await retryResult; await microtasks(); });
  expect(splash()).toBe(1); expect(appLoading()).toBe(true);
  expect(fixture.repository.getScheduleSnapshot).toHaveBeenCalledExactlyOnceWith('a');
  expect(fixture.content).not.toHaveBeenCalled();
  await act(async () => { oldResponse.resolve(new Response(JSON.stringify({ ...accepted, accepted: false }))); await microtasks(); });
  expect(splash()).toBe(1);
  expect(renderer!.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(0);
  await act(async () => { schedule.resolve({ plans: [], monthEvents: [] }); await microtasks(); });
  expect(splash()).toBe(0); expect(appLoading()).toBe(false);
  expect(fixture.content).toHaveBeenCalled();
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
});

it.each(['ended', 'skip'] as const)('real policy and snapshot readiness preserve healthy playback until %s', async completion => {
  const policy = deferred<Response>();
  const schedule = deferred<{ plans: never[]; monthEvents: never[] }>();
  fixture.fetch.mockReturnValueOnce(policy.promise);
  fixture.repository.getScheduleSnapshot = vi.fn(() => schedule.promise);
  await mount(false); await authenticate();
  const video = renderer!.root.findByType('video');
  const pendingButton = renderer!.root.findByProps({ 'aria-label': '起動アニメーション' });
  expect(pendingButton.props.disabled).toBe(true);
  act(() => pendingButton.props.onClick());
  expect(renderer!.root.findByType('video')).toBe(video);
  expect(appLoading()).toBe(true); expect(fixture.preferences).not.toHaveBeenCalled();
  await act(async () => { policy.resolve(new Response(JSON.stringify(accepted))); await microtasks(); });
  expect(fixture.repository.getScheduleSnapshot).toHaveBeenCalledExactlyOnceWith('a');
  expect(fixture.content).not.toHaveBeenCalled();
  expect(renderer!.root.findByType(SplashScreen).props.canSkip).toBe(false);
  expect(renderer!.root.findByType('video')).toBe(video);
  await act(async () => { schedule.resolve({ plans: [], monthEvents: [] }); await microtasks(); });
  expect(appLoading()).toBe(false); expect(fixture.content).toHaveBeenCalled();
  expect(splash()).toBe(1); expect(renderer!.root.findByType('video')).toBe(video);
  const readyButton = renderer!.root.findByProps({ 'aria-label': '起動アニメーションをスキップ' });
  expect(readyButton.props.disabled).toBe(false);
  act(() => completion === 'ended' ? video.props.onEnded() : readyButton.props.onClick());
  expect(splash()).toBe(0); expect(appLoading()).toBe(false);
  expect(fixture.repository.getScheduleSnapshot).toHaveBeenCalledOnce();
});

it.each(['a', 'b'])('early media gestures cannot revive retired policy readiness after a session transition to %s', async nextOwner => {
  const oldResponse = deferred<Response>(), nextResponse = deferred<Response>();
  fixture.fetch.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(nextResponse.promise);
  await mount(false); await authenticate();
  const video = renderer!.root.findByType('video');
  act(() => renderer!.root.findByProps({ 'aria-label': '起動アニメーション' }).props.onClick());
  expect(renderer!.root.findByType('video')).toBe(video);
  const oldSignal = fixture.fetch.mock.calls[0][1].signal as AbortSignal;
  await act(async () => {
    if (nextOwner === 'a') fake.emit(null);
    fake.emit({ id: nextOwner, requiresEmailVerification: false });
    await microtasks();
  });
  expect(oldSignal.aborted).toBe(true);
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
  await act(async () => { oldResponse.resolve(new Response(JSON.stringify(accepted))); await microtasks(); });
  expect(splash()).toBe(1); expect(appLoading()).toBe(true);
  expect(renderer!.root.findByType(SplashScreen).props.canSkip).toBe(false);
  expect(fixture.preferences).not.toHaveBeenCalled();
  expect(fixture.content).not.toHaveBeenCalled();
  await act(async () => { nextResponse.resolve(new Response(JSON.stringify({ ...accepted, accepted: false }))); await microtasks(); });
  expect(appLoading()).toBe(false); expect(splash()).toBe(1);
  expect(renderer!.root.findByType('video')).toBe(video);
  const readySkip = renderer!.root.findByProps({ 'aria-label': '起動アニメーションをスキップ' });
  expect(readySkip.props.disabled).toBe(false);
  act(() => readySkip.props.onClick());
  expect(splash()).toBe(0);
  expect(renderer!.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(false);
  expect(fixture.profile).not.toHaveBeenCalled();
  plannerReads.forEach(read => expect(read).not.toHaveBeenCalled());
});

it('bounds a stalled preference read and keeps planner initialization gated', async () => {
  fixture.preferences.mockReturnValueOnce(deferred<typeof savedPreferences>().promise);
  await mount(); await authenticate(); await advance(PERSONALIZATION_READ_TIMEOUT_MS - 1);
  expect(splash()).toBe(1);
  expect(fixture.profile).not.toHaveBeenCalled();
  await advance(1);
  expect(splash()).toBe(0);
  expect(renderer!.root.findByType(InitialWeekStartPreferenceScreen).props.readFailed).toBe(true);
  expect(fixture.profile).not.toHaveBeenCalled();
  expect(fixture.memory).not.toHaveBeenCalled();
  plannerReads.forEach(read => expect(read).not.toHaveBeenCalled());
  expect(fixture.clock.getSnapshot().find(row => row.phase === 'preferences')).toMatchObject({
    durationMs: PERSONALIZATION_READ_TIMEOUT_MS, outcome: 'error',
  });
});

it('requires a successful fresh preference retry before bootstrap after a timeout', async () => {
  const old = deferred<typeof savedPreferences>(), next = deferred<typeof savedPreferences>();
  fixture.preferences.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await mount(); await authenticate(); await advance(PERSONALIZATION_READ_TIMEOUT_MS);
  const screen = renderer!.root.findByType(InitialWeekStartPreferenceScreen);
  expect(screen.props.readFailed).toBe(true);
  await act(async () => { expect(await screen.props.onSave('sunday')).toBe(false); });
  expect(fixture.profile).not.toHaveBeenCalled();
  let retry!: Promise<void>;
  await act(async () => { retry = screen.props.onRetry(); await microtasks(); });
  expect(splash()).toBe(1);
  await act(async () => { old.resolve(savedPreferences); await microtasks(); });
  expect(splash()).toBe(1);
  expect(fixture.profile).not.toHaveBeenCalled();
  await act(async () => { next.resolve(savedPreferences); await retry; await microtasks(); });
  expect(splash()).toBe(0);
  expect(fixture.preferences).toHaveBeenCalledTimes(2);
  expect(fixture.profile).toHaveBeenCalledOnce();
  expect(fixture.memory).toHaveBeenCalledOnce();
  plannerReads.forEach(read => expect(read).toHaveBeenCalledOnce());
});

it.each(['a', 'b'])('retires a pending preference read during a session transition to %s', async nextOwner => {
  const old = deferred<typeof savedPreferences>(), next = deferred<typeof savedPreferences>();
  fixture.preferences.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await mount(); await authenticate();
  await act(async () => {
    if (nextOwner === 'a') fake.emit(null);
    fake.emit({ id: nextOwner, requiresEmailVerification: false });
    await microtasks();
  });
  expect(fixture.preferences.mock.calls.map(call => call[0])).toEqual(['a', nextOwner]);
  await act(async () => { old.resolve(savedPreferences); await microtasks(); });
  expect(splash()).toBe(1);
  expect(fixture.profile).not.toHaveBeenCalled();
  // A successful missing profile still permits initial setup for the new session.
  await act(async () => { next.resolve(null as any); await microtasks(); });
  expect(splash()).toBe(0);
  expect(renderer!.root.findByType(InitialWeekStartPreferenceScreen).props.readFailed).toBe(false);
  expect(fixture.profile).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('a preference deadline exposes recovery readiness without bypassing intro playback', async () => {
  fixture.preferences.mockReturnValueOnce(deferred<typeof savedPreferences>().promise);
  await mount(false); await authenticate();
  const video = renderer!.root.findByType('video');
  expect(renderer!.root.findByType(SplashScreen).props.canSkip).toBe(false);
  await advance(PERSONALIZATION_READ_TIMEOUT_MS);
  expect(appLoading()).toBe(false);
  expect(splash()).toBe(1);
  expect(renderer!.root.findByType('video')).toBe(video);
  expect(renderer!.root.findByType(SplashScreen).props.canSkip).toBe(true);
  expect(fixture.content).not.toHaveBeenCalled();
  act(() => renderer!.root.findByProps({ 'aria-label': '起動アニメーションをスキップ' }).props.onClick());
  expect(splash()).toBe(0);
  expect(renderer!.root.findByType(InitialWeekStartPreferenceScreen).props.readFailed).toBe(true);
});
