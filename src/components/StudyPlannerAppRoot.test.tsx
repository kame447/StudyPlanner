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
import { StudyPlannerAppRoot } from './StudyPlannerAppRoot';

const state = vi.hoisted(() => ({
  traceEnabled: true,
  policy: {} as WeeklyPlanningTracePolicyState,
  personalization: {} as WeeklyPlanningPersonalizationProfileState,
}));

vi.mock('../services/authSession', () => ({ createAuthSessionService: vi.fn() }));
vi.mock('../App', () => ({ default: () => null }));
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
  act(() => { renderer = create(<StudyPlannerAppRoot authSession={fake.session} />); });
}

function rerender() {
  act(() => renderer.update(<StudyPlannerAppRoot authSession={fake.session} />));
}

describe('StudyPlannerAppRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { location: { pathname: '/' } });
    fake = createFakeAuthSession();
    vi.mocked(createAuthSessionService).mockReturnValue(fake.session);
    state.traceEnabled = true;
    state.policy = {
      status: 'required', policyVersion: 'test', acceptedAt: null, error: '',
      accept: vi.fn(async () => true), refresh: vi.fn(async () => undefined),
    };
    state.personalization = {
      loading: false, profile: null, error: '',
      setWeekStartsOn: vi.fn(async () => true), refresh: vi.fn(async () => undefined),
      resetProfile: vi.fn(async () => true),
    };
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
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

  it('uses the default session once when no service is injected', () => {
    act(() => { renderer = create(<StudyPlannerAppRoot />); });
    act(() => fake.emit(null));
    act(() => renderer.update(<StudyPlannerAppRoot />));
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
    act(() => renderer.root.findByType(RootStartupReadyProvider).props.onReady());
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
    act(() => renderer.root.findByType(RootStartupReadyProvider).props.onReady());
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
