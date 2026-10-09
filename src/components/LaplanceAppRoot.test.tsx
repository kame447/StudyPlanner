import { startupTiming } from '../lib/startupTiming';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import type { WeeklyPlanningPersonalizationProfileState } from '../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile';
import type { WeeklyPlanningTracePolicyState } from '../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy';
import { createAuthSessionService } from '../services/authSession';
import { createFakeAuthSession } from '../test/fakeAuthSession';
import { InitialPrivacyConsentScreen } from './InitialPrivacyConsentScreen';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';
import { RootManagedAuthenticationProvider } from './RootManagedAuthenticationContext';
import { RootStartupReadyProvider } from './RootStartupReadyContext';
import { SplashScreen } from './SplashScreen';
import { StartupSurface } from './StartupSurface';
import { LaplanceAppRoot } from './LaplanceAppRoot';

const state = vi.hoisted(() => ({
  traceEnabled: true,
  reducedMotion: true,
  policy: {} as WeeklyPlanningTracePolicyState,
  personalization: {} as WeeklyPlanningPersonalizationProfileState,
}));

vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../App', async () => {
  const { useEffect } = await import('react');
  const { useRootManagedAuthentication } = await import('./RootManagedAuthenticationContext');
  const { useRootStartupReady } = await import('./RootStartupReadyContext');
  return { default: () => {
    const managedAuthentication = useRootManagedAuthentication();
    const ready = useRootStartupReady();
    // Only the login surface settles itself. Authenticated tests still own their
    // explicit readiness signal, so this probe cannot bypass data gates.
    useEffect(() => { if (managedAuthentication) ready?.(); }, [managedAuthentication, ready]);
    return null;
  } };
});
vi.mock('./PlannerAppBootstrap', () => ({ PlannerAppBootstrap: ({ children }: any) => children({}, () => {}) }));
vi.mock('../features/userPlanningContext/UserPlanningContextContext', () => ({
  UserPlanningContextProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository', () => ({
  isWeeklyPlanningTraceFeatureEnabled: () => state.traceEnabled,
}));
vi.mock('../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy', () => ({
  useWeeklyPlanningTracePolicy: () => state.policy,
}));
vi.mock('../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile', () => ({
  useWeeklyPlanningPersonalizationProfile: () => state.personalization,
}));

const verifiedUser = { id: 'user-1', requiresEmailVerification: false };
let renderer: ReactTestRenderer;
let fake: ReturnType<typeof createFakeAuthSession>;

function mount() {
  act(() => { renderer = create(<LaplanceAppRoot authSession={fake.session} />); });
}

function rerender() {
  act(() => renderer.update(<LaplanceAppRoot authSession={fake.session} />));
}

