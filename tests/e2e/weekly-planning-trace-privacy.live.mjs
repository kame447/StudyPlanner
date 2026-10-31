import { expect, test } from '@playwright/test';
import { fillSecret } from './support/fill-secret.mjs';

// Production check of the weekly-planning trace privacy boundary (Issue #45).
// The shared-account test writes one isolated synthetic session and never
// calls /delete, /admin/sessions or /admin/archive, so traces that other runs
// left on the shared account are neither read nor removed. That session holds
// only masked fictitious text and expires after 180 days.
// Deletion runs only on a dedicated trace-only account (STUDYPLANNER_TRACE_E2E_*),
// whose traces are all synthetic.

function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for live-account verification.`);
  }
  return value;
}

const liveEmail = requireSecret('STUDYPLANNER_LIVE_EMAIL');
const livePassword = requireSecret('STUDYPLANNER_LIVE_PASSWORD');
const liveAccessKey = process.env.STUDYPLANNER_LIVE_ACCESS_KEY?.trim() ?? '';
const traceApiUrl = (process.env.STUDYPLANNER_LIVE_TRACE_API_URL?.trim()
  || 'https://studyplanner-ai-proxy.kame-website.workers.dev').replace(/\/$/, '');
const traceAccountEmail = process.env.STUDYPLANNER_TRACE_E2E_EMAIL?.trim() ?? '';
const traceAccountPassword = process.env.STUDYPLANNER_TRACE_E2E_PASSWORD?.trim() ?? '';
const runId = process.env.GITHUB_RUN_ID?.trim() || `${Date.now()}`;

const CONTRACT_VERSION = '2026-07-29-v4';
const SYNTHETIC_EMAIL = `trace-live-${runId}@example.test`;
const SYNTHETIC_PHONE = '090-0000-0000';
const SYNTHETIC_URL_QUERY = `token=url-${runId}`;
const SYNTHETIC_CREDENTIAL = `sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8t${runId}`;
const DIAGNOSTIC_TASK_ID = 'task-123e4567-e89b-12d3-a456-426614174000';

async function waitForAuthSurface(page) {
  const accessGateHeading = page.getByRole('heading', { name: '限定公開キー' });
  const loginTab = page.getByRole('tab', { name: 'ログイン', exact: true });

  await expect
    .poll(async () => {
      if (await accessGateHeading.isVisible()) return 'access-gate';
      if (await loginTab.isVisible()) return 'auth';
      return 'pending';
    }, { timeout: 20_000 })
    .not.toBe('pending');
}

async function signIn(page, email = liveEmail, password = livePassword) {
  await page.goto('/');

  const primaryNav = page.locator('.primary-bottom-nav');
  if (await primaryNav.isVisible()) return;

  await waitForAuthSurface(page);
  if (await page.getByRole('heading', { name: '限定公開キー' }).isVisible()) {
    if (!liveAccessKey) {
      throw new Error(
        'The production access gate is enabled, but STUDYPLANNER_LIVE_ACCESS_KEY is not configured.',
      );
    }
    await fillSecret(page.getByLabel('閲覧キー'), liveAccessKey, 'access key');
    await page.getByRole('button', { name: 'キーを確認して進む' }).click();
  }

  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await fillSecret(page.getByLabel('メールアドレス'), email, 'email');
  await fillSecret(page.getByLabel('パスワード', { exact: true }), password, 'password');
  await page.getByRole('button', { name: 'ログインする' }).click();

  const authError = page.locator('.inline-error, .app-notice.error').first();
  await expect
    .poll(async () => {
      if (await primaryNav.isVisible()) return 'ready';
      if (await authError.isVisible()) return 'auth-error';
      return 'pending';
    }, { timeout: 30_000 })
    .toBe('ready');
}

// Runs in the page so the ID token never leaves the browser context or the logs.
async function traceCall(page, path, body, { authenticated = true } = {}) {
  return page.evaluate(async ({ url, contract, payload, withToken }) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-StudyPlanner-Trace-Contract-Version': contract,
    };
    if (withToken) {
      const key = Object.keys(window.localStorage).find((name) => name.startsWith('firebase:authUser:'));
      const stored = key ? JSON.parse(window.localStorage.getItem(key) ?? 'null') : null;
      const token = stored?.stsTokenManager?.accessToken;
      if (!token) throw new Error('Firebase ID token is not available in the signed-in page.');
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, payload === undefined
      ? { method: 'GET', headers }
      : { method: 'POST', headers, body: JSON.stringify(payload) });
    let json = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    return { status: response.status, body: json };
  }, { url: `${traceApiUrl}${path}`, contract: CONTRACT_VERSION, payload: body, withToken: authenticated });
}

function sessionMetadata(entryCount) {
  const now = new Date().toISOString();
  return {
    status: 'active', startedAt: now, lastActivityAt: now, turnCount: entryCount, entryCount,
    hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false,
    appVersion: `live-e2e-${runId}`, schemaVersion: 1,
  };
}

function turnDiagnosticV2(base, now) {
  const text = `連絡は ${SYNTHETIC_EMAIL} / ${SYNTHETIC_PHONE} https://example.test/p?${SYNTHETIC_URL_QUERY} ${SYNTHETIC_CREDENTIAL}`;
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

function report(step, result) {
  console.log(`[trace-live] ${JSON.stringify({ step, ...result })}`);
}

