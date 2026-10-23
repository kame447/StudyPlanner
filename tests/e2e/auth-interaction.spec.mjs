import { expect, test } from '@playwright/test';

const AUTH_HARNESS_URL = 'http://127.0.0.1:4174/?scenario=auth';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function openAuth(page) {
  await page.goto(AUTH_HARNESS_URL);
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
}

test.describe('AuthScreen browser interactions', () => {
  test('password-confirmation mismatch is rejected before the sign-up boundary', async ({ page }) => {
    await openAuth(page);
    await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();

    await page.getByLabel('メールアドレス').fill('browser-regression@example.com');
    await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
    await page.getByLabel('パスワード確認').fill('different12');
    await page.getByLabel('パスワード確認').press('Enter');

    await expect(page.getByText(/パスワード.*一致していません/)).toBeVisible();
    expect(await events(page, 'auth-sign-up')).toHaveLength(0);
  });

  test('matching sign-up fields reach the external registration boundary once', async ({ page }) => {
    await openAuth(page);
    await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();

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

  test('keyboard-only mode switching supports Arrow, Home, End and a single tab stop', async ({ page }) => {
    await openAuth(page);
    const login = page.getByRole('tab', { name: 'ログイン', exact: true });
    const signUp = page.getByRole('tab', { name: '新規会員登録', exact: true });
    await login.focus();
    await page.keyboard.press('ArrowRight');
    await expect(signUp).toBeFocused();
    await expect(signUp).toHaveAttribute('aria-selected', 'true');
    await expect(login).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Home');
    await expect(login).toBeFocused();
    await page.keyboard.press('End');
    await expect(signUp).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(login).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('メールアドレス')).toBeFocused();
  });
});

for (const width of [390, 1280]) {
  test(`pending authentication blocks repeated submit and competing actions at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${AUTH_HARNESS_URL}&authDeferred=1`);
    await page.getByLabel('メールアドレス').fill('pending@example.test');
    await page.getByLabel('パスワード', { exact: true }).fill('synthetic-password');
    await page.getByLabel('パスワード', { exact: true }).press('Enter');
    await expect(page.getByRole('form')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: '処理中…' })).toBeDisabled();
    for (const label of ['Googleでログイン', 'パスワードを再設定']) {
      await expect(page.getByRole('button', { name: label })).toBeDisabled();
    }
    await expect(page.getByRole('tab', { name: '新規会員登録', exact: true })).toBeDisabled();
    // Native form submit can also arrive independently of a disabled button.
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    expect(await events(page, 'auth-sign-in')).toHaveLength(1);
    expect(await events(page, 'auth-google-sign-in')).toHaveLength(0);
    expect(await events(page, 'auth-password-reset')).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach(`auth-pending-${width}`, { body: await page.screenshot({ fullPage: true, scale: 'css' }), contentType: 'image/png' });
    await page.evaluate(() => window.__settleAuthAction(true));
    await expect(page.getByRole('alert')).toContainText('もう一度');
    await expect(page.getByRole('form')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByLabel('メールアドレス')).toHaveValue('pending@example.test');
    await page.getByRole('button', { name: 'ログインする' }).click();
    expect(await events(page, 'auth-sign-in')).toHaveLength(2);
    await page.evaluate(() => window.__settleAuthAction());
    await expect(page.getByRole('form')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();
    await expect(page.getByLabel('パスワード確認')).toBeVisible();
  });
}
