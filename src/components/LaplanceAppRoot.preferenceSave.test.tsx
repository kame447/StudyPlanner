import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LaplanceAppRoot } from './LaplanceAppRoot';
import { SplashScreen } from './SplashScreen';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { createLocalFixture, deferred, MemoryStorage, microtasks, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import { createConfirmedWeekStartFact, createEmptyWeeklyPlanningPersonalizationProfile } from '../features/weeklyPlanning/personalization/weeklyPlanningPersonalizationTypes';
import type { WeeklyPlanningPersonalizationProfile } from '../features/weeklyPlanning/personalization/weeklyPlanningPersonalizationTypes';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { Actual } from '../types/domain';

const fixture = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository,
  profile: vi.fn(), memory: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), mount: vi.fn(), unmount: vi.fn(),
  getPreference: vi.fn(), save: vi.fn(), reset: vi.fn(), policy: 'accepted',
}));
vi.mock('../repositories', () => ({ authRepository: { getCurrentUser: fixture.profile },
  plannerRepository: new Proxy({}, { get: (_, key) => fixture.repository[key as keyof PlannerRepository] }) }));
vi.mock('../lib/startupMarkerObservation', () => ({ startupMarkerObservation: 'off' }));
vi.mock('../lib/startupProfileObservation', () => ({ startupProfileObservation: 'off' }));
vi.mock('../data/naturalLanguageCatalog', () => ({ loadNaturalLanguageCatalogWithOutcome: vi.fn(async () => ({ source: 'server' })) }));
vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceFeatureEnabled: () => true }));
vi.mock('../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy', () => ({ useWeeklyPlanningTracePolicy: () => ({ status: fixture.policy }) }));
vi.mock('../features/weeklyPlanning/personalization/weeklyPlanningPersonalizationRepository', () => ({
  getWeeklyPlanningPersonalizationRepository: () => ({ getProfile: fixture.getPreference, setWeekStartsOn: fixture.save, resetProfile: fixture.reset }) }));
