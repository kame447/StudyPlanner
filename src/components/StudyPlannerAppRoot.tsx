import { hasStoredAppAccessGrant } from '../lib/appAccessGate';
import { clearStartupSchedulePreviews, readStartupSchedulePreview, saveStartupSchedulePreview, type ScheduleReadObserver } from '../lib/startupSchedulePreview';
import { StartupSchedulePreview } from './StartupSchedulePreview';
import type { PlannerAppSnapshot } from './PlannerAppBootstrap';
import { PlannerAppBootstrap } from './PlannerAppBootstrap';
import { startupTiming } from '../lib/startupTiming';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
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
  preview,
}: PropsWithChildren<{ loading: boolean; preview?: ReactNode }>) {
  return (
    <>
      <div style={loading ? { display: 'none' } : undefined}>
        {children}
      </div>
      {loading ? preview ?? <SplashScreen fixedLight /> : null}
    </>
  );
}

interface StartupPresentation { loading: boolean; preview?: ReactNode }

const ignoreEarlyBootstrapReady = () => {};
type PreviewStatus = 'disabled' | 'loading' | 'ready' | 'failed';
interface PreviewBoundary { active: boolean; capture: ScheduleReadObserver; report: (status: PreviewStatus) => void }
function BootstrapPreviewStatus({ state, boundary, ownerId }: { state: PlannerAppSnapshot; boundary: PreviewBoundary; ownerId: string }) {
  const status: PreviewStatus = state.booting ? 'loading'
    : state.user?.id === ownerId && state.plannerDataAvailability?.status === 'ready'
      && state.isPlannerDataSnapshotCurrent() ? 'ready' : 'failed';
  useLayoutEffect(() => { boundary.report(status); return () => boundary.report('disabled'); }, [boundary, status]);
  return null;
}
function hasPreviewAccess() { try { return hasStoredAppAccessGrant(); } catch { return false; } }


function ConsentedStudyPlannerApp({
  authSession,
  userId,
  onStartupReady,
  previewBoundary,
}: {
  authSession: AuthSessionService;
  userId: string;
  onStartupReady: () => void;
  previewBoundary: PreviewBoundary;
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
      <PlannerAppBootstrap ownerId={userId} onCommittedScheduleRead={previewBoundary.capture}>
        {(state, onReady) => (
          <>
          <BootstrapPreviewStatus state={state} boundary={previewBoundary} ownerId={userId} />
          <UserPlanningContextProvider ownerId={userId}>
            <WeeklyPlanningPersonalizationProvider
              profile={profile}
              setWeekStartsOn={personalization.setWeekStartsOn}
              resetProfile={personalization.resetProfile}
            >
              <RootStartupReadyProvider onReady={onStartupReady}>
                {!previewBoundary.active || (!state.booting && state.user?.id === userId
                  && state.plannerDataAvailability?.status === 'ready' && state.isPlannerDataSnapshotCurrent())
                  ? <App state={state} onReady={onReady} /> : null}
              </RootStartupReadyProvider>
            </WeeklyPlanningPersonalizationProvider>
          </UserPlanningContextProvider>
          </>
        )}
      </PlannerAppBootstrap>
    </RootStartupReadyProvider>
  );
}

