import { PlannerAppBootstrap } from './PlannerAppBootstrap';
import { startupTiming } from '../lib/startupTiming';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
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
import { SplashScreen } from './SplashScreen';

function useStartupWait(phase: 'auth-session' | 'consent' | 'preferences', pending: boolean, failed = false) {
  const finish = useRef<ReturnType<typeof startupTiming.begin> | null>(null);
  useEffect(() => {
    if (pending && !finish.current) finish.current = startupTiming.begin(phase);
    if (!pending && finish.current) { finish.current(failed ? 'error' : 'success'); finish.current = null; }
  }, [phase, pending, failed]);
  useEffect(() => () => { finish.current?.('cancelled'); finish.current = null; }, [phase]);
}

function StartupSurface({
  children,
  loading,
}: PropsWithChildren<{ loading: boolean }>) {
  return (
    <>
      <div style={loading ? { display: 'none' } : undefined}>
        {children}
      </div>
      {loading ? <SplashScreen fixedLight /> : null}
    </>
  );
}

const ignoreEarlyBootstrapReady = () => {};

function ConsentedStudyPlannerApp({
  authSession,
  userId,
  onStartupReady,
}: {
  authSession: AuthSessionService;
  userId: string;
  onStartupReady: () => void;
}) {
  const personalization = useWeeklyPlanningPersonalizationProfile(userId);
  useStartupWait('preferences', personalization.loading, Boolean(personalization.error));

  useEffect(() => {
    if (!personalization.loading && !personalization.profile?.weekStartsOn) {
      onStartupReady();
    }
  }, [onStartupReady, personalization.loading, personalization.profile?.weekStartsOn]);

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
      <PlannerAppBootstrap ownerId={userId}>
        {(state, onReady) => (
          <UserPlanningContextProvider ownerId={userId}>
            <WeeklyPlanningPersonalizationProvider
              profile={profile}
              setWeekStartsOn={personalization.setWeekStartsOn}
              resetProfile={personalization.resetProfile}
            >
              <RootStartupReadyProvider onReady={onStartupReady}>
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
  onStartupReady,
}: {
  authSession: AuthSessionService;
  userId: string;
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
  const currentPath = window.location.pathname;
  const isLegalPage = currentPath === '/terms'
    || currentPath === '/privacy'
    || currentPath === '/contact';
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null | undefined>(
    () => {
      const user = authSession.getCurrentUser();
      return user && !user.requiresEmailVerification
        ? user.id
        : authSession.available
          ? undefined
          : null;
    },
  );
  useStartupWait('auth-session', authenticatedUserId === undefined);

  useEffect(() => {
    if (!authSession.available) {
      setAuthenticatedUserId(null);
      return undefined;
    }

    return authSession.subscribe((user) => {
      if (!user || user.requiresEmailVerification) {
        setAuthenticatedUserId(null);
        return;
      }
      setAuthenticatedUserId(user.id);
    });
  }, [authSession]);

  if (isLegalPage || !traceEnabled || !authSession.available) {
    return <App />;
  }

  if (authenticatedUserId === undefined) return <SplashScreen fixedLight />;
  if (authenticatedUserId === null) return <RootManagedUnauthenticatedApp />;
  return <AuthenticatedStartup key={authenticatedUserId} authSession={authSession} userId={authenticatedUserId} />;
}

function AuthenticatedStartup({ authSession, userId }: { authSession: AuthSessionService; userId: string }) {
  // Owned by this mounted session, not by a reusable owner ID in the root.
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  return (
    <StartupSurface loading={!ready}>
      <RootStartupReadyProvider onReady={markReady}>
        <AuthenticatedStudyPlannerApp authSession={authSession} userId={userId} onStartupReady={markReady} />
      </RootStartupReadyProvider>
    </StartupSurface>
  );
}
