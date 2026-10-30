import {
  FirestoreServiceAccountTokenProvider,
  type FirestoreTokenProvider,
} from './firestoreServiceAccountClient';
import { WeeklyPlanningTraceFirestoreClient } from './weeklyPlanningTraceFirestore';
import { deleteWeeklyPlanningTraces, type WeeklyPlanningTraceApiEnv } from './weeklyPlanningTraceApi';
import { ProductObservabilityStore } from './productObservabilityStore';
import {
  AccountDeletionBudget,
  AccountDeletionBusy,
  AccountDeletionReauthRequired,
  runAccountDeletionJob,
} from './accountDeletionJob';
import { WEEKLY_PLANNING_TRACE_WORKER_REVISION } from '../../../shared/weeklyPlanningTraceContract';

export interface AccountDeletionEnv extends WeeklyPlanningTraceApiEnv {
  FIREBASE_WEB_API_KEY: string;
  ALLOWED_ORIGIN?: string;
  OBSERVABILITY_IDENTITY_SECRET?: string;
  INQUIRY_ATTACHMENTS?: Pick<R2Bucket, 'delete'>;
  AI_QUOTA: {
    getByName(name: string): { clearForAccountDeletion(): Promise<void> };
  };
}

function headersFor(request: Request, env: AccountDeletionEnv): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', Vary: 'Origin',
  });
  const origin = request.headers.get('Origin');
  if (origin && (env.ALLOWED_ORIGIN ?? '').split(',').map((value) => value.trim()).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

export async function handleAccountDeletionApi(
  request: Request,
  env: AccountDeletionEnv,
  tokenProvider?: FirestoreTokenProvider,
): Promise<Response> {
  const headers = headersFor(request, env);
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers });
  const origin = request.headers.get('Origin');
  if (origin && !headers.has('Access-Control-Allow-Origin')) {
    return json(403, { errorCode: 'account_deletion_origin_forbidden' });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { errorCode: 'account_deletion_method_not_allowed' });
  if (!env.FIREBASE_WEB_API_KEY?.trim()) return json(503, { errorCode: 'account_deletion_unavailable', retryable: true });
  let body: unknown;
  try { body = await request.json(); } catch { return json(400, { errorCode: 'account_deletion_confirmation_required' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || (body as Record<string, unknown>).confirm !== 'delete-my-account'
    || Object.keys(body).some((key) => key !== 'confirm')) {
    return json(400, { errorCode: 'account_deletion_confirmation_required' });
  }
  const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return json(401, { errorCode: 'account_deletion_auth_required' });

  const budget = new AccountDeletionBudget();
  const identityRequest = async (operation: 'lookup' | 'delete') => {
    budget.beforeSubrequest('identity_toolkit');
    // Keep the same googleapis.com boundary used by the other Firebase handlers;
    // emulator tests rewrite fetch without a production-only transport path.
    return fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
  };
  try {
    // Same Identity Toolkit verification as existing worker endpoints, without
    // their emailVerified admission requirement: unverified accounts can leave.
    const lookup = await identityRequest('lookup');
    if (!lookup.ok) return json(401, { errorCode: 'account_deletion_auth_required' });
    const payload = await lookup.json() as {
      users?: Array<{ localId?: string; disabled?: boolean; validSince?: string }>;
    };
    const user = payload.users?.[0];
    if (!user?.localId || user.disabled) return json(401, { errorCode: 'account_deletion_auth_required' });
    let claims: { sub?: string; aud?: string; iss?: string; auth_time?: number; exp?: number };
    try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return json(401, { errorCode: 'account_deletion_auth_required' }); }
    const now = Date.now() / 1000;
    const validSince = user.validSince === undefined ? 0 : Number(user.validSince);
    if (claims.sub !== user.localId || claims.aud !== env.FIREBASE_PROJECT_ID
      || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
      || !Number.isFinite(claims.exp) || claims.exp! <= now) {
      return json(401, { errorCode: 'account_deletion_auth_required' });
    }
    if (!Number.isInteger(claims.auth_time) || claims.auth_time! > now
      || now - claims.auth_time! > 300 || !Number.isFinite(validSince) || claims.auth_time! < validSince) {
      return json(401, { errorCode: 'account_deletion_reauth_required' });
    }
    const provider = tokenProvider
      ? { getToken: () => tokenProvider.getToken(), subrequestObserver: budget }
      : new FirestoreServiceAccountTokenProvider(env, undefined, undefined, budget);
    const firestore = new WeeklyPlanningTraceFirestoreClient(env, provider);
    if ((await firestore.getDocument('admins', user.localId))?.enabled === true) {
      return json(403, { errorCode: 'account_deletion_admin_forbidden' });
    }
    const uid = user.localId;
    const workerRevision = env.WEEKLY_PLANNING_TRACE_WORKER_REVISION || WEEKLY_PLANNING_TRACE_WORKER_REVISION;
    let actor: Promise<string | null> | undefined;
    const status = await runAccountDeletionJob(uid, {
      firestore, budget, workerRevision,
      deleteTraces: async () => {
        const result = await deleteWeeklyPlanningTraces({
          pathname: '/account/delete', correlationId: crypto.randomUUID(), workerRevision,
        }, firestore, env, { uid });
        return Number(result.body.deletedEntries) + Number(result.body.deletedSessions);
      },
      actorSubjectId: () => actor ??= new ProductObservabilityStore(env, firestore).lookupActorSubjectId(uid),
      deleteAttachments: async (keys) => {
        // Without this optional binding uploads are unavailable, while inquiry
        // text and attachment descriptors can still have been accepted.
        if (!env.INQUIRY_ATTACHMENTS) return;
        await env.INQUIRY_ATTACHMENTS.delete(keys);
      },
      clearQuota: (name) => env.AI_QUOTA.getByName(name).clearForAccountDeletion(),
      deleteAuth: async () => {
        const response = await identityRequest('delete');
        if (response.ok) { await response.body?.cancel(); return; }
        const error = await response.json() as { error?: { message?: string } };
        if (error.error?.message === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') throw new AccountDeletionReauthRequired();
        throw new Error('account_deletion_auth_failed');
      },
    });
    return json(status === 'completed' ? 200 : 202, { status });
  } catch (error) {
    if (error instanceof AccountDeletionReauthRequired) return json(401, { errorCode: 'account_deletion_reauth_required' });
    if (error instanceof AccountDeletionBusy) return json(409, { errorCode: 'account_deletion_in_progress', retryable: true });
    // Neither provider messages nor account/content data cross this boundary.
    return json(503, { errorCode: 'account_deletion_retryable', retryable: true });
  } finally { budget.logCompletion(); }
}
