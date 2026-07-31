import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
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
import { SplashScreen } from './SplashScreen';

function isPasswordUserWaitingForVerification(user: {
  emailVerified: boolean;
  providerData: Array<{ providerId: string }>;
}): boolean {
  return !user.emailVerified
    && user.providerData.some((provider) => provider.providerId === 'password');
}

function ConsentedStudyPlannerApp({ userId }: { userId: string }) {
  const personalization = useWeeklyPlanningPersonalizationProfile(userId);
  const auth = getFirebaseAuth();

  if (personalization.loading) {
    return <SplashScreen />;
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

function AuthenticatedStudyPlannerApp({ userId }: { userId: string }) {
  const policy = useWeeklyPlanningTracePolicy(userId);
  const auth = getFirebaseAuth();

  if (policy.status === 'accepted') {
    return <ConsentedStudyPlannerApp userId={userId} />;
  }

  if (policy.status === 'disabled') {
    return <App />;
  }

  if (policy.status === 'loading') {
    return <SplashScreen />;
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

  if (isLegalPage || !traceEnabled || !auth) {
    return <App />;
  }

  if (authenticatedUserId === undefined) {
    return <SplashScreen />;
  }

  if (authenticatedUserId === null) {
    return <RootManagedUnauthenticatedApp />;
  }

  return <AuthenticatedStudyPlannerApp userId={authenticatedUserId} />;
}
