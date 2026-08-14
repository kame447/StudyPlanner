import { useEffect } from 'react';
import { resolveAdminRoute } from '../lib/adminRoutes';
import { AdminAppReturnButton } from './AdminAppReturnButton';
import { AdminUserDetailPage } from './AdminUserDetailPage';
import { AdminUsersPage } from './AdminUsersPage';

interface AdminRoutesProps {
  path: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

export function AdminRoutes({ path, navigate }: AdminRoutesProps) {
  const route = resolveAdminRoute(path);

  useEffect(() => {
    if (route.type === 'redirect-to-users') {
      navigate('/admin/users', { replace: true });
    }
  }, [navigate, route.type]);

  if (route.type === 'redirect-to-users') {
    return (
      <main className="admin-shell">
        <AdminAppReturnButton onReturn={() => navigate('/')} />

        <section className="admin-state-card panel">
          <strong>管理者画面へ移動しています</strong>
        </section>
      </main>
    );
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

  return (
    <main className="admin-shell">
      <section className="admin-state-card panel">
        <strong>ページが見つかりません</strong>
      </section>
    </main>
  );
}
