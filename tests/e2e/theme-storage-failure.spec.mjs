import { expect, test as fixedClockTest } from './support/fixed-clock.mjs';

const test = fixedClockTest.extend({
  themePage: [async ({ context }, use) => { await use(await context.newPage()); }, { timeout: 30_000 }],
});
const MODE_KEY = 'study-planner-theme-mode';
const PALETTE_KEY = 'study-planner-theme-palette';
const READ_ERROR = '表示設定を読み込めませんでした。初期設定で表示しています。';
const SAVE_ERROR = '表示設定を保存できませんでした。再読み込みで元に戻る場合があります。';

async function boot(page, operation, key) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  // Use the real production app and its existing local-fixture startup path.
  // Only the two browser presentation keys can fail; no auth/planner I/O is stubbed.
  await page.addInitScript(({ operation, key, modeKey, paletteKey }) => {
    if (!localStorage.getItem('theme-storage-failure-seeded')) {
      const now = new Date().toISOString();
      const user = { id: 'theme-storage-user', email: 'theme-storage@example.test', username: '配色テスト', avatar: '', createdAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      for (const name of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
        localStorage.setItem(name, '[]');
      }
      localStorage.setItem(modeKey, 'dark');
      localStorage.setItem(paletteKey, 'ocean');
      localStorage.setItem('theme-storage-failure-seeded', 'true');
    }
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    let enabled = sessionStorage.getItem('theme-storage-failure-enabled') !== 'false';
    window.__themeStorageFailure = {
      readSaved: storageKey => originalGet.call(localStorage, storageKey),
      recover: () => { enabled = false; sessionStorage.setItem('theme-storage-failure-enabled', 'false'); },
    };
    Storage.prototype.getItem = function (storageKey) {
      if (this === localStorage && enabled && operation === 'getItem' && storageKey === key) {
        throw new DOMException('Synthetic theme read denial', 'SecurityError');
      }
      return originalGet.call(this, storageKey);
    };
    Storage.prototype.setItem = function (storageKey, value) {
      if (this === localStorage && enabled && operation === 'setItem' && storageKey === key) {
        throw new DOMException('Synthetic theme quota failure', 'QuotaExceededError');
      }
      return originalSet.call(this, storageKey, value);
    };
  }, { operation, key, modeKey: MODE_KEY, paletteKey: PALETTE_KEY });
  await page.goto('/');
  await expect(page.locator('.home-main > .home-dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
  return pageErrors;
}
const saved = (page, key) => page.evaluate(key => window.__themeStorageFailure.readSaved(key), key);
const alert = page => page.locator('.app-settings-page').getByRole('alert');
async function choosePalette(page, label) {
  const disclosure = page.locator('[aria-controls="settings-palette-options"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await page.getByRole('group', { name: '配色', exact: true }).getByRole('button', { name: label, exact: true }).click();
}
async function captureWarning(page, testInfo, name) {
  await expect(alert(page)).toBeVisible();
  expect(await page.locator('.app-settings-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

for (const key of [MODE_KEY, PALETTE_KEY]) {
  test(`unread ${key} stays saved until an explicit choice`, async ({ themePage: page }, testInfo) => {
    const errors = await boot(page, 'getItem', key);
    await expect(alert(page)).toHaveText(READ_ERROR);
    await expect(page.locator('html')).toHaveAttribute('data-theme', key === MODE_KEY ? 'light' : 'dark');
    expect(await saved(page, key)).toBe(key === MODE_KEY ? 'dark' : 'ocean');
    if (key === MODE_KEY) await choosePalette(page, 'サクラ');
    else await page.getByRole('button', { name: 'ライト', exact: true }).click();
    expect(await saved(page, key)).toBe(key === MODE_KEY ? 'dark' : 'ocean');
    await expect(alert(page)).toHaveText(READ_ERROR);
    await captureWarning(page, testInfo, `theme-read-warning-${key}`);
    // Selecting the displayed fallback, even unchanged, is an explicit save.
    if (key === MODE_KEY) await page.getByRole('button', { name: 'ライト', exact: true }).click();
    else await choosePalette(page, 'フォレスト');
    await expect(alert(page)).toHaveCount(0);
    expect(await saved(page, key)).toBe(key === MODE_KEY ? 'light' : 'forest');
    expect(errors).toEqual([]);
  });

  test(`failed ${key} writes stay usable and retry the same selection`, async ({ themePage: page }, testInfo) => {
    const errors = await boot(page, 'setItem', key);
    // The initial persistence effect must also be contained.
    await expect(alert(page)).toHaveText(SAVE_ERROR);
    if (key === MODE_KEY) await page.getByRole('button', { name: 'ライト', exact: true }).click();
    else await choosePalette(page, 'サクラ');
    expect(await saved(page, key)).toBe(key === MODE_KEY ? 'dark' : 'ocean');
    if (key === MODE_KEY) await choosePalette(page, 'サクラ');
    else await page.getByRole('button', { name: 'ライト', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // A successful unrelated key must not hide the outstanding failure.
    await expect(alert(page)).toHaveText(SAVE_ERROR);
    await page.locator('[aria-controls="settings-palette-options"]').click();
    await expect(page.locator('#settings-palette-options')).toHaveCount(0);
    await captureWarning(page, testInfo, `theme-write-warning-${key}`);
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('.home-main > .home-dashboard')).toBeVisible();
    await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
    await expect(alert(page)).toHaveText(SAVE_ERROR);
    await page.evaluate(() => window.__themeStorageFailure.recover());
    if (key === MODE_KEY) await page.getByRole('button', { name: 'ライト', exact: true }).click();
    else await choosePalette(page, 'サクラ');
    await expect(alert(page)).toHaveCount(0);
    expect(await saved(page, MODE_KEY)).toBe('light');
    expect(await saved(page, PALETTE_KEY)).toBe('sakura');
    await page.reload();
    // Reload preserves the active settings history entry.
    await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
    await expect(alert(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ライト', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[aria-controls="settings-palette-options"]')).toContainText('サクラ');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await saved(page, PALETTE_KEY)).toBe('sakura');
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--accent').trim())).toBe('#c75a86');
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('.home-main > .home-dashboard')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
