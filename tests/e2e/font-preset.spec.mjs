import fs from 'node:fs';
import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

// Google Fonts is replaced by a deterministic local face: the contract under
// test is when the app asks for a preset and how it falls back, not the CDN.
const face = fs.readFileSync(new URL('../../public/fonts/DotGothic16-Regular.woff2', import.meta.url));
const FONT_KEY = 'study-planner-font-preset';
const SYSTEM_ROOT = '"Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';

async function seed(page, stored = {}) {
  await page.addInitScript(({ today, stored }) => {
    if (localStorage.getItem('font-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'font-user', email: 'font@example.test', username: 'フォント検証', avatar: '', createdAt: now };
    const plan = { id: 'font-plan', seriesId: 'font-plan', userId: user.id, title: 'フォント変更後も残る予定',
      subject: '数学', type: 'study', sourceType: 'manual', date: today, startTime: '14:00', endTime: '15:00',
      memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
    localStorage.setItem('font-seeded', 'true');
  }, { today: E2E_TODAY, stored });
}

async function routeGoogleFonts(page, { fail = false } = {}) {
  const requests = [];
  await page.route('https://fonts.googleapis.com/**', route => {
    requests.push(route.request().url());
    if (fail) return route.abort('internetdisconnected');
    const family = new URL(route.request().url()).searchParams.get('family').split(':')[0];
    return route.fulfill({ contentType: 'text/css', headers: { 'access-control-allow-origin': '*' },
      body: `@font-face { font-family: '${family}'; src: url(https://fonts.gstatic.com/test/${encodeURIComponent(family)}.woff2) format('woff2'); font-display: swap; }` });
  });
  await page.route('https://fonts.gstatic.com/**', route => fail ? route.abort('internetdisconnected')
    : route.fulfill({ contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: face }));
  return requests;
}

const families = requests => requests.map(url => new URL(url).searchParams.get('family').split(':')[0]);
const fontOf = (page, selector) => page.locator(selector).first().evaluate(element => getComputedStyle(element).fontFamily);
const accent = page => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'));

async function openSettings(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
}
const fontDisclosure = page => page.locator('[aria-controls="settings-font-options"]');
const fontOption = (page, label) => page.getByRole('group', { name: 'フォント' }).getByRole('button').filter({ hasText: label });

test('system default requests no web font, and opening the picker loads only comparison faces', async ({ page }) => {
  const requests = await routeGoogleFonts(page);
  await seed(page); await page.goto('/');
  await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
  await openSettings(page);
  await expect(fontDisclosure(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(fontDisclosure(page)).toContainText('標準');
  expect(requests).toEqual([]);
  expect(await page.locator('html').getAttribute('data-font-preset')).toBeNull();
  expect(await fontOf(page, 'body')).toBe(SYSTEM_ROOT);
  expect(await fontOf(page, '.settings-segments button')).not.toContain('Noto Sans JP');

  await fontDisclosure(page).click();
  await expect(fontOption(page, 'Noto Sans JP')).toBeVisible();
  await expect.poll(() => families(requests).sort()).toEqual(['BIZ UDPGothic', 'M PLUS Rounded 1c', 'Noto Sans JP']);
  for (const [id, family] of [['noto-sans-jp', 'Noto Sans JP'], ['biz-udpgothic', 'BIZ UDPGothic'], ['m-plus-rounded-1c', 'M PLUS Rounded 1c']]) {
    expect(await fontOf(page, `.font-preset-sample[data-font-sample="${id}"]`)).toMatch(new RegExp(`^"${family}"`));
  }
  // Comparing is not choosing: the app itself and storage stay on the standard font.
  expect(await fontOf(page, 'body')).toBe(SYSTEM_ROOT);
  expect(await page.evaluate(key => localStorage.getItem(key), FONT_KEY)).toBeNull();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`switching presets applies across the app, survives reload and keeps theme choices at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await routeGoogleFonts(page);
    await seed(page, { 'study-planner-theme-mode': 'dark', 'study-planner-theme-palette': 'sakura' });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
    const accentBefore = await accent(page);
    await openSettings(page);
    await fontDisclosure(page).click();
    for (const [label, id, family] of [['Noto Sans JP', 'noto-sans-jp', 'Noto Sans JP'], ['BIZ UDPゴシック', 'biz-udpgothic', 'BIZ UDPGothic'],
      ['M PLUS Rounded 1c', 'm-plus-rounded-1c', 'M PLUS Rounded 1c']]) {
      await fontOption(page, label).click();
      await expect(fontOption(page, label)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-font-preset', id);
      await expect(fontDisclosure(page)).toContainText(label);
      for (const selector of ['body', '.settings-field-label', '.settings-segments button']) {
        expect(await fontOf(page, selector), selector).toMatch(new RegExp(`^"${family}", "Hiragino Sans"`));
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await accent(page)).toBe(accentBefore);
      expect(await page.locator('.app-settings-content').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    }
    await page.evaluate(() => document.fonts.ready);
    await testInfo.attach(`font-settings-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    expect(await page.evaluate(key => localStorage.getItem(key), FONT_KEY)).toBe('m-plus-rounded-1c');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-font-preset', 'm-plus-rounded-1c');
    await expect(fontDisclosure(page)).toContainText('M PLUS Rounded 1c');
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
    await expect(page.locator('.home-today-panel')).toContainText('フォント変更後も残る予定');
    expect(await fontOf(page, '.home-dashboard')).toMatch(/^"M PLUS Rounded 1c"/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.evaluate(() => document.fonts.ready);
    await testInfo.attach(`font-home-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('.primary-bottom-nav button, .primary-nav button').filter({ hasText: '教材' }).first().click();
    await expect(page.locator('.bookshelf-view')).toBeVisible();
    expect(await fontOf(page, '.bookshelf-view')).toMatch(/^"M PLUS Rounded 1c"/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await accent(page)).toBe(accentBefore);

    await openSettings(page);
    await fontDisclosure(page).click();
    await fontOption(page, '標準').click();
    expect(await page.locator('html').getAttribute('data-font-preset')).toBeNull();
    expect(await fontOf(page, 'body')).toBe(SYSTEM_ROOT);
    await page.reload();
    expect(await page.locator('html').getAttribute('data-font-preset')).toBeNull();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
}

test('offline web font keeps the standard typeface, reports it and leaves the app usable', async ({ page }) => {
  await routeGoogleFonts(page, { fail: true });
  await seed(page, { [FONT_KEY]: 'noto-sans-jp' });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
  await expect(page.locator('.home-today-panel')).toContainText('フォント変更後も残る予定');
  await openSettings(page);
  await expect(page.getByRole('alert')).toContainText('フォントを読み込めませんでした');
  expect(await page.evaluate(() => [...document.fonts].some(face => face.family.includes('Noto')))).toBe(false);
  await fontDisclosure(page).click();
  await expect(page.getByRole('status').filter({ hasText: '一部のフォントを読み込めませんでした' })).toBeVisible();
  await fontOption(page, '標準').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('corrupt saved preset falls back to the standard font without being overwritten', async ({ page }) => {
  const requests = await routeGoogleFonts(page);
  await seed(page, { [FONT_KEY]: 'Comic Sans' });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'ホーム', exact: true })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-font-preset')).toBeNull();
  expect(await fontOf(page, 'body')).toBe(SYSTEM_ROOT);
  expect(requests).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), FONT_KEY)).toBe('Comic Sans');
});

test('dot appearance keeps its own face while samples still compare presets', async ({ page }) => {
  await routeGoogleFonts(page);
  await page.route('**/fonts/DotGothic16-Regular.woff2', route => route.fulfill({ contentType: 'font/woff2', body: face }));
  await seed(page, { 'study-planner-appearance': 'pixel', [FONT_KEY]: 'biz-udpgothic' });
  await page.goto('/');
  await openSettings(page);
  await expect.poll(() => fontOf(page, '.settings-field-label')).toContain('DotGothic16');
  await fontDisclosure(page).click();
  await expect(page.getByText('ドットテーマ中はドット書体で表示されます。')).toBeVisible();
  expect(await fontOf(page, '.font-preset-sample[data-font-sample="biz-udpgothic"]')).toMatch(/^"BIZ UDPGothic"/);
  await page.getByRole('group', { name: 'テーマ' }).getByRole('button', { name: '標準', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
  expect(await fontOf(page, '.settings-field-label')).toMatch(/^"BIZ UDPGothic"/);
});
