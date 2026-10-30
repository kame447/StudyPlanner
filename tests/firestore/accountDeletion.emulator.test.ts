import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAccountDeletionApi } from '../../workers/ai-proxy/src/accountDeletionApi';
import { handleWeeklyPlanningTraceApi } from '../../workers/ai-proxy/src/weeklyPlanningTraceApi';
import { WeeklyPlanningTraceFirestoreClient } from '../../workers/ai-proxy/src/weeklyPlanningTraceFirestore';
import { resolveWeeklyPlanningTraceEpoch } from '../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

// Real Auth accounts, Firestore documents, Rules and the production Worker
// handler. The fetch adapter only redirects Google transports to loopback.
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT ?? 'demo-studyplanner';
const enabled = Boolean(firestoreHost && authHost);
const realFetch = globalThis.fetch.bind(globalThis);
const run = `${Date.now()}`;
const tokenProvider = { getToken: async () => 'owner' };
const epoch = Number(resolveWeeklyPlanningTraceEpoch(new Date()));
const quotaClears: string[] = [];
const env = {
  FIREBASE_PROJECT_ID: project, FIREBASE_WEB_API_KEY: 'demo-key',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'emulator@example.test', FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({ [epoch]: 'e'.repeat(64) }),
  OBSERVABILITY_IDENTITY_SECRET: 'synthetic-emulator-identity-secret',
  AI_QUOTA: { getByName: (name: string) => ({ clearForAccountDeletion: async () => { quotaClears.push(name); } }) },
};
const server = new WeeklyPlanningTraceFirestoreClient(env, tokenProvider);
interface Account { uid: string; email: string; idToken: string }
const password = 'synthetic-deletion-password';
let injectFailureUid: string | null = null;
let injected = false;
const topCollections = ['plans', 'schedule_events', 'actuals', 'day_notes', 'month_events', 'todos',
  'study_subjects', 'study_materials', 'schedule_templates', 'timetable_terms', 'timetable_periods'];

