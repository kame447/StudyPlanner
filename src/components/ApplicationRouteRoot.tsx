import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { installBottomSheetDragDismiss } from '../lib/bottomSheetDragDismiss';
import { installStudySessionSwipeNavigation } from '../lib/studySessionSwipeNavigation';
import { subscribeAppHistory } from '../lib/appHistory';
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

/** Switch application roots without replacing the document or the auth session. */
export function ApplicationRouteRoot({ authSession: injected }: { authSession?: AuthSessionService } = {}) {
  const [admin, setAdmin] = useState(isAdminPath);
  const sharedSession = useRef<AuthSessionService>();
  // Ordinary/public startup retains its existing lazy authentication boundary.
  // Only admin entry owns a shared wrapper, which survives return navigation.
  if (admin && !injected && !sharedSession.current) sharedSession.current = createAuthSessionService();
  const authSession = injected ?? sharedSession.current;
  useEffect(() => subscribeAppHistory(() => setAdmin(isAdminPath())), []);
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
  }, []);
  return admin
    ? <AdminLoadBoundary onReturnToApp={returnToApp}>
      <Suspense fallback={<p role="status">管理者画面を開いています</p>}><LazyAdminApp authSession={authSession} onReturnToApp={returnToApp} /></Suspense>
    </AdminLoadBoundary>
    : <LaplanceAppRoot authSession={authSession} />;
}
