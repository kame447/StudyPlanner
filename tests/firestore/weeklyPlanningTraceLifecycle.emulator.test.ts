import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleWeeklyPlanningTraceApi } from '../../workers/ai-proxy/src/weeklyPlanningTraceApi';
import { ProductObservabilityWeeklyPlanningDiagnosticAdapter } from '../../workers/ai-proxy/src/productObservabilityWeeklyPlanningDiagnosticAdapter';
import { WeeklyPlanningTraceFirestoreClient } from '../../workers/ai-proxy/src/weeklyPlanningTraceFirestore';
import {
  ProductObservabilityRetentionService,
  WEEKLY_PLANNING_TRACE_RETENTION_COLLECTIONS,
} from '../../workers/ai-proxy/src/productObservabilityRetention';
import {
  createWeeklyPlanningTraceSubject,
  resolveWeeklyPlanningTraceEpoch,
  resolveWeeklyPlanningTraceHmacSecretRing,
} from '../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

// Drives the real Worker trace handlers and the Logs/Debug Bundle adapter
// against the local Firestore emulator. Never points at an online project.
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(firestoreHost);
const PROJECT = 'demo-studyplanner';
const RUN = `${Date.now()}`;
const OWNER_UID = `trace-owner-${RUN}`;
const OTHER_UID = `trace-other-${RUN}`;
const ADMIN_UID = `trace-admin-${RUN}`;
const STRANGER_UID = `trace-stranger-${RUN}`;
const SECRET_EMAIL = `owner-${RUN}@example.test`;
const SECRET_PHONE = '090-1234-5678';
const SECRET_URL_QUERY = `token=url-${RUN}`;
const SECRET_CREDENTIAL = `sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8t${RUN}`;
const DIAGNOSTIC_TASK_ID = 'task-123e4567-e89b-12d3-a456-426614174000';
const COLLECTIONS = [
  'weekly_planning_trace_sessions',
  'weekly_planning_trace_entries',
  'weekly_planning_trace_access_audit',
] as const;

const currentEpoch = Number(resolveWeeklyPlanningTraceEpoch(new Date()));
// The primary root is far enough back that the retention-window derivation no
// longer covers an epoch whose session was kept alive by later appends.
const ROOT_EPOCH = currentEpoch - 10;
const OUTLIVED_EPOCH = currentEpoch - 8;
const env = {
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'emulator@example.test',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-with-emulator-owner-token',
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({ [ROOT_EPOCH]: 'r'.repeat(64) }),
};
const tokenProvider = { getToken: async () => 'owner' };
const realFetch = globalThis.fetch;

function emulatorUrl(input: RequestInfo | URL): string {
  const url = String(input instanceof Request ? input.url : input);
  return url.replace('https://firestore.googleapis.com', `http://${firestoreHost}`);
}

async function listAll(collection: string): Promise<Record<string, unknown>[]> {
  const response = await realFetch(
    `http://${firestoreHost}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?pageSize=1000`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const payload = await response.json() as { documents?: Array<{ fields: Record<string, { stringValue?: string }> }> };
  return (payload.documents ?? []).map((document) => Object.fromEntries(
    Object.entries(document.fields).map(([key, value]) => [key, value.stringValue ?? value]),
  ));
}

async function call(uid: string, path: string, body?: Record<string, unknown>) {
  return handleWeeklyPlanningTraceApi(
    new Request(`https://example.test${path}`, body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    env,
    { uid },
    tokenProvider,
  );
}

function sessionMetadata(entryCount: number): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    status: 'active', startedAt: now, lastActivityAt: now, turnCount: entryCount, entryCount,
    hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false,
    appVersion: 'emulator', schemaVersion: 1,
  };
}

function turnDiagnosticV2(
  base: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  const text = `連絡は ${SECRET_EMAIL} / ${SECRET_PHONE} https://example.test/p?${SECRET_URL_QUERY} ${SECRET_CREDENTIAL}`;
  return {
    ...base, occurredAt: now, observedAt: now, schemaVersion: 2, kind: 'turn_diagnostic',
    traceSchema: 'weekly-planning-turn-diagnostic-v2', turnIndex: 0,
    userInput: { text },
    aiInterpreter: {
      input: { userText: text, conversationContext: [], requests: [] },
      rawResponses: [{ attempt: 'initial', text: `{"note":"${text}"}` }],
      structuredResults: [], candidateOperations: [],
    },
    parsers: [],
    decision: {
      acceptedOperations: [], rejectedOperations: [],
      finalOperations: [{ operation: 'set_planning_window', taskId: DIAGNOSTIC_TASK_ID }],
    },
    constraintContext: { existingPlanCount: 0, scheduleTemplateCount: 0, relevantBusyIntervals: [] },
    assistantOutput: { text: null, responseSource: 'ai' },
    diagnostics: { outcome: 'revision_pending', previewCount: 0, stale: false },
  };
}

