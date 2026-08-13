import { expect, test } from '@playwright/test';

const AUTH_HARNESS_URL = 'http://127.0.0.1:4174/?scenario=auth';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function openAuth(page) {
  await page.goto(AUTH_HARNESS_URL);
  await expect(page.getByRole('heading', { name: '新規会員登録' })).toBeVisible();
}

async function tabUntilFocused(page, locator, maxSteps = 20) {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await locator.evaluate((element) => document.activeElement === element)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(locator).toBeFocused();
}

test.describe('AuthScreen browser interactions', () => {
  test('password-confirmation mismatch is rejected before the sign-up boundary', async ({ page }) => {
    await openAuth(page);

    await page.getByLabel('メールアドレス').fill('browser-regression@example.com');
    await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
    await page.getByLabel('パスワード確認').fill('different12');
    await page.getByLabel('パスワード確認').press('Enter');

    await expect(page.getByText(/パスワード.*一致していません/)).toBeVisible();
    expect(await events(page, 'auth-sign-up')).toHaveLength(0);
  });

  test('matching sign-up fields reach the external registration boundary once', async ({ page }) => {
    await openAuth(page);

    await page.getByLabel('ユーザーネーム').fill('browser-user');
    await page.getByLabel('メールアドレス').fill('browser-regression@example.com');
    await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
    await page.getByLabel('パスワード確認').fill('abcdef12');
    await page.getByRole('button', { name: '登録して確認メールを送る' }).click();

    await expect.poll(async () => (await events(page, 'auth-sign-up')).length).toBe(1);
    expect((await events(page, 'auth-sign-up'))[0].payload).toEqual({
      email: 'browser-regression@example.com',
      password: 'abcdef12',
      username: 'browser-user',
    });
  });

  test('login intent submits credentials through the sign-in boundary rather than sign-up', async ({ page }) => {
    await openAuth(page);

    await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
    await page.getByLabel('メールアドレス').fill('browser-regression@example.com');
    await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
    await page.getByRole('button', { name: 'ログインする' }).click();

    await expect.poll(async () => (await events(page, 'auth-sign-in')).length).toBe(1);
    expect(await events(page, 'auth-sign-up')).toHaveLength(0);
    expect((await events(page, 'auth-sign-in'))[0].payload).toEqual({
      email: 'browser-regression@example.com',
      password: 'abcdef12',
    });
  });

  test('keyboard-only navigation can reach the other authentication intent without assuming one exact tab step', async ({ page }) => {
    await openAuth(page);

    const signUp = page.getByRole('tab', { name: '新規会員登録', exact: true });
    const login = page.getByRole('tab', { name: 'ログイン', exact: true });
    await signUp.focus();
    await tabUntilFocused(page, login);
  });
});
