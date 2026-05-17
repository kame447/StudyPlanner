import type { ReactNode } from 'react';
import type { AdminStatus } from '../hooks/useAdminStatus';

interface AdminGuardProps {
  status: AdminStatus;
  children: ReactNode;
}

export function AdminGuard({ status, children }: AdminGuardProps) {
  if (status === 'checking') {
    return (
      <div className="admin-shell">
        <section className="admin-state-card panel" aria-live="polite">
          <strong>管理者権限を確認しています</strong>
          <p>権限確認が完了するまで管理画面は表示されません。</p>
        </section>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="admin-shell">
        <section className="admin-state-card panel" role="alert">
          <strong>アクセス権限がありません</strong>
          <p>管理者として許可されたアカウントでログインしてください。</p>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
