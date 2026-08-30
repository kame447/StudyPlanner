import { resolveAdminRoute } from '../lib/adminRoutes';
import { AdminAiApiPage } from './AdminAiApiPage';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminUserDetailPage } from './AdminUserDetailPage';
import { AdminUsersPage } from './AdminUsersPage';

interface AdminRoutesProps {
  path: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

export function AdminRoutes({ path, navigate }: AdminRoutesProps) {
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

  return (
    <main className="admin-shell">
      <section className="admin-state-card panel">
        <strong>ページが見つかりません</strong>
      </section>
    </main>
  );
}
