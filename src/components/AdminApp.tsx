import { onAuthStateChanged } from 'firebase/auth';
import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarClock,
  ListTree,
  Settings,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { WeeklyPlanningTraceDebugPage } from '../features/weeklyPlanning/trace/WeeklyPlanningTraceDebugPage';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { getFirebaseAuth } from '../lib/firebaseClient';
import { AdminGuard } from './AdminGuard';
import { AdminRoutes } from './AdminViews';

const TRACE_PATH = '/admin/weekly-planning-traces';

function FutureNavItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      className="admin-console-nav-item is-disabled"
      type="button"
      disabled
      title={`${label}は次フェーズで実装します`}
    >
      {icon}
      <span>{label}</span>
      <small>準備中</small>
    </button>
  );
}

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
      <div className="app-shell admin-app-shell admin-app-shell-state">
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
      <div className="app-shell admin-app-shell admin-app-shell-state">
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

  const isOverviewPage = currentPath === '/admin';
  const isUsersPage = currentPath === '/admin/users' || currentPath.startsWith('/admin/users/');
  const isTracePage = currentPath === TRACE_PATH;

  return (
    <div className="app-shell admin-app-shell">
      <AdminGuard status={status}>
        <div className="admin-console-layout">
          <aside className="admin-console-sidebar">
            <div className="admin-console-brand">
              <span className="admin-console-brand-mark" aria-hidden="true">S</span>
              <div>
                <strong>StudyPlanner</strong>
                <small>Admin Console</small>
              </div>
            </div>

            <nav className="admin-console-nav" aria-label="管理者画面ナビゲーション">
              <button
                className={`admin-console-nav-item${isOverviewPage ? ' active' : ''}`}
                onClick={() => navigate('/admin')}
                type="button"
              >
                <Activity aria-hidden="true" size={19} />
                <span>Overview</span>
              </button>
              <button
                className={`admin-console-nav-item${isUsersPage ? ' active' : ''}`}
                onClick={() => navigate('/admin/users')}
                type="button"
              >
                <Users aria-hidden="true" size={19} />
                <span>Users</span>
              </button>
              <FutureNavItem icon={<Bot aria-hidden="true" size={19} />} label="AI・API" />
              <FutureNavItem icon={<CalendarClock aria-hidden="true" size={19} />} label="Planning" />
              <button
                className={`admin-console-nav-item${isTracePage ? ' active' : ''}`}
                onClick={() => navigate(TRACE_PATH)}
                type="button"
              >
                <ListTree aria-hidden="true" size={19} />
                <span>Logs</span>
              </button>
              <FutureNavItem icon={<Settings aria-hidden="true" size={19} />} label="System" />
            </nav>

            <div className="admin-console-sidebar-footer">
              <a href="/" className="admin-console-return-link">
                <ArrowLeft aria-hidden="true" size={18} />
                通常画面へ戻る
              </a>
              <span>read-only console</span>
            </div>
          </aside>

          <div className="admin-console-main">
            {isTracePage ? (
              <WeeklyPlanningTraceDebugPage onBack={() => navigate('/admin')} />
            ) : (
              <AdminRoutes path={currentPath} navigate={navigate} />
            )}
          </div>
        </div>
      </AdminGuard>
    </div>
  );
}