test('weekly-planning trace: auth, consent gate, v2 append and restricted read on production', async ({ page }) => {
  await signIn(page);

  const anonymous = await traceCall(page, '/weekly-planning-trace/policy', undefined, { authenticated: false });
  report('unauthenticated_policy', { status: anonymous.status });
  expect(anonymous.status).toBe(401);

  const policy = await traceCall(page, '/weekly-planning-trace/policy');
  report('policy', { status: policy.status, accepted: policy.body.accepted, policyVersion: policy.body.policyVersion });
  expect(policy.status).toBe(200);

  const key = `live-${runId}`;
  const started = await traceCall(page, '/weekly-planning-trace/session/start', {
    idempotencyKey: `weekly-trace-${key}`,
    conversationCorrelationKey: `conversation-${key}`,
    session: sessionMetadata(0),
  });
  report('session_start', { status: started.status, errorCode: started.body.errorCode ?? null, sessionId: started.body.sessionId ?? null });

  if (policy.body.accepted !== true) {
    // Without consent the server must refuse to store anything.
    expect(started.status).toBe(412);
    expect(started.body.errorCode).toBe('trace_policy_required');
    return;
  }

  expect(started.status).toBe(200);
  const sessionId = String(started.body.sessionId);
  const logicalConversationId = String(started.body.logicalConversationId);
  const now = new Date().toISOString();
  const appended = await traceCall(page, '/weekly-planning-trace/append', {
    session: { ...sessionMetadata(1), id: sessionId, logicalConversationId },
    entries: [turnDiagnosticV2({
      id: `${sessionId}-00000000`, sessionId, logicalConversationId, sequence: 0,
      requestId: `request-${key}`,
    }, now)],
  });
  report('append_v2', {
    status: appended.status,
    errorCode: appended.body.errorCode ?? null,
    acceptedEntries: appended.body.acceptedEntries ?? null,
    entryId: `${sessionId}-00000000`,
  });
  expect(appended.status).toBe(200);
  expect(appended.body.acceptedEntries).toBe(1);

  // Restricted read of the synthetic session only.
  const read = await traceCall(page, '/weekly-planning-trace/admin/entries', { sessionId });
  report('restricted_read', { status: read.status, errorCode: read.body.errorCode ?? null });
  if (read.status === 403) {
    expect(read.body.errorCode).toBe('trace_reader_forbidden');
    return;
  }
  expect(read.status).toBe(200);
  const output = JSON.stringify(read.body.entries);
  for (const secret of [SYNTHETIC_EMAIL, SYNTHETIC_PHONE, SYNTHETIC_URL_QUERY, SYNTHETIC_CREDENTIAL]) {
    expect(output).not.toContain(secret);
  }
});

test('weekly-planning trace: consent, append, non-reader 403 and idempotent delete on a dedicated trace account', async ({ page }) => {
  test.skip(!traceAccountEmail || !traceAccountPassword,
    'STUDYPLANNER_TRACE_E2E_EMAIL / STUDYPLANNER_TRACE_E2E_PASSWORD are not configured.');
  await signIn(page, traceAccountEmail, traceAccountPassword);

  const accepted = await traceCall(page, '/weekly-planning-trace/policy/accept', {});
  report('dedicated_policy_accept', { status: accepted.status });
  expect(accepted.status).toBe(200);

  const key = `live-dedicated-${runId}`;
  const started = await traceCall(page, '/weekly-planning-trace/session/start', {
    idempotencyKey: `weekly-trace-${key}`,
    conversationCorrelationKey: `conversation-${key}`,
    session: sessionMetadata(0),
  });
  report('dedicated_session_start', { status: started.status, sessionId: started.body.sessionId ?? null });
  expect(started.status).toBe(200);
  const sessionId = String(started.body.sessionId);
  const logicalConversationId = String(started.body.logicalConversationId);
  const appended = await traceCall(page, '/weekly-planning-trace/append', {
    session: { ...sessionMetadata(1), id: sessionId, logicalConversationId },
    entries: [turnDiagnosticV2({
      id: `${sessionId}-00000000`, sessionId, logicalConversationId, sequence: 0,
      requestId: `request-${key}`,
    }, new Date().toISOString())],
  });
  report('dedicated_append_v2', { status: appended.status, acceptedEntries: appended.body.acceptedEntries ?? null });
  expect(appended.status).toBe(200);

  // The dedicated account is not a trace reader.
  const read = await traceCall(page, '/weekly-planning-trace/admin/entries', { sessionId });
  report('dedicated_restricted_read', { status: read.status, errorCode: read.body.errorCode ?? null });
  expect(read.status).toBe(403);
  expect(read.body.errorCode).toBe('trace_reader_forbidden');

  const deleted = await traceCall(page, '/weekly-planning-trace/delete', {});
  report('dedicated_delete', { status: deleted.status, deletedEntries: deleted.body.deletedEntries, deletedSessions: deleted.body.deletedSessions });
  expect(deleted.status).toBe(200);
  expect(deleted.body.deletedEntries).toBeGreaterThanOrEqual(1);
  expect(deleted.body.deletedSessions).toBeGreaterThanOrEqual(1);

  const again = await traceCall(page, '/weekly-planning-trace/delete', {});
  report('dedicated_delete_again', { status: again.status, deletedEntries: again.body.deletedEntries, deletedSessions: again.body.deletedSessions });
  expect(again.status).toBe(200);
  expect(again.body.deletedEntries).toBe(0);
  expect(again.body.deletedSessions).toBe(0);
});