async function consentStartAppend(uid: string, key: string) {
  expect((await call(uid, '/weekly-planning-trace/policy/accept', {})).status).toBe(200);
  const started = await call(uid, '/weekly-planning-trace/session/start', {
    idempotencyKey: `weekly-trace-${key}`,
    conversationCorrelationKey: `conversation-${key}`,
    session: sessionMetadata(0),
  });
  expect(started.status).toBe(200);
  const sessionId = String(started.body.sessionId);
  const logicalConversationId = String(started.body.logicalConversationId);
  const now = new Date().toISOString();
  const appended = await call(uid, '/weekly-planning-trace/append', {
    session: { ...sessionMetadata(2), id: sessionId, logicalConversationId },
    entries: [{
      id: `${sessionId}-00000000`, sessionId, logicalConversationId, sequence: 0,
      occurredAt: now, observedAt: now, schemaVersion: 1, kind: 'internal_event',
      eventType: 'user_turn_received', severity: 'info', requestId: `request-${key}`,
      payload: { source: 'client', note: `連絡先は ${SECRET_EMAIL} です` },
    }, turnDiagnosticV2({
      id: `${sessionId}-00000001`, sessionId, logicalConversationId, sequence: 1,
      requestId: `request-${key}`,
    }, now)],
  });
  expect(appended.status).toBe(200);
  return { sessionId };
}

async function seedOutlivedEpochSession(uid: string) {
  const ring = await resolveWeeklyPlanningTraceHmacSecretRing({
    raw: env.WEEKLY_PLANNING_TRACE_HMAC_SECRETS, derivedCoverage: 'since-root',
  });
  const subject = await createWeeklyPlanningTraceSubject(uid, String(OUTLIVED_EPOCH), ring);
  const firestore = new WeeklyPlanningTraceFirestoreClient(env, tokenProvider);
  const id = `weekly-trace-00000000-0000-4000-8000-${RUN.slice(-12).padStart(12, '0')}`;
  const expireAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await firestore.setDocument('weekly_planning_trace_sessions', id, {
    id, traceSubjectToken: subject.token, traceSubjectEpoch: subject.epoch, expireAt,
  });
  await firestore.setDocument('weekly_planning_trace_entries', `${id}-00000000`, {
    id: `${id}-00000000`, sessionId: id, traceSubjectToken: subject.token, expireAt,
  });
  return subject.token;
}

// Pre-server-authority browser writes: raw userId, no subject token, no id field.
async function seedLegacyBrowserTrace(uid: string, suffix: string) {
  const firestore = new WeeklyPlanningTraceFirestoreClient(env, tokenProvider);
  const id = `legacy-${suffix}-${RUN}`;
  const expireAt = new Date(Date.now() - 86_400_000).toISOString();
  await firestore.setDocument('weekly_planning_trace_sessions', id, { userId: uid, expireAt });
  await firestore.setDocument('weekly_planning_trace_entries', `${id}-00000000`, {
    userId: uid, sessionId: id, expireAt,
  });
  return id;
}

