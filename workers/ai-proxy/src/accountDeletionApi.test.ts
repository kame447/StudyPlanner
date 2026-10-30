import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAccountDeletionApi, type AccountDeletionEnv } from './accountDeletionApi';
import { encodeFirestoreFields, decodeFirestoreFields } from './firestoreValueCodec';
import { resolveWeeklyPlanningTraceEpoch } from './weeklyPlanningTracePrivacy';
import { ProductObservabilityStore } from './productObservabilityStore';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';
import { sweepExpiredAccountDeletions } from './accountDeletionJob';

const NOW = Date.UTC(2026, 9, 30, 12, 0);
const BASE = 'projects/deletion-test/databases/(default)/documents';
const tokenProvider = { getToken: async () => 'owner' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function idToken(uid = 'owner', authTime = NOW / 1000) {
  return `header.${btoa(JSON.stringify({ sub: uid, aud: 'deletion-test',
    iss: 'https://securetoken.google.com/deletion-test', auth_time: authTime, exp: NOW / 1000 + 3600 }))}.signature`;
}

// A wire-level fake drives the real API, trace deletion, client codec and job.
// Queries match only persisted fields; parent listings include missing docs.
class FakeFirestore {
  documents = new Map<string, Record<string, unknown>>();
  events: string[] = [];
  failCollection: string | null = null;
  failQueryNumber: number | null = null;
  queryCounts = new Map<string, number>();
  commits: any[] = [];
  deleteAuthError: string | null = null;
  emailVerified = true;
  origin?: string;
  private document(path: string) {
    return { name: `${BASE}/${path}`, fields: encodeFirestoreFields(this.documents.get(path) ?? {}), updateTime: '2026-10-30T00:00:00Z' };
  }
  fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      const claims = JSON.parse(atob(body.idToken.split('.')[1]));
      if (url.pathname.endsWith('accounts:lookup')) return response({ users: [{ localId: claims.sub, emailVerified: this.emailVerified }] });
      this.events.push('auth');
      return this.deleteAuthError ? response({ error: { message: this.deleteAuthError } }, 400) : response({});
    }
    expect(url.hostname).toBe('firestore.googleapis.com');
    const suffix = decodeURIComponent(url.pathname.split('/documents')[1]);
    if (suffix === ':runQuery') {
      const query = body.structuredQuery;
      const collection = query.from[0].collectionId;
      const queryNumber = (this.queryCounts.get(collection) ?? 0) + 1;
      this.queryCounts.set(collection, queryNumber);
      if (collection === this.failCollection && (this.failQueryNumber === null || this.failQueryNumber === queryNumber)) {
        return response({}, 503);
      }
      const filters = query.where?.compositeFilter?.filters ?? (query.where ? [query.where] : []);
      const matches = [...this.documents.keys()].filter((path) => {
        if (!path.startsWith(`${collection}/`) || path.slice(collection.length + 1).includes('/')) return false;
        const doc = this.documents.get(path)!;
        if (!filters.every(({ fieldFilter: f }: any) => f.op === 'IN'
          ? f.value.arrayValue.values.some((value: any) => doc[f.field.fieldPath] === value.stringValue)
          : doc[f.field.fieldPath] === f.value.stringValue)) return false;
        const orderField = query.orderBy?.[0].field.fieldPath;
        const end = query.endAt?.values?.[0];
        if (end && String(doc[orderField]) > (end.stringValue ?? end.timestampValue)) return false;
        return true;
      }).sort();
      return response(matches.slice(0, query.limit ?? 500).map((path) => ({ document: this.document(path) })));
    }
    if (suffix === ':commit') {
      this.commits.push(...body.writes);
      for (const write of body.writes) {
        const path = (write.delete ?? write.update.name).split('/documents/')[1];
        this.events.push(`${write.delete ? 'delete' : 'write'}:${path}`);
        if (write.delete) this.documents.delete(path);
        else {
          const value = decodeFirestoreFields(write.update.fields);
          this.documents.set(path, write.updateMask ? { ...this.documents.get(path), ...value } : value);
        }
      }
      return response({});
    }
    const path = suffix.slice(1);
    if (init?.method === 'POST' && url.searchParams.has('documentId')) {
      const documentPath = `${path}/${url.searchParams.get('documentId')}`;
      if (this.documents.has(documentPath)) return response({}, 409);
      this.events.push(`write:${documentPath}`);
      this.documents.set(documentPath, decodeFirestoreFields(body.fields));
      return response(this.document(documentPath));
    }
    if (init?.method === 'PATCH') {
      this.events.push(`write:${path}`);
      this.documents.set(path, decodeFirestoreFields(body.fields));
      return response(this.document(path));
    }
    if (url.searchParams.get('showMissing') === 'true') {
      const ids = [...new Set([...this.documents.keys()].flatMap((key) =>
        key.startsWith(`${path}/`) ? [key.slice(path.length + 1).split('/')[0]] : []))].sort();
      return response({ documents: ids.slice(0, Number(url.searchParams.get('pageSize'))).map((id) => this.document(`${path}/${id}`)) });
    }
    return this.documents.has(path) ? response(this.document(path)) : response({}, 404);
  };
}

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const fake = new FakeFirestore();
  vi.stubGlobal('fetch', fake.fetch);
  const clearForAccountDeletion = vi.fn(async () => { fake.events.push('quota'); });
  const deleteAttachments = vi.fn(async (_keys: string[]) => { fake.events.push('r2'); });
  const env: AccountDeletionEnv = {
    FIREBASE_PROJECT_ID: 'deletion-test', FIREBASE_WEB_API_KEY: 'fake',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'emulator@example.test', FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
    WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({ [resolveWeeklyPlanningTraceEpoch(new Date())]: 'r'.repeat(64) }),
    OBSERVABILITY_IDENTITY_SECRET: 's'.repeat(64), ALLOWED_ORIGIN: 'https://app.example.test',
    AI_QUOTA: { getByName: vi.fn(() => ({ clearForAccountDeletion })) },
    INQUIRY_ATTACHMENTS: { delete: deleteAttachments },
  };
  const request = (body: unknown = { confirm: 'delete-my-account' }, token = idToken(), origin?: string) =>
    new Request('https://worker.test/account/delete', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body) });
  const call = (body?: unknown, token?: string, origin?: string) => handleAccountDeletionApi(request(body, token, origin), env, tokenProvider);
  const complete = async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await call();
      statuses.push(result.status);
      if (result.status !== 202) return { result, statuses };
      expect(await result.json()).toEqual({ status: 'in_progress' });
    }
    throw new Error('deletion did not complete within bounded retries');
  };
  return { fake, env, call, request, complete, deleteAttachments, clearForAccountDeletion };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('account deletion API', () => {
  it('rejects any body uid and missing/incorrect confirmation before any writes', async () => {
    const { call, fake } = setup();
    for (const body of [{ uid: 'victim', confirm: 'delete-my-account' }, {}, { confirm: 'yes' }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(fake.events).toEqual([]);
  });

  it('requires recent auth_time before creating the tombstone', async () => {
    const { call, fake } = setup();
    const result = await call(undefined, idToken('owner', NOW / 1000 - 301));
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ errorCode: 'account_deletion_reauth_required' });
    expect(fake.events).toEqual([]);
  });

  it('rejects active admins without deleting data', async () => {
    const { call, fake } = setup();
    fake.documents.set('admins/owner', { enabled: true });
    const result = await call();
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ errorCode: 'account_deletion_admin_forbidden' });
    expect(fake.events).toEqual([]);
  });

  it('allows a recently authenticated unverified account to leave', async () => {
    const { fake, complete } = setup();
    fake.emailVerified = false;
    expect((await complete()).result.status).toBe(200);
    expect(fake.events).toContain('auth');
  });

  it('deletes an inquiry with attachment metadata when uploads have no R2 binding', async () => {
    const { env, fake, complete, deleteAttachments } = setup();
    delete env.INQUIRY_ATTACHMENTS;
    fake.documents.set('support_inquiries/mine', { schemaVersion: 2, userId: 'owner', attachments: [{}, {}] });
    expect((await complete()).result.status).toBe(200);
    expect(fake.documents.has('support_inquiries/mine')).toBe(false);
    expect(deleteAttachments).not.toHaveBeenCalled();
    expect(fake.documents.get('account_deletions/owner')?.completedSteps).toContain('support_inquiries');
  });

  it('uses the verified token uid, keeps other users intact, and deletes data in the required order', async () => {
    const { fake, env, complete, call, deleteAttachments } = setup();
    const actor = await new ProductObservabilityStore(env, new FirestoreServiceAccountClient(env, tokenProvider)).resolveActorSubjectId('owner');
    fake.documents.set('plans/mine', { userId: 'owner' });
    fake.documents.set('plans/theirs', { userId: 'other' });
    fake.documents.set('support_inquiries/mine', { userId: 'owner', attachments: [{}, {}] });
    fake.documents.set('support_inquiries/theirs', { userId: 'other', attachments: [{}] });
    fake.documents.set('profiles/owner', { email: 'private@example.test' });
    fake.documents.set('profiles/other', { email: 'other@example.test' });
    fake.documents.set('weekly_planning_trace_entries/legacy', { userId: 'owner' });
    fake.documents.set('weekly_planning_approval_operations/mine', { userId: 'owner' });
    fake.documents.set('weekly_planning_approval_operations/mine/weekly_planning_approval_items/item', { userId: 'owner' });
    fake.documents.set('class_attendance/owner/classes/template/records/date', { userId: 'owner' });
    fake.documents.set('class_attendance/other/classes/template/records/date', { userId: 'other' });
    fake.documents.set('announcement_reads/owner/items/message', { read: true });
    fake.documents.set('observability_events/mine', { actorSubjectId: actor });
    fake.documents.set('observability_events/theirs', { actorSubjectId: 'actor-other' });
    fake.documents.set('observability_actor_day/mine', { actorSubjectId: actor });
    for (const environment of ['production', 'preview', 'development', 'test']) {
      fake.documents.set(`observability_user_summary_${environment}/${actor}`, { actorSubjectId: actor });
    }
    fake.documents.set('observability_active_user_snapshot_accumulator/main:01', { actorFlags: `${actor}:7\nactor-other:3` });
    fake.documents.set('observability_daily_rollups/day', { count: 20 });
    fake.events = [];

    const { result, statuses } = await complete();
    expect(statuses).toContain(202);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'completed' });
    expect(fake.events[0]).toBe('write:account_deletions/owner');
    const traceIndex = fake.events.indexOf('delete:weekly_planning_trace_entries/legacy');
    expect(traceIndex).toBeLessThan(fake.events.indexOf('delete:support_inquiries/mine'));
    expect(fake.events.indexOf('r2')).toBeLessThan(fake.events.indexOf('delete:support_inquiries/mine'));
    expect(fake.events.indexOf('delete:plans/mine')).toBeLessThan(fake.events.indexOf('delete:profiles/owner'));
    expect(fake.events.indexOf('delete:profiles/owner')).toBeLessThan(fake.events.indexOf('auth'));
    expect(fake.events.filter((event) => event.startsWith('delete:')).at(-1)).toBe('delete:profiles/owner');
    expect(deleteAttachments).toHaveBeenCalledWith(['inquiries/mine/0', 'inquiries/mine/1']);
    expect(env.AI_QUOTA.getByName).toHaveBeenCalledWith('uid:owner');
    expect(env.AI_QUOTA.getByName).toHaveBeenCalledWith('telemetry:uid:owner');
    expect(fake.documents.get('account_deletions/owner')).toMatchObject({ schemaVersion: 1, uid: 'owner', status: 'completed' });
    expect(fake.documents.get('account_deletions/owner')?.expiresAt).toBe(new Date(NOW + 180 * 86_400_000).toISOString());
    expect(fake.documents.has('plans/mine')).toBe(false);
    expect(fake.documents.has('weekly_planning_approval_operations/mine/weekly_planning_approval_items/item')).toBe(false);
    expect(fake.documents.has('class_attendance/owner/classes/template/records/date')).toBe(false);
    expect(fake.documents.has('announcement_reads/owner/items/message')).toBe(false);
    expect(fake.documents.has('observability_events/mine')).toBe(false);
    expect(fake.documents.has('observability_actor_day/mine')).toBe(false);
    expect(fake.documents.get('observability_active_user_snapshot_accumulator/main:01')?.actorFlags).toBe('actor-other:3');
    for (const key of ['plans/theirs', 'profiles/other', 'support_inquiries/theirs',
      'class_attendance/other/classes/template/records/date', 'observability_events/theirs', 'observability_daily_rollups/day']) {
      expect(fake.documents.has(key), key).toBe(true);
    }
    const events = [...fake.events];
    expect((await call()).status).toBe(200);
    expect(fake.events).toEqual(events);
  });

  it('persists a retryable failure then resumes after the last completed data step', async () => {
    const { fake, call, complete } = setup();
    fake.documents.set('plans/mine', { userId: 'owner' });
    fake.documents.set('todos/mine', { userId: 'owner' });
    fake.documents.set('profiles/owner', {});
    fake.failCollection = 'todos';
    const failed = await call();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ errorCode: 'account_deletion_retryable', retryable: true });
    const job = fake.documents.get('account_deletions/owner');
    expect(job).toMatchObject({ status: 'deleting', lastErrorCode: 'account_deletion_retryable' });
    expect(job?.completedSteps).toContain('plans');
    expect(fake.documents.has('plans/mine')).toBe(false);
    expect(fake.documents.has('profiles/owner')).toBe(true);
    expect(fake.events).not.toContain('auth');
    fake.failCollection = null;
    expect((await complete()).result.status).toBe(200);
    expect(fake.events.filter((event) => event === 'delete:plans/mine')).toHaveLength(1);
    expect(fake.documents.get('account_deletions/owner')?.lastErrorCode).toBeUndefined();
  });

  it('maps Identity Toolkit recent-login failures to reauthentication and keeps the tombstone', async () => {
    const { fake, complete } = setup();
    fake.deleteAuthError = 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN';
    const { result } = await complete();
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ errorCode: 'account_deletion_reauth_required' });
    expect(fake.documents.get('account_deletions/owner')?.status).toBe('deleting');
    fake.deleteAuthError = null;
    expect((await complete()).result.status).toBe(200);
  });

  it('retries a collection whose first page was deleted before its second-page failure', async () => {
    const { fake, call, complete } = setup();
    for (let index = 0; index < 501; index++) fake.documents.set(`plans/plan-${index}`, { userId: 'owner' });
    fake.documents.set('plans/other', { userId: 'other' });
    fake.failCollection = 'plans';
    fake.failQueryNumber = 2;
    expect((await call()).status).toBe(503);
    expect([...fake.documents.values()].filter((doc) => doc.userId === 'owner')).toHaveLength(1);
    expect(fake.documents.get('account_deletions/owner')?.completedSteps).not.toContain('plans');
    fake.failCollection = null;
    expect((await complete()).result.status).toBe(200);
    expect([...fake.documents.values()].filter((doc) => doc.userId === 'owner')).toHaveLength(0);
    expect(fake.documents.has('plans/other')).toBe(true);
  });

  it('applies allowed-origin CORS to preflight and all API responses', async () => {
    const { env, call } = setup();
    expect((await call(undefined, undefined, 'https://evil.example')).status).toBe(403);
    const preflight = await handleAccountDeletionApi(new Request('https://worker.test/account/delete', {
      method: 'OPTIONS', headers: { Origin: 'https://app.example.test' },
    }), env, tokenProvider);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  it('sweeps expired completed and unfinished tombstones and retains unexpired records', async () => {
    const { fake, env } = setup();
    const expired = new Date(NOW - 1).toISOString();
    fake.documents.set('account_deletions/old-completed', { status: 'completed', expiresAt: expired });
    fake.documents.set('account_deletions/old-deleting', { status: 'deleting', expiresAt: expired });
    fake.documents.set('account_deletions/keep', { status: 'completed', expiresAt: new Date(NOW + 1).toISOString() });
    expect(await sweepExpiredAccountDeletions(new FirestoreServiceAccountClient(env, tokenProvider))).toBe(2);
    expect([...fake.documents.keys()]).toEqual(['account_deletions/keep']);
    expect(fake.commits).toEqual([
      { delete: `${BASE}/account_deletions/old-completed`, currentDocument: { updateTime: '2026-10-30T00:00:00Z' } },
      { delete: `${BASE}/account_deletions/old-deleting`, currentDocument: { updateTime: '2026-10-30T00:00:00Z' } },
    ]);
  });
});
