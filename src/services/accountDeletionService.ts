import { pauseAccountClientWrites, resumeAccountClientWrites } from './accountDeletionClientState';
import { doc, getDocFromServer } from 'firebase/firestore';
import { getCloudflareAiProxyUrl } from '../lib/aiConfig';
import { getFirebaseAuth, getFirestoreDb } from '../lib/firebaseClient';
import { authRepository } from '../repositories';

export type AccountDeletionResult =
  | { status: 'completed' }
  | { status: 'in_progress' }
  | { status: 'reauth_required' }
  | { status: 'failed'; reason: 'authentication' | 'request' | 'admin_forbidden' | 'session_changed' | 'unconfirmed' };

interface DeletionDependencies {
  reauthenticate(password?: string): Promise<void>;
  getSession(): { uid: string; getIdToken(forceRefresh?: boolean): Promise<string> } | null;
  authAccountGone(): Promise<boolean>;
  endpoint(): string;
  request: typeof fetch;
}

export function createAccountDeletionService(deps: DeletionDependencies) {
  return async (uid: string, password?: string): Promise<AccountDeletionResult> => {
    const user = deps.getSession();
    if (!user || user.uid !== uid) return { status: 'failed', reason: 'session_changed' };
    try { await deps.reauthenticate(password); }
    catch {
      // Auth is gone but no completion was recorded: never report success.
      return { status: 'failed', reason: await deps.authAccountGone() ? 'unconfirmed' : 'authentication' };
    }
    if (deps.getSession() !== user) return { status: 'failed', reason: 'session_changed' };
    try {
      // Keep the recent token for the bounded job, including the final response
      // after the server deletes Auth. Never infer completion from a generic 401.
      const token = await user.getIdToken(true);
      pauseAccountClientWrites(uid);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (deps.getSession() !== user) return { status: 'failed', reason: 'session_changed' };
        const response = await deps.request(deps.endpoint(), {
          method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(60_000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'delete-my-account' }),
        });
        if (deps.getSession() !== user) return { status: 'failed', reason: 'session_changed' };
        const body = await response.json() as { status?: string; errorCode?: string };
        if (response.status === 200 && body.status === 'completed') return { status: 'completed' };
        if (response.status === 202 && body.status === 'in_progress') continue;
        if (response.status === 401 && body.errorCode === 'account_deletion_reauth_required') return { status: 'reauth_required' };
        // Auth absence alone is not completion evidence (it can also be removed
        // outside this job); the operator runbook resolves this state.
        if (response.status === 401 && await deps.authAccountGone()) return { status: 'failed', reason: 'unconfirmed' };
        if (body.errorCode === 'account_deletion_admin_forbidden') resumeAccountClientWrites(uid);
        return { status: 'failed', reason: body.errorCode === 'account_deletion_admin_forbidden' ? 'admin_forbidden' : 'request' };
      }
      return { status: 'in_progress' };
    } catch { return { status: 'failed', reason: 'request' }; }
  };
}

export const deleteAccount = createAccountDeletionService({
  reauthenticate: async password => {
    if (!authRepository.reauthenticate) throw new Error('再認証を利用できません。');
    await authRepository.reauthenticate(password);
  },
  getSession: () => getFirebaseAuth()?.currentUser ?? null,
  endpoint: () => {
    const proxy = getCloudflareAiProxyUrl();
    if (!proxy) throw new Error('退会処理を利用できません。');
    return new URL('/account/delete', proxy).toString();
  },
  request: (...args) => fetch(...args),
  authAccountGone: async () => {
    const user = getFirebaseAuth()?.currentUser;
    if (!user) return false;
    try { await user.reload(); return false; }
    catch (error) { return (error as { code?: string }).code === 'auth/user-not-found'; }
  },
});

export async function hasPendingAccountDeletion(uid: string): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db) return false;
  const snapshot = await getDocFromServer(doc(db, 'account_deletions', uid));
  // Even a completed tombstone must prevent a stale signed-in device editing.
  if (snapshot.exists()) pauseAccountClientWrites(uid);
  return snapshot.exists();
}

export async function accountDeletionProvider(): Promise<'password' | 'google' | 'unavailable'> {
  const user = getFirebaseAuth()?.currentUser;
  if (!user) return 'unavailable';
  const token = await user.getIdTokenResult();
  return token.signInProvider === 'google.com' ? 'google' : token.signInProvider === 'password' ? 'password' : 'unavailable';
}
