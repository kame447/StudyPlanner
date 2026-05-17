import { useEffect, useState } from 'react';
import { subscribeAdminStatus } from '../services/adminService';

export type AdminStatus = 'checking' | 'allowed' | 'denied';

export function useAdminStatus(uid: string | null | undefined): {
  status: AdminStatus;
  isAdmin: boolean;
} {
  const [status, setStatus] = useState<AdminStatus>(() =>
    uid ? 'checking' : 'denied',
  );

  useEffect(() => {
    if (!uid) {
      setStatus('denied');
      return undefined;
    }

    setStatus('checking');

    return subscribeAdminStatus(uid, (nextIsAdmin) => {
      setStatus(nextIsAdmin ? 'allowed' : 'denied');
    });
  }, [uid]);

  return {
    status,
    isAdmin: status === 'allowed',
  };
}
