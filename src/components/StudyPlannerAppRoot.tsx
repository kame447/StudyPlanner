import { useStartupProfileObservation } from '../hooks/useStartupProfileObservation';
import { createStartupSessionScope, type StartupSessionCapability, type StartupSessionScope } from '../lib/startupSessionScope';
import { retireStartupPreviewCache } from '../lib/retiredStartupPreviewCache';
import { PlannerAppBootstrap } from './PlannerAppBootstrap';
import { startupTiming } from '../lib/startupTiming';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import App from '../App';
import { UserPlanningContextProvider } from '../features/userPlanningContext/UserPlanningContextContext';
import {
  WeeklyPlanningPersonalizationProvider,
} from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import { useWeeklyPlanningPersonalizationProfile } from '../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile';
import {
  isWeeklyPlanningTraceFeatureEnabled,
} from '../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository';
import { useWeeklyPlanningTracePolicy } from '../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy';
import { createAuthSessionService, type AuthSessionService } from '../services/authSession';
import { InitialPrivacyConsentScreen } from './InitialPrivacyConsentScreen';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';
import { RootManagedAuthenticationProvider } from './RootManagedAuthenticationContext';
import { RootStartupReadyProvider } from './RootStartupReadyContext';
import { StartupSurface } from './StartupSurface';

function useStartupWait(phase: 'auth-session' | 'consent' | 'preferences', pending: boolean, failed = false) {
  const finish = useRef<ReturnType<typeof startupTiming.begin> | null>(null);
  useEffect(() => {
    if (pending && !finish.current) finish.current = startupTiming.begin(phase);
    if (!pending && finish.current) { finish.current(failed ? 'error' : 'success'); finish.current = null; }
  }, [phase, pending, failed]);
  useEffect(() => () => { finish.current?.('cancelled'); finish.current = null; }, [phase]);
}

interface StartupPresentation { loading: boolean }

const ignoreEarlyBootstrapReady = () => {};
const readyPresentation: StartupPresentation = { loading: false };
function ConsentedStudyPlannerApp({
  authSession,
  userId,
  startupScope,
  onStartupReady,
}: {
  authSession: AuthSessionService;
  userId: string;
  startupScope: StartupSessionCapability;
  onStartupReady: () => void;
}) {
  const personalization = useWeeklyPlanningPersonalizationProfile(userId);
  const finishProfileObservation = useStartupProfileObservation({
    ownerId: userId, scope: startupScope,
    preferenceStatus: personalization.error ? 'blocked' : personalization.loading ? 'loading' : personalization.profile?.weekStartsOn ? 'ready' : 'blocked',
  });
  const finishStartup = useCallback(() => {
    finishProfileObservation();
    onStartupReady();
  }, [finishProfileObservation, onStartupReady]);
  useStartupWait('preferences', personalization.loading, Boolean(personalization.error));

  useEffect(() => {
    if (!personalization.loading && !personalization.profile?.weekStartsOn) {
      finishStartup();
    }
  }, [finishStartup, personalization.loading, personalization.profile?.weekStartsOn]);

  if (personalization.loading) {
    return null;
  }

  const profile = personalization.profile;
  if (!profile?.weekStartsOn) {
    return (
      <InitialWeekStartPreferenceScreen
        error={personalization.error}
        onSave={personalization.setWeekStartsOn}
        onRetry={personalization.refresh}
        onSignOut={async () => {
          await authSession.signOut();
        }}
      />
    );
  }

  return (
    <RootStartupReadyProvider onReady={ignoreEarlyBootstrapReady}>
      <PlannerAppBootstrap ownerId={userId} startupScope={startupScope} authSession={authSession} startupObservationAllowed={!personalization.error}>
        {(state, onReady) => (
          <UserPlanningContextProvider ownerId={userId}>
            <WeeklyPlanningPersonalizationProvider
              profile={profile}
              setWeekStartsOn={personalization.setWeekStartsOn}
              resetProfile={personalization.resetProfile}
            >
              <RootStartupReadyProvider onReady={finishStartup}>
                <App state={state} onReady={onReady} />
              </RootStartupReadyProvider>
            </WeeklyPlanningPersonalizationProvider>
          </UserPlanningContextProvider>
        )}
      </PlannerAppBootstrap>
    </RootStartupReadyProvider>
  );
}

function AuthenticatedStudyPlannerApp({
  authSession,
  userId,
  startupScope,
  onStartupReady,
}: {
  authSession: AuthSessionService;
  userId: string;
  startupScope: StartupSessionCapability;
  onStartupReady: () => void;
}) {
  const policy = useWeeklyPlanningTracePolicy(userId);
  useStartupWait('consent', policy.status === 'loading', policy.status === 'unavailable');

  useEffect(() => {
    if (
      policy.status !== 'loading'
      && policy.status !== 'accepted'
      && policy.status !== 'disabled'
    ) {
      onStartupReady();
    }
  }, [onStartupReady, policy.status]);

  if (policy.status === 'accepted') {
    return (
      <ConsentedStudyPlannerApp
        authSession={authSession}
        userId={userId}
        startupScope={startupScope}
        onStartupReady={onStartupReady}
      />
    );
  }

  if (policy.status === 'disabled') {
    return <App />;
  }

  if (policy.status === 'loading') {
    return null;
  }

  return (
    <InitialPrivacyConsentScreen
      unavailable={policy.status === 'unavailable'}
      error={policy.error}
      onAccept={policy.accept}
      onRetry={policy.refresh}
      onSignOut={async () => {
        await authSession.signOut();
      }}
    />
  );
}