function AuthenticatedStudyPlannerApp({
  authSession,
  userId,
  onStartupReady,
  previewBoundary,
}: {
  authSession: AuthSessionService;
  userId: string;
  onStartupReady: () => void;
  previewBoundary: PreviewBoundary;
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
        previewBoundary={previewBoundary}
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
  const [session, setSession] = useState<{ userId: string | null | undefined; epoch: number }>(() => {
    const user = authSession.getCurrentUser();
    return { userId: user && !user.requiresEmailVerification ? user.id : authSession.available ? undefined : null, epoch: 0 };
  });
  const [presentation, setPresentation] = useState<{ session: typeof session; value: StartupPresentation } | null>(null);
  const currentSession = useRef(session);
  const presentStartup = useCallback((value: StartupPresentation) => {
    if (currentSession.current !== session) return;
    setPresentation((previous) => previous?.session === session && previous.value === value
      ? previous : { session, value });
  }, [session]);
  const authenticatedUserId = session.userId;
  useStartupWait('auth-session', authenticatedUserId === undefined);

  useEffect(() => {
    let subscribed = true;
    const accept = (user: ReturnType<AuthSessionService['getCurrentUser']>) => {
      if (!subscribed) return;
      const userId = user && !user.requiresEmailVerification ? user.id : null;
      const previous = currentSession.current;
      if (previous.userId === userId) return;
      const next = { userId, epoch: previous.epoch + 1 };
      // Invalidate captures synchronously, including batched A→null→A events.
      currentSession.current = next;
      if (typeof previous.userId === 'string' || userId === null) clearStartupSchedulePreviews();
      setSession(next);
    };
    if (!authSession.available) { accept(null); return () => { subscribed = false; }; }
    const unsubscribe = authSession.subscribe(accept);
    return () => { subscribed = false; unsubscribe(); };
  }, [authSession]);

  if (isLegalPage || !traceEnabled || !authSession.available) {
    return <App />;
  }

  const currentPresentation = presentation?.session === session ? presentation.value : null;
  const loading = authenticatedUserId === undefined
    || (typeof authenticatedUserId === 'string' && (currentPresentation?.loading ?? true));
  return (
    <StartupSurface loading={loading} preview={typeof authenticatedUserId === 'string' ? currentPresentation?.preview : undefined}>
      {authenticatedUserId === null ? <RootManagedUnauthenticatedApp />
        : typeof authenticatedUserId === 'string' ? (
          <AuthenticatedStartup key={JSON.stringify([authenticatedUserId, session.epoch])}
            authSession={authSession} userId={authenticatedUserId} onPresentation={presentStartup}
            isCurrentSession={() => currentSession.current === session} />
        ) : null}
    </StartupSurface>
  );
}

function AuthenticatedStartup({ authSession, userId, isCurrentSession, onPresentation }: {
  authSession: AuthSessionService; userId: string; isCurrentSession: () => boolean;
  onPresentation: (value: StartupPresentation) => void;
}) {
  const [ready, setReady] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('disabled');
  const [previewFinished, setPreviewFinished] = useState(false);
  const [snapshot, setSnapshot] = useState(() => hasPreviewAccess() ? readStartupSchedulePreview(userId) : null);
  const [startedWithPreview] = useState(Boolean(snapshot));
  const mounted = useRef(false);
  const sessionGuard = useRef(isCurrentSession);
  useLayoutEffect(() => { sessionGuard.current = isCurrentSession; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const changed = () => setSnapshot(hasPreviewAccess() ? readStartupSchedulePreview(userId) : null);
    window.addEventListener?.('storage', changed);
    return () => window.removeEventListener?.('storage', changed);
  }, [userId]);
  const capture = useCallback<ScheduleReadObserver>(source => {
    const user = authSession.getCurrentUser();
    if (!mounted.current || !sessionGuard.current() || source.ownerId !== userId || user?.id !== userId
      || user.requiresEmailVerification || !hasPreviewAccess()) return;
    saveStartupSchedulePreview(source);
  }, [authSession, userId]);
  const report = useCallback((status: PreviewStatus) => setPreviewStatus(status), []);
  const previewBoundary = useMemo(() => ({ capture, report, active: startedWithPreview && !previewFinished }), [capture, report, startedWithPreview, previewFinished]);
  useLayoutEffect(() => { if (ready && previewStatus === 'ready') setPreviewFinished(true); }, [ready, previewStatus]);
  const markReady = useCallback(() => setReady(true), []);
  const holdPreviewBoundary = startedWithPreview && !previewFinished && previewStatus !== 'disabled'
    && (!ready || previewStatus !== 'ready');
  const showPreview = holdPreviewBoundary && hasPreviewAccess() && (snapshot || previewStatus === 'failed');
  const presentation = useMemo<StartupPresentation>(() => ({
    loading: !ready || holdPreviewBoundary,
    preview: showPreview ? <StartupSchedulePreview snapshot={snapshot} failed={previewStatus === 'failed'} /> : undefined,
  }), [ready, holdPreviewBoundary, showPreview, snapshot, previewStatus]);
  useLayoutEffect(() => { onPresentation(presentation); }, [onPresentation, presentation]);
  return (
    <RootStartupReadyProvider onReady={markReady}>
      <AuthenticatedStudyPlannerApp authSession={authSession} userId={userId} onStartupReady={markReady} previewBoundary={previewBoundary} />
    </RootStartupReadyProvider>
  );
}