describe.skipIf(!enabled)('weekly planning trace lifecycle on the Firestore emulator', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(emulatorUrl(input), init));
    const firestore = new WeeklyPlanningTraceFirestoreClient(env, tokenProvider);
    await firestore.setDocument('admins', ADMIN_UID, { enabled: true, weeklyPlanningTraceReader: true });
    await firestore.setDocument('admins', STRANGER_UID, { enabled: true });
  });

  afterAll(() => { vi.unstubAllGlobals(); });

  it('runs consent → append → audited Logs/Debug Bundle → audited complete delete', async () => {
    const owned = await consentStartAppend(OWNER_UID, `owner-${RUN}`);
    const other = await consentStartAppend(OTHER_UID, `other-${RUN}`);
    const outlivedToken = await seedOutlivedEpochSession(OWNER_UID);

    // Server-written fields never carry the raw account id or the redacted
    // email, phone, URL query or credential, in schema v1 or v2 entries.
    for (const collection of COLLECTIONS) {
      const serialized = JSON.stringify(await listAll(collection));
      expect(serialized).not.toContain(OWNER_UID);
      for (const secret of [SECRET_EMAIL, SECRET_PHONE, SECRET_URL_QUERY, SECRET_CREDENTIAL]) {
        expect(serialized).not.toContain(secret);
      }
    }
    const storedDiagnostic = JSON.stringify((await listAll('weekly_planning_trace_entries'))
      .find((document) => document.id === `${owned.sessionId}-00000001`));
    expect(storedDiagnostic).toContain('weekly-planning-turn-diagnostic-v2');
    expect(storedDiagnostic).toContain(DIAGNOSTIC_TASK_ID);
    expect(storedDiagnostic).toContain('[EMAIL] / [PHONE] https://example.test/p?[QUERY_REDACTED] [TOKEN]');
    const legacyOwned = await seedLegacyBrowserTrace(OWNER_UID, 'owner');
    const legacyOther = await seedLegacyBrowserTrace(OTHER_UID, 'other');

    // Unauthorized readers are refused before any trace read or audit write.
    const auditBefore = (await listAll('weekly_planning_trace_access_audit')).length;
    for (const uid of [OWNER_UID, STRANGER_UID]) {
      const refused = await call(uid, '/weekly-planning-trace/admin/sessions');
      expect(refused.status).toBe(403);
      const adapter = new ProductObservabilityWeeklyPlanningDiagnosticAdapter(env, tokenProvider);
      await expect(adapter.assertTraceReader(uid)).rejects.toThrow('observability_trace_reader_forbidden');
    }
    expect((await listAll('weekly_planning_trace_access_audit')).length).toBe(auditBefore);

    // An authorized reader can page Logs and export a redacted Debug Bundle.
    const adapter = new ProductObservabilityWeeklyPlanningDiagnosticAdapter(env, tokenProvider);
    await adapter.assertTraceReader(ADMIN_UID);
    const page = await adapter.listSessions({ sessionId: owned.sessionId });
    expect(JSON.stringify(page)).toContain(owned.sessionId);
    const entries = await adapter.listEntries({ sessionId: owned.sessionId });
    expect(entries.entries).toHaveLength(2);
    const bundle = await adapter.createDebugBundle({ sessionId: owned.sessionId });
    for (const output of [JSON.stringify(entries), JSON.stringify(bundle)]) {
      expect(output).toContain('turn_diagnostic');
      expect(output).not.toContain(OWNER_UID);
      for (const secret of [SECRET_EMAIL, SECRET_PHONE, SECRET_URL_QUERY, SECRET_CREDENTIAL]) {
        expect(output).not.toContain(secret);
      }
    }
    const readActions = (await listAll('weekly_planning_trace_access_audit'))
      .map((document) => document.action);
    expect(readActions).toEqual(expect.arrayContaining([
      'list_sessions', 'list_entries_page', 'create_debug_bundle',
    ]));

    // The owner's delete removes every epoch, including one outside the
    // retention derivation window, and the legacy raw-userId schema, while
    // leaving another user's traces intact.
    const deleted = await call(OWNER_UID, '/weekly-planning-trace/delete', {});
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deletedSessions: 3, deletedEntries: 4 });
    const sessions = await listAll('weekly_planning_trace_sessions');
    const remainingEntries = await listAll('weekly_planning_trace_entries');
    const remaining = JSON.stringify([...sessions, ...remainingEntries]);
    expect(sessions.map((document) => document.id)).not.toContain(owned.sessionId);
    expect(remaining).not.toContain(outlivedToken);
    expect(remaining).not.toContain(OWNER_UID);
    expect(remaining).not.toContain(legacyOwned);
    expect(remaining).toContain(legacyOther);
    expect(sessions.map((document) => document.id)).toContain(other.sessionId);
    expect(remainingEntries.some((document) => document.sessionId === other.sessionId)).toBe(true);
    const deleteAudits = (await listAll('weekly_planning_trace_access_audit'))
      .filter((document) => document.action === 'delete_own_traces');
    expect(deleteAudits).toHaveLength(1);
    expect(deleteAudits[0].actorToken).toMatch(/^wpt_/);
    expect(deleteAudits[0].expireAt).toBeTruthy();
    expect(JSON.stringify(deleteAudits)).not.toContain(OWNER_UID);

    // The scheduled sweeper enforces expireAt on real Firestore timestamps:
    // the already-expired legacy trace goes, unexpired traces and audits stay.
    const expiredOnly = await new WeeklyPlanningTraceFirestoreClient(env, tokenProvider)
      .queryDocumentsAfter({
        collection: 'weekly_planning_trace_sessions',
        orderByField: 'expireAt',
        limit: 100,
        endAtTimestamp: new Date().toISOString(),
      });
    expect(expiredOnly.map((document) => document.id)).toEqual([legacyOther]);
    const sweeper = new ProductObservabilityRetentionService(
      env,
      new WeeklyPlanningTraceFirestoreClient(env, tokenProvider),
      undefined,
      WEEKLY_PLANNING_TRACE_RETENTION_COLLECTIONS,
    );
    expect(await sweeper.runBatch(100)).toEqual({ deleted: 2, hasMore: false });
    const swept = JSON.stringify([
      ...await listAll('weekly_planning_trace_sessions'),
      ...await listAll('weekly_planning_trace_entries'),
    ]);
    expect(swept).not.toContain(legacyOther);
    expect(swept).toContain(other.sessionId);
    expect((await listAll('weekly_planning_trace_access_audit'))
      .some((document) => document.action === 'delete_own_traces')).toBe(true);
  });
});