async function auth(operation: string, body: object, admin = false) {
  return realFetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(body),
  });
}
async function register(label: string): Promise<Account> {
  const email = `deletion-${label}-${run}@example.test`;
  const signed = await auth('signUp', { email, password, returnSecureToken: true });
  expect(signed.ok).toBe(true);
  const user = await signed.json() as { localId: string; idToken: string };
  const verified = await auth('update', { localId: user.localId, emailVerified: true }, true);
  expect(verified.ok).toBe(true);
  return { uid: user.localId, email, idToken: user.idToken };
}
async function reauthenticate(account: Account): Promise<string> {
  const result = await auth('signInWithPassword', { email: account.email, password, returnSecureToken: true });
  expect(result.ok).toBe(true);
  return (await result.json() as { idToken: string }).idToken;
}
async function deleteAccount(token: string) {
  return handleAccountDeletionApi(new Request('https://worker.test/account/delete', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'delete-my-account' }),
  }), env, tokenProvider);
}
async function trace(uid: string) {
  const call = (path: string, body: object) => handleWeeklyPlanningTraceApi(new Request(`https://worker.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, { uid }, tokenProvider);
  expect((await call('/weekly-planning-trace/policy/accept', {})).status).toBe(200);
  const now = new Date().toISOString();
  const metadata = { status: 'active', startedAt: now, lastActivityAt: now, turnCount: 0, entryCount: 0,
    hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false, appVersion: 'emulator', schemaVersion: 1 };
  const started = await call('/weekly-planning-trace/session/start', {
    idempotencyKey: `deletion-${uid}-${run}`, conversationCorrelationKey: `deletion-conversation-${uid}`, session: metadata,
  });
  expect(started.status).toBe(200);
  const sessionId = String(started.body.sessionId), logicalConversationId = String(started.body.logicalConversationId);
  const entryId = `${sessionId}-00000000`;
  const appended = await call('/weekly-planning-trace/append', {
    session: { ...metadata, id: sessionId, logicalConversationId, turnCount: 1, entryCount: 1 },
    entries: [{ id: entryId, sessionId, logicalConversationId, sequence: 0,
      occurredAt: now, observedAt: now, schemaVersion: 1, kind: 'internal_event',
      eventType: 'user_turn_received', severity: 'info', requestId: `deletion-${uid}`, payload: { source: 'client' } }],
  });
  expect(appended.status).toBe(200);
  return [['weekly_planning_trace_sessions', sessionId], ['weekly_planning_trace_entries', entryId]];
}
async function seed(account: Account): Promise<string[][]> {
  const uid = account.uid;
  const docs: Array<{ collection: string; id: string; value: Record<string, unknown> }> = [];
  for (const collection of topCollections) docs.push({ collection, id: uid, value: { userId: uid, title: 'synthetic legacy-compatible row' } });
  for (const collection of ['schedule_event_migrations', 'study_rest_days', 'weekly_planning_personalization_profiles', 'user_planning_contexts', 'profiles', 'support_inquiry_limits']) {
    docs.push({ collection, id: uid, value: { userId: uid } });
  }
  docs.push(
    { collection: 'support_inquiries', id: uid, value: { userId: uid, schemaVersion: 1, body: 'synthetic support' } },
    { collection: 'weekly_planning_approval_operations', id: uid, value: { userId: uid } },
    { collection: `weekly_planning_approval_operations/${uid}/weekly_planning_approval_items`, id: 'item', value: { userId: uid } },
    { collection: `class_attendance/${uid}/classes`, id: 'lesson', value: { userId: uid } },
    { collection: `class_attendance/${uid}/classes/lesson/records`, id: '2026-10-30', value: { userId: uid } },
    { collection: 'announcement_reads', id: uid, value: { through: 'synthetic' } },
    { collection: `announcement_reads/${uid}/items`, id: 'item', value: { publishedAt: 'synthetic' } },
    { collection: 'weekly_planning_trace_sessions', id: `legacy-${uid}`, value: { userId: uid } },
    { collection: 'weekly_planning_trace_entries', id: `legacy-${uid}-entry`, value: { userId: uid, sessionId: `legacy-${uid}` } },
  );
  // Exercise page boundaries as well as the handler's invocation budget.
  for (let index = 0; index < 105; index += 1) docs.push({ collection: 'todos', id: `${uid}-${index}`, value: { userId: uid } });
  await server.commitWrites(docs);
  return [...docs.map(doc => [doc.collection, doc.id]), ...await trace(uid)];
}

describe.skipIf(!enabled)('account deletion through real Worker/Auth/Firestore emulators', () => {
  beforeAll(() => {
    if (!project.startsWith('demo-') || ![firestoreHost, authHost].every(host => /^(127\.0\.0\.1|localhost):\d+$/.test(host!))) {
      throw new Error('Explicit loopback Auth + Firestore emulators and demo project required');
    }
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (injectFailureUid && !injected && url.endsWith('/documents:commit') && typeof init?.body === 'string'
        && init.body.includes(`/plans/${injectFailureUid}`) && init.body.includes('"delete"')) {
        injected = true;
        return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'synthetic injected failure' } }), { status: 503 });
      }
      if (url.startsWith('https://firestore.googleapis.com/')) return realFetch(url.replace('https://firestore.googleapis.com', `http://${firestoreHost}`), init);
      if (url.startsWith('https://identitytoolkit.googleapis.com/')) return realFetch(url.replace('https://identitytoolkit.googleapis.com', `http://${authHost}/identitytoolkit.googleapis.com`), init);
      throw new Error('Non-emulator network forbidden');
    });
  });
  afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('rejects stale reauth, blocks resurrection first, resumes failure, deletes A completely, and preserves B', async () => {
    const a = await register('a'), b = await register('b');
    // A normal client save crosses the actual owner Rules before privileged
    // fixtures add legacy schemas and server-only trace/subcollection records.
    for (const account of [a, b]) {
      const saved = await realFetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/plans/${account.uid}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${account.idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { userId: { stringValue: account.uid }, title: { stringValue: 'synthetic client plan' } } }),
      });
      expect(saved.ok).toBe(true);
    }
    const aDocs = await seed(a), bDocs = await seed(b);
    const bBefore = await Promise.all(bDocs.map(([collection, id]) => server.getDocument(collection, id)));
    const future = Date.now() + 301_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(future);
    const stale = await deleteAccount(a.idToken);
    now.mockRestore();
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ errorCode: 'account_deletion_reauth_required' });
    expect(await server.getDocument('account_deletions', a.uid)).toBeNull();
    const recentToken = await reauthenticate(a);
    injectFailureUid = a.uid;
    const concurrent = await Promise.all([deleteAccount(recentToken), deleteAccount(recentToken)]);
    const statuses: number[] = concurrent.map(result => result.status);
    expect(statuses.some(status => status !== 409)).toBe(true);
    for (const result of concurrent) {
      expect([200, 202, 409, 503]).toContain(result.status);
      if (result.status === 409) expect(await result.json()).toMatchObject({ errorCode: 'account_deletion_in_progress' });
      else await result.body?.cancel();
    }
    let blockedWriteChecked = false, secondDeviceTraceChecked = false, completed = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const checkpoint = await server.getDocument('account_deletions', a.uid);
      const completedSteps = checkpoint?.completedSteps;
      if (!secondDeviceTraceChecked && Array.isArray(completedSteps) && completedSteps.includes('traces')) {
        // A second open device still has a valid Auth token. Its trace request
        // must fail at policy admission after the profile and traces are gone.
        const lookup = await auth('lookup', { idToken: a.idToken });
        expect(lookup.ok).toBe(true);
        expect(await lookup.json()).toMatchObject({ users: [{ localId: a.uid }] });
        const timestamp = new Date().toISOString();
        const refused = await handleWeeklyPlanningTraceApi(new Request('https://worker.test/weekly-planning-trace/session/start', {
          method: 'POST', headers: { Authorization: `Bearer ${a.idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey: `second-device-${a.uid}-${run}`, conversationCorrelationKey: `second-device-${a.uid}`,
            session: { status: 'active', startedAt: timestamp, lastActivityAt: timestamp, turnCount: 0, entryCount: 0,
              hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false, appVersion: 'emulator', schemaVersion: 1 },
          }),
        }), env, { uid: a.uid }, tokenProvider);
        expect(refused.status).toBe(412);
        expect(refused.body).toMatchObject({ errorCode: 'trace_policy_required', errorCategory: 'policy' });
        secondDeviceTraceChecked = true;
      }
      const result = await deleteAccount(recentToken); statuses.push(result.status);
      if (!blockedWriteChecked && await server.getDocument('account_deletions', a.uid)) {
        const staleWrite = await realFetch(`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents/todos/resurrection-${a.uid}`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${a.idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { userId: { stringValue: a.uid }, title: { stringValue: 'must never return' } } }),
        });
        expect(staleWrite.status).toBe(403); blockedWriteChecked = true;
      }
      if (result.status === 200) { expect(await result.json()).toEqual({ status: 'completed' }); completed = true; break; }
      expect([202, 503]).toContain(result.status);
      if (result.status === 202) expect(await result.json()).toEqual({ status: 'in_progress' });
    }
    expect(injected).toBe(true); expect(statuses).toContain(503); expect(statuses).toContain(202);
    expect(blockedWriteChecked).toBe(true); expect(secondDeviceTraceChecked).toBe(true); expect(completed).toBe(true);
    for (const [collection, id] of aDocs) expect(await server.getDocument(collection, id), `${collection}/${id}`).toBeNull();
    for (let index = 0; index < bDocs.length; index += 1) {
      const [collection, id] = bDocs[index]; expect(await server.getDocument(collection, id)).toEqual(bBefore[index]);
    }
    const job = await server.getDocument('account_deletions', a.uid);
    expect(job).toMatchObject({ uid: a.uid, status: 'completed' });
    expect(quotaClears).toContain(`uid:${a.uid}`);
    const relogin = await auth('signInWithPassword', { email: a.email, password, returnSecureToken: true });
    expect(relogin.ok).toBe(false);
    expect((await auth('signInWithPassword', { email: b.email, password, returnSecureToken: true })).ok).toBe(true);
    // A repeat request cannot mutate B or resurrect A. Auth has been deleted,
    // so accounts:lookup rejects the old token before the already-finished job.
    expect((await deleteAccount(recentToken)).status).toBe(401);
    expect(await server.getDocument('account_deletions', a.uid)).toEqual(job);
  }, 120_000);
});
