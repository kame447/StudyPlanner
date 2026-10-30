import { expect, test } from '@playwright/test';

// Production check of the admin Logs page, its Debug Bundle and archive for one
// synthetic trace session (Issue #45). It runs only when that session ID is given.
// Every admin request to the Worker is checked before it is sent: only requests
// for that session ID go out, anything else is aborted, so other sessions are
// never listed or read. Archive uses the same endpoint as the 週間計画ログ page
// button, because that page always lists every session when it opens.

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
const sessionId = process.env.STUDYPLANNER_TRACE_ADMIN_SESSION_ID?.trim() ?? '';

const CONTRACT_VERSION = '2026-07-29-v4';
// Raw synthetic values written by weekly-planning-trace-privacy.live.mjs.
const SYNTHETIC_MARKERS = ['trace-live-', '090-0000-0000', 'token=url-', 'sk-proj-'];
const SESSION_SCOPED_PATHS = new Set([
  '/observability/admin/logs',
  '/observability/admin/log-entries',
  '/observability/admin/debug-bundle',
]);
const ARCHIVE_PATH = '/weekly-planning-trace/admin/archive';

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

// Playwright puts the filled value in its action log, so a failed fill would
// print the credential. Replace the error with a fixed message.
async function fillSecret(locator, value, label) {
  try {
    await locator.fill(value);
  } catch {
    throw new Error(`Could not enter the ${label}.`);
  }
}

async function signIn(page) {
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
  await fillSecret(page.getByLabel('メールアドレス'), liveEmail, 'email');
  await fillSecret(page.getByLabel('パスワード', { exact: true }), livePassword, 'password');
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

function isAdminRequest(url) {
  return url.origin === new URL(traceApiUrl).origin
    && (url.pathname.startsWith('/observability/admin/')
      || url.pathname.startsWith('/weekly-planning-trace/admin/'));
}

function isWhitelisted(request) {
  if (request.method() === 'OPTIONS') return true;
  const url = new URL(request.url());
  if (SESSION_SCOPED_PATHS.has(url.pathname)) return url.searchParams.get('session') === sessionId;
  if (url.pathname === ARCHIVE_PATH) {
    try {
      return request.postDataJSON()?.sessionId === sessionId;
    } catch {
      return false;
    }
  }
  return false;
}

function report(step, result) {
  console.log(`[trace-admin-live] ${JSON.stringify({ step, ...result })}`);
}

test('weekly-planning trace: admin Logs, Debug Bundle and archive for one whitelisted session', async ({ page }) => {
  test.skip(!sessionId, 'STUDYPLANNER_TRACE_ADMIN_SESSION_ID is not configured.');

  const blocked = [];
  await page.route((url) => isAdminRequest(url), async (route) => {
    if (isWhitelisted(route.request())) {
      await route.continue();
      return;
    }
    blocked.push(new URL(route.request().url()).pathname);
    await route.abort('blockedbyclient');
  });

  await signIn(page);

  const logsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/observability/admin/logs');
  await page.goto(`/admin/logs?session=${encodeURIComponent(sessionId)}`);
  const logs = await logsResponse;
  report('logs', { status: logs.status() });
  expect(logs.status()).toBe(200);

  const sessionRows = page.locator('section[aria-label="診断session一覧"] article');
  await expect(sessionRows).toHaveCount(1);
  await expect(sessionRows.first().locator('code')).toHaveText(sessionId);

  const entriesResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/observability/admin/log-entries');
  await sessionRows.first().locator('.admin-log-session-toggle').click();
  const entries = await entriesResponse;
  report('log_entries', { status: entries.status() });
  expect(entries.status()).toBe(200);
  await expect(sessionRows.first().locator('section[aria-label="本文の取得状態"]')).toBeVisible();
  const shownText = await sessionRows.first().innerText();
  for (const marker of SYNTHETIC_MARKERS) expect(shownText).not.toContain(marker);

  const bundleResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/observability/admin/debug-bundle');
  const downloadEvent = page.waitForEvent('download');
  await sessionRows.first().getByRole('button', { name: 'Session Debug Bundle' }).click();
  const bundle = await bundleResponse;
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const bundleText = Buffer.concat(chunks).toString('utf8');
  await download.delete();
  report('debug_bundle', { status: bundle.status(), bytes: bundleText.length });
  expect(bundle.status()).toBe(200);
  expect(bundleText).toContain(sessionId);
  for (const marker of SYNTHETIC_MARKERS) expect(bundleText).not.toContain(marker);

  // Runs in the page so the ID token never leaves the browser context or the logs.
  const archived = await page.evaluate(async ({ url, contract, targetSessionId }) => {
    const key = Object.keys(window.localStorage).find((name) => name.startsWith('firebase:authUser:'));
    const stored = key ? JSON.parse(window.localStorage.getItem(key) ?? 'null') : null;
    const token = stored?.stsTokenManager?.accessToken;
    if (!token) throw new Error('Firebase ID token is not available in the signed-in page.');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-StudyPlanner-Trace-Contract-Version': contract,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId: targetSessionId }),
    });
    let json = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    return { status: response.status, body: json };
  }, { url: `${traceApiUrl}${ARCHIVE_PATH}`, contract: CONTRACT_VERSION, targetSessionId: sessionId });
  report('archive', {
    status: archived.status,
    errorCode: archived.body.errorCode ?? null,
    archivedAt: archived.body.archivedAt ?? null,
  });
  expect(archived.status).toBe(200);
  expect(archived.body.sessionId).toBe(sessionId);

  report('blocked_requests', { paths: blocked });
  expect(blocked).toEqual([]);
});
