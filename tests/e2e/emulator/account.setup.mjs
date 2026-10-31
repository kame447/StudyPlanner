import { rm, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// The live specs expect returning accounts: verified, trace consent given (through the local Worker into
// Firestore), a week start chosen and the first-run tour done. Register through the real sign-up screen, apply the
// verification code the emulator issues instead of a mail (it delivers none), sign in, and answer what
// the app asks, so production code writes every document itself. The tour's completion lives only in
// this browser's storage, so the live specs start with that flag and, as against production, signed out.
// As in production, the live account is a trace reader and the dedicated trace account is not (#947).
// A project that names its own account (the VNext experiment, #926) registers only that one.
const projectAccount = () => test.info().project.metadata.email;
const accounts = () => (projectAccount()
  ? [{ email: projectAccount(), password: process.env.STUDYPLANNER_LIVE_PASSWORD, traceReader: false }]
  : [
    { email: process.env.STUDYPLANNER_LIVE_EMAIL, password: process.env.STUDYPLANNER_LIVE_PASSWORD, traceReader: true },
    { email: process.env.STUDYPLANNER_TRACE_E2E_EMAIL, password: process.env.STUDYPLANNER_TRACE_E2E_PASSWORD, traceReader: false },
  ]);
const statePath = () => test.info().project.metadata.statePath ?? process.env.STUDYPLANNER_E2E_EMULATOR_STATE;
const authEmulator = `http://${process.env.STUDYPLANNER_E2E_AUTH_EMULATOR_HOST}`;
const firestoreEmulator = `http://${process.env.STUDYPLANNER_E2E_FIRESTORE_EMULATOR_HOST}`;

async function prepareAccount(page, request, { email, password }) {
  await page.goto('/');
  await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByLabel('パスワード確認').fill(password);
  await page.getByRole('button', { name: '登録して確認メールを送る' }).click();

  let verification;
  await expect.poll(async () => {
    const response = await request.get(`${authEmulator}/emulator/v1/projects/demo-studyplanner/oobCodes`);
    const { oobCodes } = await response.json();
    verification = oobCodes.find((code) => code.email === email && code.requestType === 'VERIFY_EMAIL');
    return Boolean(verification);
  }).toBe(true);
  const applied = await request.post(`${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`,
    { data: { oobCode: verification.oobCode } });
  expect(applied.ok()).toBe(true);

  await page.goto('/');
  const primaryNav = page.locator('.primary-bottom-nav');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(primaryNav.or(signInTab)).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
    await page.getByLabel('メールアドレス').fill(email);
    await page.getByLabel('パスワード', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'ログインする' }).click();
  }

  // A new account gives the weekly-planning trace consent once; the Worker records it in Firestore.
  await expect(page.getByRole('heading', { name: '初回利用の確認' })).toBeVisible();
  await page.getByRole('checkbox', { name: '上記のデータ保存と利用目的を確認し、同意します。' }).check();
  await page.getByRole('button', { name: '同意して利用を開始する' }).click();

  // The app asks for a week start only when it has none for this account; answer it if asked.
  const weekStart = page.getByRole('heading', { name: '1週間の始まりを選択' });
  const tour = page.getByRole('dialog', { name: 'Laplanceの使い方' });
  await expect(primaryNav.or(weekStart).or(tour).first()).toBeVisible();
  if (await weekStart.isVisible()) {
    await page.getByRole('combobox', { name: '週の始まり' }).selectOption('monday');
    await page.getByRole('button', { name: 'この設定で始める' }).click();
  }
  // A new account without saved content is always shown the first-run tour once.
  await tour.getByRole('button', { name: 'スキップ' }).click();
  await expect(tour).toBeHidden();
  await expect(primaryNav).toBeVisible();
  return page.context().storageState();
}

// Admin documents are written only by the Admin SDK (firestore.rules); the emulator accepts its owner token.
async function grantTraceReader(request, { email, password }) {
  const signedIn = await request.post(`${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    { data: { email, password, returnSecureToken: true } });
  expect(signedIn.ok()).toBe(true);
  const { localId } = await signedIn.json();
  const written = await request.patch(
    `${firestoreEmulator}/v1/projects/demo-studyplanner/databases/(default)/documents/admins/${localId}`,
    { headers: { Authorization: 'Bearer owner' },
      data: { fields: { enabled: { booleanValue: true }, weeklyPlanningTraceReader: { booleanValue: true } } } });
  expect(written.ok()).toBe(true);
}

test('register and prepare the emulator accounts through the real screens', async ({ browser, request }, testInfo) => {
  // The trace session file belongs to the default accounts' trace setup, not to a project's own account.
  if (!projectAccount()) await rm(process.env.STUDYPLANNER_E2E_TRACE_SESSION_FILE, { force: true });
  const { baseURL, timezoneId, viewport } = testInfo.project.use;
  const tourFlags = new Map();
  for (const account of accounts()) {
    // One fresh context per account, so neither sign-in sees the other's session.
    const context = await browser.newContext({ baseURL, timezoneId, viewport });
    try {
      const state = await prepareAccount(await context.newPage(), request, account);
      for (const origin of state.origins) {
        const flags = tourFlags.get(origin.origin) ?? [];
        flags.push(...origin.localStorage.filter(({ name }) => name.startsWith('laplance-first-run-tour-v1:')));
        tourFlags.set(origin.origin, flags);
      }
    } finally {
      await context.close();
    }
    if (account.traceReader) await grantTraceReader(request, account);
  }
  await writeFile(statePath(), JSON.stringify({
    cookies: [],
    origins: [...tourFlags].map(([origin, localStorage]) => ({ origin, localStorage })),
  }));
});
