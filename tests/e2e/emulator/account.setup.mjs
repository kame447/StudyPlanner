import { expect, test } from '@playwright/test';

// The live specs expect a verified account that has already chosen a week start (trace consent is off
// without the Worker). Register it through the real sign-up screen, open the verification code the
// emulator issues instead of a mail (it delivers none), then sign in and choose the week start, so
// production code writes every document itself.
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

  // The app asks for a week start only when it has none for this account; answer it if asked.
  const weekStart = page.getByRole('heading', { name: '1週間の始まりを選択' });
  await expect(primaryNav.or(weekStart)).toBeVisible();
  if (await weekStart.isVisible()) {
    await page.getByRole('combobox', { name: '週の始まり' }).selectOption('monday');
    await page.getByRole('button', { name: 'この設定で始める' }).click();
  }
  await expect(primaryNav).toBeVisible();
});
