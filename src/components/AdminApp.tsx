import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarClock,
  ListTree,
  Menu,
  X,
  MessageSquare,
  Bell,
  Settings,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { createAuthSessionService, type AuthSessionService } from '../services/authSession';
import '../styles/admin-console.css';
import '../styles/admin-overview-range-safety.css';
import '../styles/admin-phase5.css';
import '../styles/admin-phase6.css';
import '../styles/admin-phase7.css';
import '../styles/admin-phase8.css';
import '../styles/admin-mobile.css';
import { AdminGuard } from './AdminGuard';
import { AdminRoutes } from './AdminViews';

export function AdminApp({
  authSession: injectedAuthSession,
  onReturnToApp,
}: { authSession?: AuthSessionService; onReturnToApp?: () => void } = {}) {
  const authSession = useMemo(
    () => injectedAuthSession ?? createAuthSessionService(),
    [injectedAuthSession],
  );
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
  const [userId, setUserId] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const { status } = useAdminStatus(userId);
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 820px)').matches ?? false);
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerOpen = mobile && menuOpen && status === 'allowed';
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const { dialogRef } = useDialogFocus<HTMLElement>(drawerOpen, closeMenu);
  const swipe = useSwipeNavigation({
    onPrevious: () => setMenuOpen(true), onNext: closeMenu,
    disabled: !mobile || status !== 'allowed', allowDialogSwipe: true,
  });

  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 820px)');
    if (!query) return undefined;
    const update = () => { setMobile(query.matches); setMenuOpen(false); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (status !== 'allowed') setMenuOpen(false);
  }, [status]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [drawerOpen]);

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
      setMenuOpen(false);
    },
    [],
  );

  useEffect(() => {
    if (!authSession.available) {
      setUserId(null);
      setAuthResolved(true);
      return undefined;
    }
    return authSession.subscribe((user) => {
      setUserId(user?.id ?? null);
      setAuthResolved(true);
    });
  }, [authSession]);

  useEffect(() => {
    const handlePopState = () => { setCurrentPath(window.location.pathname); setMenuOpen(false); };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const returnHeader = <header className="admin-return-header" {...(drawerOpen ? { inert: '' } : {})}>
    {status === 'allowed' && <button type="button" className="admin-menu-toggle" aria-label="管理メニューを開く"
      aria-expanded={drawerOpen} aria-controls="admin-navigation" onClick={() => setMenuOpen(true)}><Menu aria-hidden="true" size={20} /></button>}
    <a href="/" className="admin-console-return-link" onClick={onReturnToApp ? (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onReturnToApp();
    } : undefined}><ArrowLeft aria-hidden="true" size={18} />通常画面へ戻る</a>
    <span>管理者画面</span>
  </header>;

  if (!authResolved) {
    return (
      <div className="app-shell admin-app-shell admin-app-shell-state">
        {returnHeader}
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
        {returnHeader}
        <main className="admin-shell">
          <section className="admin-state-card panel" role="alert">
            <strong>ログインが必要です</strong>
            <p>通常画面でログインしてから管理者画面を開いてください。</p>
          </section>
        </main>
      </div>
    );
  }

  const isOverviewPage = currentPath === '/admin';
  const isUsersPage = currentPath === '/admin/users' || currentPath.startsWith('/admin/users/');
  const isAiPage = currentPath === '/admin/ai';
  const isPlanningPage = currentPath === '/admin/planning';
  const isLogsPage = currentPath === '/admin/logs';
  const isInquiriesPage = currentPath === '/admin/inquiries';
  const isAnnouncementsPage = currentPath === '/admin/announcements';
  const isSystemPage = currentPath === '/admin/system';

  return (
    <div className={`app-shell admin-app-shell${drawerOpen ? ' admin-menu-open' : ''}`} {...swipe}
      onTouchStart={(event) => {
        // Leave OS edge gestures and horizontally scrollable data surfaces alone.
        const x = event.touches[0]?.clientX;
        if (x === undefined || x < 24 || x > window.innerWidth - 24
          || (event.target instanceof Element && (event.target.closest('table, pre, .admin-bar-chart, [data-swipe-ignore="true"]')
            || (event.target.closest('[role="dialog"]') && event.target.closest('[role="dialog"]') !== dialogRef.current)))) {
          swipe.onTouchCancel(); return;
        }
        swipe.onTouchStart(event);
      }}>
      {returnHeader}
      <AdminGuard status={status}>
        <div className="admin-console-layout">
          <aside className="admin-console-sidebar" id="admin-navigation" ref={dialogRef}
            role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen ? true : undefined}
            aria-label="管理メニュー" tabIndex={drawerOpen ? -1 : undefined}
            {...(mobile && !drawerOpen ? { inert: '' } : {})}>
            <button type="button" className="admin-menu-close" aria-label="管理メニューを閉じる" onClick={closeMenu}><X aria-hidden="true" size={20} /></button>
            <div className="admin-console-brand">
              <span className="admin-console-brand-mark" aria-hidden="true">L</span>
              <div>
                <strong>Laplance</strong>
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
              <button
                className={`admin-console-nav-item${isAiPage ? ' active' : ''}`}
                onClick={() => navigate('/admin/ai')}
                type="button"
              >
                <Bot aria-hidden="true" size={19} />
                <span>AI・API</span>
              </button>
              <button
                className={`admin-console-nav-item${isPlanningPage ? ' active' : ''}`}
                onClick={() => navigate('/admin/planning')}
                type="button"
              >
                <CalendarClock aria-hidden="true" size={19} />
                <span>Planning</span>
              </button>
              <button
                className={`admin-console-nav-item${isLogsPage ? ' active' : ''}`}
                onClick={() => navigate('/admin/logs')}
                type="button"
              >
                <ListTree aria-hidden="true" size={19} />
                <span>Logs</span>
              </button>
              <button
                className={`admin-console-nav-item${isSystemPage ? ' active' : ''}`}
                onClick={() => navigate('/admin/system')}
                type="button"
              >
                <Settings aria-hidden="true" size={19} />
                <span>System</span>
              </button>
              <button
                className={`admin-console-nav-item${isInquiriesPage ? ' active' : ''}`}
                onClick={() => navigate('/admin/inquiries')}
                type="button"
              >
                <MessageSquare aria-hidden="true" size={19} />
                <span>お問い合わせ</span>
              </button>
              <button className={`admin-console-nav-item${isAnnouncementsPage ? ' active' : ''}`} onClick={() => navigate('/admin/announcements')} type="button">
                <Bell aria-hidden="true" size={19} /><span>お知らせ</span>
              </button>
            </nav>

            <div className="admin-console-sidebar-footer">
              <span>Admin Console</span>
            </div>
          </aside>

          <div className="admin-console-main" {...(drawerOpen ? { inert: '' } : {})}>
            <AdminRoutes userId={userId} key={userId} path={currentPath} navigate={navigate} />
          </div>
        </div>
      </AdminGuard>
      {drawerOpen && <button type="button" className="admin-menu-backdrop" aria-label="管理メニューを閉じる" tabIndex={-1} onClick={closeMenu} />}
    </div>
  );
}