describe('LaplanceAppRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.reducedMotion = true;
    vi.stubGlobal('window', { location: { pathname: '/' }, matchMedia: () => ({ matches: state.reducedMotion }) });
    fake = createFakeAuthSession();
    vi.mocked(createAuthSessionService).mockReturnValue(fake.session);
    state.traceEnabled = true;
    state.policy = {
      status: 'required', policyVersion: 'test', acceptedAt: null, error: '',
      accept: vi.fn(async () => true), refresh: vi.fn(async () => undefined),
    };
    state.personalization = {
      loading: false, profile: null, error: '', readFailed: false,
      setWeekStartsOn: vi.fn(async () => true), refresh: vi.fn(async () => undefined),
      resetProfile: vi.fn(async () => true),
    };
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it('records failed consent and preference waits as errors without changing their screens', () => {
    const consentFinished = vi.fn();
    const preferencesFinished = vi.fn();
    const otherFinished = vi.fn();
    const spy = vi.spyOn(startupTiming, 'begin').mockImplementation(phase =>
      phase === 'consent' ? consentFinished : phase === 'preferences' ? preferencesFinished : otherFinished);
    try {
      fake = createFakeAuthSession({ currentUser: verifiedUser });
      state.policy.status = 'loading';
      mount();
      expect(spy).toHaveBeenCalledWith('consent');
      state.policy.status = 'unavailable'; rerender();
      expect(consentFinished).toHaveBeenCalledExactlyOnceWith('error');
      expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(1);
      state.personalization.loading = true;
      state.policy.status = 'accepted'; rerender();
      expect(spy).toHaveBeenCalledWith('preferences');
      state.personalization.loading = false;
      state.personalization.error = 'fixture failure'; rerender();
      expect(preferencesFinished).toHaveBeenCalledExactlyOnceWith('error');
      expect(renderer.root.findAllByType(InitialWeekStartPreferenceScreen)).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });

  it('hands unauthenticated sign-in state to the root authentication boundary', () => {
    mount();
    act(() => fake.emit(null));
    expect(renderer.root.findAllByType(RootManagedAuthenticationProvider)).toHaveLength(1);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
    expect(createAuthSessionService).not.toHaveBeenCalled();
  });

  it('keeps the initial splash until the first session notification', () => {
    mount();
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
    expect(renderer.root.findAllByType(App)).toHaveLength(0);
    act(() => fake.emit(null));
    expect(renderer.root.findAllByType(App)).toHaveLength(1);
  });

  it.each(['auth', 'consent'].flatMap(stage => ['skip', 'ended', 'error'].map(event => [stage, event])))(
    'preserves %s readiness when video presentation finishes via %s', (stage, event) => {
      state.reducedMotion = false;
      state.policy.status = 'loading';
      mount();
      if (stage === 'consent') act(() => fake.emit(verifiedUser));
      act(() => {
        if (event === 'skip') {
          const button = renderer.root.findByProps({ 'aria-label': '起動アニメーション' });
          expect(button.props.disabled).toBe(true);
          button.props.onClick();
        }
        else renderer.root.findByType('video').props[event === 'ended' ? 'onEnded' : 'onError']();
      });
      expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
      expect(renderer.root.findAllByType('video')).toHaveLength(event === 'skip' ? 1 : 0);
      expect(renderer.root.findAllByType(App)).toHaveLength(0);
      expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(0);
      if (stage === 'auth') act(() => fake.emit(verifiedUser));
      expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
      state.policy.status = 'required';
      rerender();
      if (event === 'skip') {
        expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
        const button = renderer.root.findByProps({ 'aria-label': '起動アニメーションをスキップ' });
        expect(button.props.disabled).toBe(false);
        act(() => button.props.onClick());
      }
      expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
      expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(1);
      expect(renderer.root.findAllByType(App)).toHaveLength(0);
    },
  );

  it.each(['ended', 'skip'] as const)('keeps a ready login behind the video until %s without a second intro', event => {
    state.reducedMotion = false;
    mount();
    const video = renderer.root.findByType('video');
    expect(renderer.root.findByType(StartupSurface).findAllByType('div')[0].props.style).toEqual({ display: 'none' });
    act(() => fake.emit(null));
    expect(renderer.root.findAllByType(RootManagedAuthenticationProvider)).toHaveLength(1);
    expect(renderer.root.findAllByType('video')).toHaveLength(1);
    expect(renderer.root.findByType('video')).toBe(video);
    expect(renderer.root.findByType(SplashScreen).props.canSkip).toBe(true);
    expect(renderer.root.findByType(StartupSurface).findAllByType('div')[0].props.style).toEqual({ display: 'none' });
    act(() => event === 'ended' ? video.props.onEnded()
      : renderer.root.findByProps({ 'aria-label': '起動アニメーションをスキップ' }).props.onClick());
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
    expect(renderer.root.findByType(StartupSurface).findAllByType('div')[0].props.style).toBeUndefined();
  });

  it.each(['required', 'unavailable', 'preference-error'] as const)('keeps ready %s recovery behind healthy video until explicit skip', outcome => {
    state.reducedMotion = false;
    state.policy.status = 'loading';
    fake = createFakeAuthSession({ currentUser: verifiedUser });
    mount();
    const video = renderer.root.findByType('video');
    state.policy.status = outcome === 'preference-error' ? 'accepted' : outcome;
    if (outcome === 'preference-error') state.personalization.error = 'preferences unavailable';
    if (outcome === 'unavailable') state.policy.error = 'consent unavailable';
    rerender();
    expect(renderer.root.findByType('video')).toBe(video);
    expect(renderer.root.findByType(StartupSurface).findAllByType('div')[0].props.style).toEqual({ display: 'none' });
    const button = renderer.root.findByProps({ 'aria-label': '起動アニメーションをスキップ' });
    expect(button.props.disabled).toBe(false);
    act(() => button.props.onClick());
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
    expect(renderer.root.findByType(StartupSurface).findAllByType('div')[0].props.style).toBeUndefined();
    if (outcome === 'preference-error') expect(renderer.root.findByType(InitialWeekStartPreferenceScreen).props.error).toBe('preferences unavailable');
    else expect(renderer.root.findByType(InitialPrivacyConsentScreen).props.unavailable).toBe(outcome === 'unavailable');
  });

  it('uses the default session once when no service is injected', () => {
    act(() => { renderer = create(<LaplanceAppRoot />); });
    act(() => fake.emit(null));
    act(() => renderer.update(<LaplanceAppRoot />));
    expect(createAuthSessionService).toHaveBeenCalledTimes(1);
    expect(fake.session.subscribe).toHaveBeenCalledTimes(1);
  });

  it('starts consent from a cached verified session without awaiting a notification', () => {
    fake = createFakeAuthSession({ currentUser: verifiedUser });
    mount();
    expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(1);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
  });

  it('waits for a cached unverified session and blocks it until verification', () => {
    const unverifiedUser = { ...verifiedUser, requiresEmailVerification: true };
    fake = createFakeAuthSession({ currentUser: unverifiedUser });
    mount();
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
    act(() => fake.emit(unverifiedUser));
    expect(renderer.root.findAllByType(RootManagedAuthenticationProvider)).toHaveLength(1);
    expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(0);
    act(() => fake.emit(verifiedUser));
    expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(1);
  });

  it('preserves consent loading, unavailable/retry, acceptance and preference onboarding', async () => {
    state.policy.status = 'loading';
    mount();
    act(() => fake.emit(verifiedUser));
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
    expect(renderer.root.findAllByType(App)).toHaveLength(0);

    state.policy.status = 'unavailable';
    state.policy.error = 'consent unavailable';
    rerender();
    const consent = renderer.root.findByType(InitialPrivacyConsentScreen);
    expect(consent.props.unavailable).toBe(true);
    expect(consent.props.error).toBe('consent unavailable');
    await act(async () => { await consent.props.onRetry(); });
    expect(state.policy.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { await consent.props.onAccept(); });
    expect(state.policy.accept).toHaveBeenCalledTimes(1);

    state.policy.status = 'accepted';
    state.personalization.loading = true;
    rerender();
    expect(renderer.root.findAllByType(InitialPrivacyConsentScreen)).toHaveLength(0);
    expect(renderer.root.findAllByType(App)).toHaveLength(0);
    state.personalization.loading = false;
    rerender();
    const preference = renderer.root.findByType(InitialWeekStartPreferenceScreen);
    await act(async () => { await preference.props.onSave('sunday'); });
    expect(state.personalization.setWeekStartsOn).toHaveBeenCalledWith('sunday');
  });

  it.each(['required', 'unavailable', 'accepted'] as const)(
    'uses the injected sign-out from the %s onboarding screen', async (status) => {
      state.policy.status = status;
      mount();
      act(() => fake.emit(verifiedUser));
      const screen = status === 'accepted'
        ? renderer.root.findByType(InitialWeekStartPreferenceScreen)
        : renderer.root.findByType(InitialPrivacyConsentScreen);
      await act(async () => { await screen.props.onSignOut(); });
      expect(fake.session.signOut).toHaveBeenCalledTimes(1);
      act(() => fake.emit(null));
      expect(renderer.root.findAllByType(RootManagedAuthenticationProvider)).toHaveLength(1);
    },
  );

  it('keeps the app hidden until authenticated startup reports ready', () => {
    state.policy.status = 'disabled';
    mount();
    act(() => fake.emit(verifiedUser));
    expect(renderer.root.findAllByType(App)).toHaveLength(1);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
    act(() => renderer.root.findAllByType(RootStartupReadyProvider).slice(-1)[0].props.onReady());
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
  });

  it('waits for personalization and app readiness for an already consented user', () => {
    state.policy.status = 'accepted';
    state.personalization.loading = true;
    mount();
    act(() => fake.emit(verifiedUser));
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
    expect(renderer.root.findAllByType(App)).toHaveLength(0);
    state.personalization = {
      ...state.personalization,
      loading: false,
      profile: {
        schemaVersion: 2,
        weekStartsOn: {
          value: 'monday', origin: 'user_confirmed', confidence: 'confirmed',
          scope: { kind: 'global' }, updatedAt: '2026-10-02T00:00:00Z',
        },
        subjectEstimateMultipliers: {},
        placementModel: {
          featureVersion: 'placement-features-v1',
          weightVersion: 'placement-weights-v1', parameters: {},
        },
        updatedAt: '2026-10-02T00:00:00Z',
      },
    };
    rerender();
    expect(renderer.root.findAllByType(App)).toHaveLength(1);
    expect(renderer.root.findAllByType(InitialWeekStartPreferenceScreen)).toHaveLength(0);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(1);
    act(() => renderer.root.findAllByType(RootStartupReadyProvider).slice(-1)[0].props.onReady());
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
  });

  it.each(['/terms', '/privacy', '/contact'])('bypasses root gating on %s', (pathname) => {
    vi.stubGlobal('window', { location: { pathname } });
    mount();
    expect(renderer.root.findAllByType(App)).toHaveLength(1);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
  });

  it('bypasses root gating when trace is disabled', () => {
    state.traceEnabled = false;
    mount();
    expect(renderer.root.findAllByType(App)).toHaveLength(1);
    expect(renderer.root.findAllByType(SplashScreen)).toHaveLength(0);
  });

  it('bypasses root gating when the session service is unavailable', () => {
    fake = createFakeAuthSession({ available: false });
    mount();
    expect(renderer.root.findAllByType(App)).toHaveLength(1);
    expect(fake.session.subscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    mount();
    act(() => renderer.unmount());
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