function RootManagedUnauthenticatedApp() {
  return (
    <RootManagedAuthenticationProvider>
      <App />
    </RootManagedAuthenticationProvider>
  );
}

export function StudyPlannerAppRoot({
  authSession: injectedAuthSession,
}: { authSession?: AuthSessionService } = {}) {
  const authSession = useMemo(
    () => injectedAuthSession ?? createAuthSessionService(),
    [injectedAuthSession],
  );
  const traceEnabled = isWeeklyPlanningTraceFeatureEnabled();
  useEffect(() => { retireStartupPreviewCache(); }, []);
  const currentPath = window.location.pathname;
  const isLegalPage = currentPath === '/terms'
    || currentPath === '/privacy'
    || currentPath === '/contact';
  const [session, setSession] = useState<{ userId: string | null | undefined; epoch: number; scope: StartupSessionScope }>(() => {
    const user = authSession.getCurrentUser();
    return { userId: user && !user.requiresEmailVerification ? user.id : authSession.available ? undefined : null, epoch: 0, scope: createStartupSessionScope() };
  });
  const [presentation, setPresentation] = useState<{ session: typeof session; value: StartupPresentation } | null>(null);
  const currentSession = useRef(session);
  const presentStartup = useCallback((value: StartupPresentation) => {
    if (currentSession.current !== session) return;
    setPresentation((previous) => previous?.session === session && previous.value === value
      ? previous : { session, value });
  }, [session]);
  const markUnauthenticatedReady = useCallback(() => presentStartup(readyPresentation), [presentStartup]);
  const isCurrentSession = useCallback(() => currentSession.current === session, [session]);
  const authenticatedUserId = session.userId;
  useStartupWait('auth-session', authenticatedUserId === undefined);

  useEffect(() => {
    let subscribed = true;
    const accept = (user: ReturnType<AuthSessionService['getCurrentUser']>) => {
      if (!subscribed) return;
      const userId = user && !user.requiresEmailVerification ? user.id : null;
      const previous = currentSession.current;
      if (previous.userId === userId && previous.scope.isCurrent()) return;
      previous.scope.invalidate();
      const next = { userId, epoch: previous.epoch + 1, scope: createStartupSessionScope() };
      // Revoke the prior session synchronously, including batched A→null→A events.
      currentSession.current = next;
      setSession(next);
    };
    if (!authSession.available) {
      accept(null);
      return () => { subscribed = false; currentSession.current.scope.invalidate(); };
    }
    const unsubscribe = authSession.subscribe(accept);
    // Re-establish a revoked StrictMode/service-replacement lifetime only from a
    // known user. A transient null must not turn pending auth into a login screen.
    if (!currentSession.current.scope.isCurrent()) {
      const known = authSession.getCurrentUser();
      if (known) accept(known);
    }
    return () => { subscribed = false; unsubscribe(); currentSession.current.scope.invalidate(); };
  }, [authSession]);

  if (isLegalPage || !traceEnabled || !authSession.available) {
    return <App />;
  }

  const currentPresentation = presentation?.session === session ? presentation.value : null;
  const loading = authenticatedUserId === undefined
    || (currentPresentation?.loading ?? true);
  return (
    <StartupSurface loading={loading} isCurrent={isCurrentSession}>
      {authenticatedUserId === null ? <RootStartupReadyProvider onReady={markUnauthenticatedReady}><RootManagedUnauthenticatedApp /></RootStartupReadyProvider>
        : typeof authenticatedUserId === 'string' ? (
          <AuthenticatedStartup key={JSON.stringify([authenticatedUserId, session.epoch])}
            authSession={authSession} userId={authenticatedUserId} startupScope={session.scope} onPresentation={presentStartup} />
        ) : null}
    </StartupSurface>
  );
}

function AuthenticatedStartup({ authSession, userId, startupScope, onPresentation }: {
  authSession: AuthSessionService; userId: string; startupScope: StartupSessionCapability;
  onPresentation: (value: StartupPresentation) => void;
}) {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  const presentation = useMemo<StartupPresentation>(() => ({ loading: !ready }), [ready]);
  useLayoutEffect(() => { onPresentation(presentation); }, [onPresentation, presentation]);
  return (
    <RootStartupReadyProvider onReady={markReady}>
      <AuthenticatedStudyPlannerApp authSession={authSession} userId={userId} startupScope={startupScope} onStartupReady={markReady} />
    </RootStartupReadyProvider>
  );
}
