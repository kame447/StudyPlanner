import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, ListTree, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { WeeklyPlanningTraceDebugPage } from '../features/weeklyPlanning/trace/WeeklyPlanningTraceDebugPage';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { getFirebaseAuth } from '../lib/firebaseClient';
import { AdminGuard } from './AdminGuard';
import { AdminRoutes } from './AdminViews';

const TRACE_PATH = '/admin/weekly-planning-traces';

export function AdminApp() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
  const [userId, setUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const { status } = useAdminStatus(userId);

  const navigate = useCallback(
    (path: string, options: { replace?: boolean } = {}) => {
      if (path !== '/admin' && !path.startsWith('/admin/')) {
        window.location.assign(path);
        return;
      }

      if (window.location.pathname !== path) {
        if (options.replace) {
          window.history.replaceState({}, '', path);
        } else {
          window.history.pushState({}, '', path);
        }
      }
      setCurrentPath(path);
    },
    [],
  );

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setUserId(null);
      setAuthResolved(true);
      return undefined;
    }
    return onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid ?? null);
      setAuthResolved(true);
    });
  }, []);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (!authResolved) {
    return (
      <div className="app-shell admin-app-shell">
        <main className="admin-shell">
          <section className="admin-state-card panel" aria-live="polite">
            <strong>認証状態を確認しています</strong>
          </section>
        </main>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="app-shell admin-app-shell">
        <main className="admin-shell">
          <section className="admin-state-card panel" role="alert">
            <strong>ログインが必要です</strong>
            <p>通常画面でログインしてから管理者画面を開いてください。</p>
            <a className="ghost-button admin-header-link" href="/">通常画面へ戻る</a>
          </section>
        </main>
      </div>
    );
  }

  const isTracePage = currentPath === TRACE_PATH;
  const showGlobalReturn = currentPath !== '/admin' && currentPath !== '/admin/users';

  return (
    <div className="app-shell admin-app-shell">
      <AdminGuard status={status}>
        <nav className="panel admin-global-nav" aria-label="管理者画面ナビゲーション">
          <button
            className={!isTracePage ? 'segment active' : 'segment'}
            onClick={() => navigate('/admin/users')}
            type="button"
          >
            <Users aria-hidden="true" size={17} strokeWidth={2} />
            ユーザー
          </button>
          <button
            className={isTracePage ? 'segment active' : 'segment'}
            onClick={() => navigate(TRACE_PATH)}
            type="button"
          >
            <ListTree aria-hidden="true" size={17} strokeWidth={2} />
            週間計画ログ
          </button>
          {showGlobalReturn ? (
            <a className="ghost-button admin-header-link" href="/">
              <ArrowLeft aria-hidden="true" size={17} strokeWidth={2} />
              通常画面へ戻る
            </a>
          ) : null}
        </nav>

        {isTracePage ? (
          <WeeklyPlanningTraceDebugPage onBack={() => navigate('/admin/users')} />
        ) : (
          <AdminRoutes path={currentPath} navigate={navigate} />
        )}
      </AdminGuard>
    </div>
  );
}
