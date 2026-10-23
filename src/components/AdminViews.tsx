import { lazy, Suspense } from 'react';
import { resolveAdminRoute } from '../lib/adminRoutes';
import { AdminInquiriesPage } from './AdminInquiriesPage';
import { AdminAiApiPage } from './AdminAiApiPage';
import { AdminLogsPage } from './AdminLogsPage';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminPlanningPage } from './AdminPlanningPage';
import { AdminSystemPage } from './AdminSystemPage';
import { AdminUserDetailPage } from './AdminUserDetailPage';
import { AdminUsersPage } from './AdminUsersPage';

const AdminAnnouncementsPage = lazy(() => import('./AdminAnnouncementsPage').then((module) => ({ default: module.AdminAnnouncementsPage })));

interface AdminRoutesProps {
  userId: string;
  path: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

export function AdminRoutes({ path, navigate, userId }: AdminRoutesProps) {
  const route = resolveAdminRoute(path);

  if (route.type === 'overview') {
    return <AdminOverviewPage navigate={(nextPath) => navigate(nextPath)} />;
  }

  if (route.type === 'users') {
    return <AdminUsersPage navigate={(nextPath) => navigate(nextPath)} />;
  }

  if (route.type === 'user-detail') {
    return (
      <AdminUserDetailPage
        userId={route.userId}
        navigate={(nextPath) => navigate(nextPath)}
      />
    );
  }

  if (route.type === 'ai-api') {
    return <AdminAiApiPage />;
  }

  if (route.type === 'planning') {
    return <AdminPlanningPage />;
  }

  if (route.type === 'logs') {
    return <AdminLogsPage />;
  }

  if (route.type === 'inquiries') {
    return <AdminInquiriesPage />;
  }

  if (route.type === 'announcements') {
    return <Suspense fallback={<p role="status">お知らせ管理を開いています</p>}><AdminAnnouncementsPage key={userId} userId={userId} /></Suspense>;
  }

  if (route.type === 'system') {
    return <AdminSystemPage />;
  }

  return (
    <main className="admin-shell">
      <section className="admin-state-card panel">
        <strong>ページが見つかりません</strong>
      </section>
    </main>
  );
}
