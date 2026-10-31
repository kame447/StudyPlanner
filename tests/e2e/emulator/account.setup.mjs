import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// The live spec expects a returning account: verified, trace consent given (through the local Worker into
// Firestore), a week start chosen and the first-run tour done. Register through the real sign-up screen, apply the
// verification code the emulator issues instead of a mail (it delivers none), sign in, and answer what
// the app asks, so production code writes every document itself. The tour's completion lives only in
// this browser's storage, so the live spec starts with that flag and, as against production, signed out.
const email = process.env.STUDYPLANNER_LIVE_EMAIL;
const password = process.env.STUDYPLANNER_LIVE_PASSWORD;
const authEmulator = `http://${process.env.STUDYPLANNER_E2E_AUTH_EMULATOR_HOST}`;

test('register and prepare the emulator account through the real screens', async ({ page, request }) => {
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
  const state = await page.context().storageState();
  await writeFile(process.env.STUDYPLANNER_E2E_EMULATOR_STATE, JSON.stringify({
    cookies: [],
    origins: state.origins.map((origin) => ({ origin: origin.origin,
      localStorage: origin.localStorage.filter(({ name }) => name.startsWith('laplance-first-run-tour-v1:')) })),
  }));
});