vi.mock('../features/userPlanningContext/userPlanningContextRepository', () => ({ getUserPlanningContextRepositoryV1: () => ({ initialize: fixture.memory, subscribe: fixture.subscribe }) }));
vi.mock('../features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository', () => ({ getWeeklyPlanningApprovalPlanRepository: () => ({}) }));
vi.mock('../App', async () => {
  const React = await import('react');
  const { useRootStartupReady } = await import('./RootStartupReadyContext');
  const { useStartupContentVisible } = await import('./StartupSurface');
  const { AppSettingsGeneral } = await import('./AppSettingsGeneral');
  return { default: function Probe({ state, onReady }: any) {
    const ready = useRootStartupReady(), visible = useStartupContentVisible();
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => { fixture.mount(); return () => fixture.unmount(); }, []);
    React.useEffect(() => { if (!state.booting) ready?.(); }, [state.booting, ready]);
    React.useEffect(() => { if (!state.booting && visible) onReady?.(); }, [state.booting, visible, onReady]);
    return <section data-testid="app" data-visible={visible} data-owner={state.user?.id}>
      <input aria-label="unsaved draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <AppSettingsGeneral themeMode="light" themePalette="forest" onChangeTheme={() => {}} onChangeThemePalette={() => {}} />
    </section>;
  } };
});
const profile = (day: 'monday' | 'sunday'): WeeklyPlanningPersonalizationProfile => ({ ...createEmptyWeeklyPlanningPersonalizationProfile(), weekStartsOn: createConfirmedWeekStartFact(day, STAMP) });
const readNames = ['getScheduleSnapshot', 'getActuals', 'getTodos', 'getStudySubjects', 'getStudyMaterials', 'getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods'] as const;
let renderer: ReactTestRenderer | undefined;
let fake: ReturnType<typeof createFakeAuthSession>;
let reads: Record<string, { mock: { calls: unknown[][] } }>;
beforeEach(() => {
  vi.clearAllMocks(); fixture.policy = 'accepted';
  vi.stubGlobal('window', { location: { pathname: '/' }, localStorage: new MemoryStorage(), setTimeout, clearTimeout, confirm: vi.fn(() => true), matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), hidden: false, documentElement: { dataset: {}, style: { setProperty: vi.fn() } } });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  fixture.repository = { ...createLocalFixture().repository };
  fixture.repository.getActuals = async owner => Array.from({ length: 1000 }, (_, index) => ({ id: `synthetic-${index}`, userId: owner, planId: null, occurrenceDate: '2000-01-01', title: 'Synthetic history', subject: '', actualStartTime: '09:00', actualEndTime: '09:01', note: '', isAlignedToPlan: false, createdAt: STAMP, updatedAt: STAMP } as Actual));
  reads = Object.fromEntries(readNames.map(name => [name, vi.spyOn(fixture.repository, name)]));
  fixture.memory.mockImplementation(async (_id, snapshot) => ({ snapshot, shared: true }));
  fixture.subscribe.mockImplementation(() => fixture.unsubscribe);
  fixture.profile.mockImplementation(async () => ({ id: fake.session.getCurrentUser()!.id, username: 'Synthetic', email: 'owner@example.test', avatar: '', createdAt: STAMP }));
  fixture.getPreference.mockResolvedValue(profile('monday')); fixture.save.mockResolvedValue(profile('sunday')); fixture.reset.mockResolvedValue(undefined);
  fake = createFakeAuthSession({ currentUser: { id: 'a', requiresEmailVerification: false } });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount() { await act(async () => { renderer = create(<LaplanceAppRoot authSession={fake.session} />); await microtasks(); }); }
const button = (text: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(text))!;
const operations = () => ({ plannerReads: Object.fromEntries(readNames.map(name => [name, reads[name].mock.calls.length])), profileReads: fixture.profile.mock.calls.length, memoryInitializations: fixture.memory.mock.calls.length, memorySubscriptions: fixture.subscribe.mock.calls.length, memoryUnsubscriptions: fixture.unsubscribe.mock.calls.length, mounts: fixture.mount.mock.calls.length, unmounts: fixture.unmount.mock.calls.length });
it.each([false, true])('retains confirmed settings and draft without new reads during save; failure=%s', async failure => {
  const gate = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.save.mockReturnValueOnce(gate.promise);
  await mount();
  const app = renderer!.root.findByProps({ 'data-testid': 'app' });
  act(() => renderer!.root.findByProps({ 'aria-label': 'unsaved draft' }).props.onChange({ target: { value: 'keep this draft' } }));
  act(() => renderer!.root.findByProps({ 'aria-controls': 'settings-palette-options' }).props.onClick());
  const before = operations();
  await act(async () => { button('日曜日').props.onClick(); await microtasks(); });
  expect.soft(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(1);
  expect.soft(renderer!.root.findAllByType(SplashScreen)).toHaveLength(0);
  if (failure) await act(async () => { gate.reject(new Error('preference save offline')); await microtasks(); });
  else await act(async () => { gate.resolve(profile('sunday')); await microtasks(); });
  console.log('PREFERENCE_SAVE_READ_COUNTS', JSON.stringify({ failure, before, after: operations(), syntheticActualRowsPerRead: 1000 }));
  expect.soft(renderer!.root.findByProps({ 'data-testid': 'app' }) === app, 'same App instance').toBe(true);
  expect.soft(renderer!.root.findByProps({ 'aria-label': 'unsaved draft' }).props.value).toBe('keep this draft');
  expect.soft(operations()).toEqual(before);
  expect.soft(renderer!.root.findByProps({ 'aria-controls': 'settings-palette-options' }).props['aria-expanded']).toBe(true);
  if (failure) expect.soft(renderer!.root.findAllByProps({ role: 'alert' }).some(node => node.children.includes('preference save offline'))).toBe(true);
  else expect(button('日曜日').props['aria-pressed']).toBe(true);
});

it('shows pending state, blocks repeat or conflicting writes, and retries a failed save in place', async () => {
  const gate = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.save.mockReturnValueOnce(gate.promise);
  await mount();
  const before = operations(), save = button('日曜日').props.onClick;
  const reset = renderer!.root.findByProps({ className: 'settings-row settings-row-button settings-reset-row' }).props.onClick;
  await act(async () => { save(); save(); reset(); await microtasks(); });
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith('a', 'sunday');
  expect(fixture.reset).not.toHaveBeenCalled();
  expect(button('日曜日').props.disabled).toBe(true);
  expect(button('月曜日').props.disabled).toBe(true);
  expect(renderer!.root.findByProps({ className: 'settings-row settings-row-button settings-reset-row' }).props.disabled).toBe(true);
  expect(renderer!.root.findByProps({ 'aria-labelledby': 'settings-week-label' }).props['aria-busy']).toBe(true);
  expect(renderer!.root.findByProps({ role: 'status' }).children).toContain('学習設定を保存しています…');
  await act(async () => { gate.reject(new Error('save unavailable')); await microtasks(); });
  expect(button('日曜日').props.disabled).toBe(false);
  expect(button('月曜日').props['aria-pressed']).toBe(true);
  expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('save unavailable');
  const retry = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.save.mockReturnValueOnce(retry.promise);
  await act(async () => { button('日曜日').props.onClick(); await microtasks(); });
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  await act(async () => { retry.resolve(profile('sunday')); await microtasks(); });
  expect(button('日曜日').props['aria-pressed']).toBe(true);
  expect(fixture.save).toHaveBeenCalledTimes(2);
  expect(fixture.getPreference).toHaveBeenCalledOnce();
  expect(operations()).toEqual(before);
});

it.each([false, true])('keeps the confirmed screen during reset; failure=%s', async failure => {
  const gate = deferred<void>(); fixture.reset.mockReturnValueOnce(gate.promise);
  await mount();
  const before = operations();
  act(() => renderer!.root.findByProps({ 'aria-label': 'unsaved draft' }).props.onChange({ target: { value: 'retained until reset succeeds' } }));
  await act(async () => { renderer!.root.findByProps({ className: 'settings-row settings-row-button settings-reset-row' }).props.onClick(); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(1);
  expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(0);
  expect(fixture.reset).toHaveBeenCalledExactlyOnceWith('a');
  if (failure) {
    await act(async () => { gate.reject(new Error('reset unavailable')); await microtasks(); });
    expect(renderer!.root.findByProps({ 'aria-label': 'unsaved draft' }).props.value).toBe('retained until reset succeeds');
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('reset unavailable');
    expect(operations()).toEqual(before);
  } else {
    await act(async () => { gate.resolve(); await microtasks(); });
    expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(0);
    expect(renderer!.root.findAllByType(InitialWeekStartPreferenceScreen)).toHaveLength(1);
    expect(operations().plannerReads).toEqual(before.plannerReads);
    expect(fixture.unmount).toHaveBeenCalledOnce();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  }
});

it('does not mount planner before the initial preference read is confirmed', async () => {
  const gate = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.getPreference.mockReturnValueOnce(gate.promise);
  await mount();
  expect(renderer!.root.findAllByType(SplashScreen)).toHaveLength(1);
  expect(fixture.profile).not.toHaveBeenCalled(); expect(fixture.memory).not.toHaveBeenCalled();
  expect(Object.values(reads).every(read => read.mock.calls.length === 0)).toBe(true);
  await act(async () => { gate.resolve(profile('monday')); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(1);
  expect(Object.values(reads).every(read => read.mock.calls.length === 1)).toBe(true);
});

it('keeps an initial read failure blocked and retries without allowing a preference overwrite', async () => {
  fixture.getPreference.mockRejectedValueOnce(new Error('initial read unavailable'));
  await mount();
  const initial = renderer!.root.findByType(InitialWeekStartPreferenceScreen);
  expect(initial.props.readFailed).toBe(true);
  expect(initial.props.error).toBe('initial read unavailable');
  expect(await initial.props.onSave('sunday')).toBe(false);
  expect(fixture.save).not.toHaveBeenCalled(); expect(fixture.profile).not.toHaveBeenCalled();
  await act(async () => { await initial.props.onRetry(); await microtasks(); });
  expect(fixture.getPreference).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(1);
  expect(Object.values(reads).every(read => read.mock.calls.length === 1)).toBe(true);
});

it('keeps first-time setup gated until its first preference save succeeds', async () => {
  fixture.getPreference.mockResolvedValueOnce(null);
  const gate = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.save.mockReturnValueOnce(gate.promise);
  await mount();
  const initial = renderer!.root.findByType(InitialWeekStartPreferenceScreen);
  let pending!: Promise<boolean>;
  await act(async () => { pending = initial.props.onSave('sunday'); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(0);
  expect(fixture.profile).not.toHaveBeenCalled(); expect(fixture.memory).not.toHaveBeenCalled();
  await act(async () => { gate.resolve(profile('sunday')); expect(await pending).toBe(true); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(1);
  expect(Object.values(reads).every(read => read.mock.calls.length === 1)).toBe(true);
});

it.each(['resolve', 'reject'] as const)('retires old-owner save %s without publishing to the next owner', async outcome => {
  const gate = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.save.mockReturnValueOnce(gate.promise);
  await mount();
  const retainedSave = button('日曜日').props.onClick;
  await act(async () => { retainedSave(); await microtasks(); });
  await act(async () => { fake.emit({ id: 'b', requiresEmailVerification: false }); await microtasks(); });
  expect(renderer!.root.findByProps({ 'data-testid': 'app' }).props['data-owner']).toBe('b');
  const before = operations();
  await act(async () => {
    if (outcome === 'resolve') gate.resolve(profile('sunday')); else gate.reject(new Error('retired owner failure'));
    await microtasks(); retainedSave(); await microtasks();
  });
  expect(button('月曜日').props['aria-pressed']).toBe(true);
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith('a', 'sunday');
  expect(operations()).toEqual(before);
});

it('does not preserve the app when consent is withdrawn during a setting save', async () => {
  const gate = deferred<WeeklyPlanningPersonalizationProfile>(); fixture.save.mockReturnValueOnce(gate.promise);
  await mount();
  await act(async () => { button('日曜日').props.onClick(); await microtasks(); });
  fixture.policy = 'required';
  await act(async () => { renderer!.update(<LaplanceAppRoot authSession={fake.session} />); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(0);
  const before = operations();
  await act(async () => { gate.resolve(profile('sunday')); await microtasks(); });
  expect(renderer!.root.findAllByProps({ 'data-testid': 'app' })).toHaveLength(0);
  expect(operations()).toEqual(before);
});
