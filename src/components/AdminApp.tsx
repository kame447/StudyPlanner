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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { WeeklyPlanningTraceDebugPage } from '../features/weeklyPlanning/trace/WeeklyPlanningTraceDebugPage';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { getFirebaseAuth } from '../lib/firebaseClient';
import '../styles/admin-phase5.css';
import { AdminGuard } from './AdminGuard';
import { AdminRoutes } from './AdminViews';

const TRACE_PATH = '/admin/weekly-planning-traces';

function FutureNavItem({ icon, label }: { icon: ReactNode; label: string }) {
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
      <main className="admin-shell admin-auth-state">
        <section className="admin-state-card panel">
          <strong>認証状態を確認中</strong>
          <p>管理者コンソールへのアクセス権を確認しています。</p>
        </section>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="admin-shell admin-auth-state">
        <section className="admin-state-card panel">
          <strong>ログインが必要です</strong>
          <p>管理者コンソールを利用するにはログインしてください。</p>
          <button className="primary-button" type="button" onClick={() => window.location.assign('/')}>
            StudyPlannerへ戻る
          </button>
        </section>
      </main>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <main className="admin-shell admin-auth-state">
        <section className="admin-state-card panel">
          <strong>管理者権限を確認中</strong>
          <p>アクセス権と管理者状態を確認しています。</p>
        </section>
      </main>
    );
  }

  if (status !== 'allowed') {
    return (
      <main className="admin-shell admin-auth-state">
        <section className="admin-state-card panel">
          <strong>アクセスできません</strong>
          <p>このアカウントには管理者コンソールを表示する権限がありません。</p>
          <button className="primary-button" type="button" onClick={() => window.location.assign('/')}>
            StudyPlannerへ戻る
          </button>
        </section>
      </main>
    );
  }

  const isTracePage = currentPath === TRACE_PATH;
  const isOverviewPage = currentPath === '/admin';
  const isUsersPage = currentPath === '/admin/users' || currentPath.startsWith('/admin/users/');
  const isAiPage = currentPath === '/admin/ai';

  return (
    <AdminGuard>
      <div className="admin-console-layout">
        <aside className="admin-console-sidebar">
          <a className="admin-console-brand" href="/" aria-label="StudyPlannerへ戻る">
            <ArrowLeft size={17} aria-hidden="true" />
            <span>StudyPlanner</span>
          </a>
          <nav className="admin-console-nav" aria-label="管理者画面ナビゲーション">
            <button
              className={`admin-console-nav-item ${isOverviewPage ? 'active' : ''}`}
              type="button"
              onClick={() => navigate('/admin')}
            >
              <Activity size={18} aria-hidden="true" />
              <span>Overview</span>
            </button>
            <button
              className={`admin-console-nav-item ${isUsersPage ? 'active' : ''}`}
              type="button"
              onClick={() => navigate('/admin/users')}
            >
              <Users size={18} aria-hidden="true" />
              <span>Users</span>
            </button>
            <button
              className={`admin-console-nav-item ${isAiPage ? 'active' : ''}`}
              type="button"
              onClick={() => navigate('/admin/ai')}
            >
              <Bot size={18} aria-hidden="true" />
              <span>AI・API</span>
            </button>
            <FutureNavItem icon={<CalendarClock size={18} aria-hidden="true" />} label="Planning" />
            <button
              className={`admin-console-nav-item ${isTracePage ? 'active' : ''}`}
              type="button"
              onClick={() => navigate(TRACE_PATH)}
            >
              <ListTree size={18} aria-hidden="true" />
              <span>Logs</span>
            </button>
            <FutureNavItem icon={<Settings size={18} aria-hidden="true" />} label="System" />
          </nav>
        </aside>
        <div className="admin-console-content">
          {isTracePage ? <WeeklyPlanningTraceDebugPage /> : <AdminRoutes path={currentPath} navigate={navigate} />}
        </div>
      </div>
    </AdminGuard>
  );
}
