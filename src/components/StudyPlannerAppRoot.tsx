import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import App from '../App';
import {
  WeeklyPlanningPersonalizationProvider,
} from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import { useWeeklyPlanningPersonalizationProfile } from '../features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile';
import {
  isWeeklyPlanningTraceFeatureEnabled,
} from '../features/weeklyPlanning/trace/configureWeeklyPlanningTraceRepository';
import { useWeeklyPlanningTracePolicy } from '../features/weeklyPlanning/trace/useWeeklyPlanningTracePolicy';
import { getFirebaseAuth } from '../lib/firebaseClient';
import { InitialPrivacyConsentScreen } from './InitialPrivacyConsentScreen';
import { InitialWeekStartPreferenceScreen } from './InitialWeekStartPreferenceScreen';
import { RootManagedAuthenticationProvider } from './RootManagedAuthenticationContext';
import { RootStartupReadyProvider } from './RootStartupReadyContext';
import { SplashScreen } from './SplashScreen';

function isPasswordUserWaitingForVerification(user: {
  emailVerified: boolean;
  providerData: Array<{ providerId: string }>;
}): boolean {
  return !user.emailVerified
    && user.providerData.some((provider) => provider.providerId === 'password');
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
      {loading ? <SplashScreen /> : null}
    </>
  );
}

function ConsentedStudyPlannerApp({
  userId,
  onStartupReady,
}: {
  userId: string;
  onStartupReady: () => void;
}) {
  const personalization = useWeeklyPlanningPersonalizationProfile(userId);
  const auth = getFirebaseAuth();

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
          if (auth) await firebaseSignOut(auth);
        }}
      />
    );
  }

  return (
    <WeeklyPlanningPersonalizationProvider
      profile={personalization.profile}
      setWeekStartsOn={personalization.setWeekStartsOn}
      resetProfile={personalization.resetProfile}
    >
      <App />
    </WeeklyPlanningPersonalizationProvider>
  );
}

function AuthenticatedStudyPlannerApp({
  userId,
  onStartupReady,
}: {
  userId: string;
  onStartupReady: () => void;
}) {
  const policy = useWeeklyPlanningTracePolicy(userId);
  const auth = getFirebaseAuth();

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
        if (auth) await firebaseSignOut(auth);
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

export function StudyPlannerAppRoot() {
  const auth = useMemo(() => getFirebaseAuth(), []);
  const traceEnabled = isWeeklyPlanningTraceFeatureEnabled();
  const currentPath = window.location.pathname;
  const isLegalPage = currentPath === '/terms'
    || currentPath === '/privacy'
    || currentPath === '/contact';
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null | undefined>(
    auth?.currentUser && !isPasswordUserWaitingForVerification(auth.currentUser)
      ? auth.currentUser.uid
      : auth
        ? undefined
        : null,
  );
  const [startupReadyUserId, setStartupReadyUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthenticatedUserId(null);
      return undefined;
    }

    return onAuthStateChanged(auth, (user) => {
      if (!user || isPasswordUserWaitingForVerification(user)) {
        setAuthenticatedUserId(null);
        return;
      }
      setAuthenticatedUserId(user.uid);
    });
  }, [auth]);

  const markAuthenticatedStartupReady = useCallback(() => {
    if (typeof authenticatedUserId === 'string') {
      setStartupReadyUserId(authenticatedUserId);
    }
  }, [authenticatedUserId]);

  if (isLegalPage || !traceEnabled || !auth) {
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
            userId={authenticatedUserId}
            onStartupReady={markAuthenticatedStartupReady}
          />
        </RootStartupReadyProvider>
      ) : null}
    </StartupSurface>
  );
}
