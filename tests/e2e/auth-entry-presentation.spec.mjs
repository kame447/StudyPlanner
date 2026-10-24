import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const AUTH_URL = 'http://127.0.0.1:4174/?scenario=auth';
const icon = fs.readFileSync(new URL('../../public/icons/laplans-192.png', import.meta.url));
const pixelStyles = fs.readFileSync(new URL('../../src/styles/appearance-pixel.css', import.meta.url), 'utf8');
const font = fs.readFileSync(new URL('../../public/fonts/DotGothic16-Regular.woff2', import.meta.url));

async function openAuth(page, { theme = 'light', pixel = false } = {}) {
  await page.route('**/icons/laplans-192.png', route => route.fulfill({ contentType: 'image/png', body: icon }));
  await page.route('**/fonts/DotGothic16-Regular.woff2', route => route.fulfill({ contentType: 'font/woff2', body: font }));
  await page.goto(AUTH_URL);
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
  await page.evaluate(({ theme, pixel }) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.appearance = pixel ? 'pixel' : 'standard';
  }, { theme, pixel });
  // Exercise the real optional paint rules even when they load after entry CSS.
  if (pixel) await page.addStyleTag({ content: pixelStyles });
  await expect(page.locator('.brand-mark')).toHaveJSProperty('naturalWidth', 192);
}

for (const width of [320, 390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`login and registration share a readable dark canvas at ${width}px with saved ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await openAuth(page, { theme });
      const login = page.getByRole('tab', { name: 'ログイン', exact: true });
      const signUp = page.getByRole('tab', { name: '新規会員登録', exact: true });
      await expect(login).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 1, name: 'ログイン', exact: true })).toHaveCount(1);
      await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await login.getAttribute('id'));
      expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of ['html', 'body', '.auth-entry-shell']) {
        await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(6, 9, 20)');
      }
      const left = await login.boundingBox(); const right = await signUp.boundingBox();
      expect(left.y).toBe(right.y); expect(right.x).toBeGreaterThan(left.x);
      expect(left.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByLabel('メールアドレス')).toHaveCSS('font-size', '16px');
      await expect(page.getByLabel('パスワード', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
      await expect(page.getByLabel('パスワード確認')).toHaveCount(0);
      await expect(page.locator('.brand-mark')).toHaveCSS('filter', 'none');
      expect(await page.locator('.brand-mark').evaluate(element => {
        const style = getComputedStyle(element);
        return style.maskImage || style.webkitMaskImage;
      })).toContain('radial-gradient');
      await info.attach(`login-${width}-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

      await signUp.click();
      await expect(signUp).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 1, name: '新規会員登録', exact: true })).toHaveCount(1);
      await expect(page.getByLabel('パスワード確認')).toBeVisible();
      await expect(page.getByLabel('パスワード', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
      await expect(page.getByRole('button', { name: '登録して確認メールを送る' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await info.attach(`registration-${width}-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
}

test('late pixel appearance keeps the auth canvas, input contrast, and compact modes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAuth(page, { theme: 'light', pixel: true });
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(6, 9, 20)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(6, 9, 20)');
  await expect(page.getByLabel('メールアドレス')).toHaveCSS('background-color', 'rgb(16, 21, 34)');
  await expect(page.getByLabel('メールアドレス')).toHaveCSS('color', 'rgb(244, 246, 251)');
  await expect(page.getByRole('button', { name: 'ログインする' })).toHaveCSS('background-color', 'rgb(224, 231, 245)');
  await expect(page.getByRole('button', { name: 'ログインする' })).toHaveCSS('color', 'rgb(17, 23, 37)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach('login-pixel', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('stars drift with native CSS animation and can be paused without changing the form', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openAuth(page);
  await page.getByLabel('メールアドレス').fill('kept@example.test');
  const layer = page.locator('.auth-stars__layer--near');
  await expect(layer).toHaveCSS('animation-name', 'auth-star-drift');
  await expect(layer).toHaveCSS('animation-play-state', 'running');
  const initial = await layer.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => layer.evaluate(element => getComputedStyle(element).transform)).not.toBe(initial);
  await page.getByRole('button', { name: '星の動きを止める', exact: true }).click();
  await expect(layer).toHaveCSS('animation-play-state', 'paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(layer).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.auth-motion-toggle')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(layer).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: '星の動きを再開', exact: true }).click();
  await expect(layer).toHaveCSS('animation-play-state', 'running');
  await expect(page.getByLabel('メールアドレス')).toHaveValue('kept@example.test');
});

test('switching modes clears passwords and errors, while reset and Google stay reachable', async ({ page }) => {
  await openAuth(page);
  await page.getByRole('tab', { name: '新規会員登録', exact: true }).click();
  await page.getByLabel('メールアドレス').fill('retained@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('abcdef12');
  await page.getByLabel('パスワード確認').fill('different12');
  await page.getByRole('button', { name: '登録して確認メールを送る' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('メールアドレス')).toHaveValue('retained@example.test');
  await expect(page.getByLabel('パスワード', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'パスワードを再設定' }).click();
  await page.getByRole('button', { name: 'Googleでログイン' }).click();
  expect(await page.evaluate(() => window.__quickEntryEvents.filter(event => event.type.startsWith('auth-')))).toEqual([
    { type: 'auth-password-reset', payload: { email: 'retained@example.test' } },
    { type: 'auth-google-sign-in', payload: null },
  ]);
});
