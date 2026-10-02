import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
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

  useEffect(() => {
    if (!personalization.loading && !personalization.profile?.weekStartsOn) {
      onStartupReady();
    }
  }, [onStartupReady, personalization.loading, personalization.profile?.weekStartsOn]);

  if (personalization.loading) {
    return null;
  }

  if (!personalization.profile?.weekStartsOn) {
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
    <UserPlanningContextProvider ownerId={userId}>
      <WeeklyPlanningPersonalizationProvider
        profile={personalization.profile}
        setWeekStartsOn={personalization.setWeekStartsOn}
        resetProfile={personalization.resetProfile}
      >
        <App />
      </WeeklyPlanningPersonalizationProvider>
    </UserPlanningContextProvider>
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
  const [startupReadyUserId, setStartupReadyUserId] = useState<string | null>(null);

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

  const markAuthenticatedStartupReady = useCallback(() => {
    if (typeof authenticatedUserId === 'string') {
      setStartupReadyUserId(authenticatedUserId);
    }
  }, [authenticatedUserId]);

  if (isLegalPage || !traceEnabled || !authSession.available) {
    return <App />;
  }

  const authenticatedStartupPending = typeof authenticatedUserId === 'string'
    && startupReadyUserId !== authenticatedUserId;
  const startupLoading = authenticatedUserId === undefined || authenticatedStartupPending;

  return (
    <StartupSurface loading={startupLoading}>
      {authenticatedUserId === null ? (
        <RootManagedUnauthenticatedApp />
      ) : typeof authenticatedUserId === 'string' ? (
        <RootStartupReadyProvider onReady={markAuthenticatedStartupReady}>
          <AuthenticatedStudyPlannerApp
            authSession={authSession}
            userId={authenticatedUserId}
            onStartupReady={markAuthenticatedStartupReady}
          />
        </RootStartupReadyProvider>
      ) : null}
    </StartupSurface>
  );
}
