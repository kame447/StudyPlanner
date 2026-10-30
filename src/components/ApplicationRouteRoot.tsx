import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import { installBottomSheetDragDismiss } from '../lib/bottomSheetDragDismiss';
import { installStudySessionSwipeNavigation } from '../lib/studySessionSwipeNavigation';
import { APP_HISTORY_CHANGE, subscribeAppHistory } from '../lib/appHistory';
import { createAuthSessionService, type AuthSessionService } from '../services/authSession';
import { LaplanceAppRoot } from './LaplanceAppRoot';

const LazyAdminApp = lazy(() => import('./AdminApp').then((module) => ({ default: module.AdminApp })));
const isAdminPath = () => window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

class AdminLoadBoundary extends Component<PropsWithChildren<{ onReturnToApp: () => void }>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="app-shell"><section className="panel">
      <h1>管理者画面</h1>
      <p role="alert">管理者画面を読み込めませんでした。再読み込みしてください。</p>
      <p><button type="button" className="ghost-button" onClick={this.props.onReturnToApp}>通常画面へ戻る</button></p>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>再読み込み</button>
    </section></main> : this.props.children;
  }
}

/** Retain a started planner across Admin visits, just like public-page navigation. */
export function ApplicationRouteRoot({ authSession: injected }: { authSession?: AuthSessionService } = {}) {
  const [admin, setAdmin] = useState(isAdminPath);
  const [plannerStarted, setPlannerStarted] = useState(() => !isAdminPath());
  const planner = useRef<HTMLDivElement>(null);
  const previouslyAdmin = useRef(admin);
  const returnScroll = useRef<{ x: number; y: number } | null>(null);
  const sharedSession = useRef<AuthSessionService>();
  // Ordinary/public startup retains its existing lazy authentication boundary.
  // Admin owns its wrapper; never replace a retained planner's auth prop with it.
  // Both wrappers use the same Firebase auth instance, without early public-page auth.
  if (admin && !injected && !sharedSession.current) sharedSession.current = createAuthSessionService();
  const authSession = injected ?? sharedSession.current;
  useEffect(() => subscribeAppHistory(() => {
    const nextAdmin = isAdminPath();
    if (nextAdmin && !admin) returnScroll.current = { x: window.scrollX, y: window.scrollY };
    setAdmin(nextAdmin);
  }), [admin]);
  useEffect(() => { if (!admin) setPlannerStarted(true); }, [admin]);
  useLayoutEffect(() => {
    if (!admin && previouslyAdmin.current) {
      planner.current?.querySelector<HTMLElement>('.primary-app-header button, .primary-app-header a')?.focus({ preventScroll: true });
      if (returnScroll.current) window.scrollTo?.(returnScroll.current.x, returnScroll.current.y);
      returnScroll.current = null;
    }
    previouslyAdmin.current = admin;
  }, [admin]);
  useEffect(() => {
    if (admin) return;
    const removeSwipe = installStudySessionSwipeNavigation();
    const removeDismiss = installBottomSheetDragDismiss();
    return () => { removeSwipe(); removeDismiss(); };
  }, [admin]);
  const returnToApp = useCallback(() => {
    if (!isAdminPath()) return;
    window.history.pushState({}, '', '/');
    setAdmin(false);
    window.dispatchEvent(new Event(APP_HISTORY_CHANGE));
  }, []);
  return <>
    {(plannerStarted || !admin) && <div ref={planner} className="application-planner" hidden={admin} style={{ display: admin ? 'none' : 'contents' }}>
      <LaplanceAppRoot authSession={injected} />
    </div>}
    {admin && <AdminLoadBoundary onReturnToApp={returnToApp}>
      <Suspense fallback={<p role="status">管理者画面を開いています</p>}><LazyAdminApp authSession={authSession} onReturnToApp={returnToApp} /></Suspense>
    </AdminLoadBoundary>}
  </>;
}
