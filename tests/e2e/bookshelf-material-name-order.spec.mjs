import fs from 'node:fs';
import { expect, test } from './support/startup-ready.mjs';

const HARNESS_URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
const escapedHarnessOrigin = new URL(HARNESS_URL).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const externalRequest = new RegExp(`^(?!${escapedHarnessOrigin}(?:/|$))https?://`);
// Playwright forwards this media setting through contextOptions, not use.reducedMotion.
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const candidate = { catalogEntryId: 'synthetic-name-catalog', title: '検索候補の教材名', authors: [], aliases: ['合成教材'], isbn13: '9780000000000', pageCount: 248, tableOfContents: ['第1章 基本', '第2章 応用'] };
const sheet = page => page.locator('.bookshelf-modal');
const nameInput = page => sheet(page).getByLabel('教材名', { exact: true });

async function boot(page, width) {
  // Only synthetic fixtures and loopback-served production UI are permitted.
  // Let local app assets load directly; intercept only requests leaving this harness origin.
  const externalRequests = [];
  await page.route(externalRequest, route => {
    externalRequests.push(route.request().url());
    return route.abort();
  });
  // Replace only the external metadata service. Search, dialog, App, planner
  // hook and local repository are the production implementations.
  await page.route(/\/src\/services\/materialMetadataService\.ts(?:\?.*)?$/, route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const candidate = ${JSON.stringify(candidate)};
      const pending = [];
      window.__materialNameDetails = {
        count: () => pending.length,
        settle(title = candidate.title) { const item = pending.shift(); if (!item) throw new Error('No pending selection'); item.resolve({ ...candidate, title }); },
      };
      export async function searchMaterialMetadata() { return { results: [candidate] }; }
      export function resolveMaterialMetadataCandidate() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
    `,
  }));
  await page.goto(HARNESS_URL);
  await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toBeVisible();
  // Initial context dimensions avoid mobile WebKit's runtime-resize limitation.
  const viewport = await page.evaluate(width => ({
    clientWidth: document.documentElement.clientWidth,
    visualViewportWidth: window.visualViewport?.width,
    mediaWidthMatches: matchMedia(`(width: ${width}px)`).matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }), width);
  expect(viewport.clientWidth).toBe(width);
  expect(viewport.visualViewportWidth).toBeCloseTo(width, 0);
  expect(viewport.mediaWidthMatches).toBe(true);
  expect(viewport.reducedMotion).toBe(true);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '教材', exact: true }).click();
  await page.locator('.bookshelf-add-material-fab').click();
  await expect(sheet(page)).toBeVisible();
  return externalRequests;
}
async function selectCatalog(page, keyboard = false) {
  await sheet(page).getByLabel('ISBN / 教材名').fill('合成教材');
  await sheet(page).getByRole('button', { name: '検索', exact: true }).click();
  const result = sheet(page).locator('.material-metadata-result');
  if (keyboard) { await result.focus(); await page.keyboard.press('Enter'); }
  else await result.click();
  await expect(sheet(page).getByRole('button', { name: '教材の選択を取り消す' })).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled();
}
async function settle(page, title = candidate.title) {
  await page.evaluate(title => window.__materialNameDetails.settle(title), title);
  await expect(sheet(page).getByRole('button', { name: '教材の選択を取り消す' })).toHaveCount(0);
}

for (const width of [390, 1280]) {
  test.describe(`initial viewport ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, screen: { width, height: 844 } });
    test(`later manual material name survives delayed details and a real save/reload at ${width}px`, async ({ page }, testInfo) => {
      const externalRequests = await boot(page, width);
      await nameInput(page).fill('選択前の名前');
      await selectCatalog(page);
      await nameInput(page).fill('後から入力した教材名');
      await settle(page);
      await expect(nameInput(page)).toHaveValue('後から入力した教材名');
      await expect(nameInput(page)).toBeFocused();
      await expect(sheet(page).getByRole('region', { name: '選択した教材の情報' })).toContainText(candidate.title);
      await nameInput(page).scrollIntoViewIfNeeded();
      await testInfo.attach(`material-name-preserved-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
      await expect(sheet(page)).toHaveCount(0);
      const saved = await page.evaluate(() => window.__plannerRecoveryRepository.readDurable());
      const material = saved.materials.find(item => item.catalogEntryId === 'synthetic-name-catalog');
      expect(material).toMatchObject({ name: '後から入力した教材名', catalogTitle: candidate.title, catalogEntryId: candidate.catalogEntryId });
      await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
      await page.reload();
      await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '教材', exact: true }).click();
      await expect(page.locator('.bookshelf-view')).toContainText('後から入力した教材名');
      const reloaded = await page.evaluate(() => window.__plannerRecoveryRepository.readDurable());
      expect(reloaded.materials.find(item => item.id === material.id)).toMatchObject({ name: material.name, catalogTitle: candidate.title, catalogEntryId: candidate.catalogEntryId });
      expect(externalRequests).toEqual([]);
    });

    test(`clearing, reselection and close/reopen preserve the latest name at ${width}px`, async ({ page }, testInfo) => {
      const externalRequests = await boot(page, width);
      await nameInput(page).fill('選択前の名前');
      await selectCatalog(page);
      await nameInput(page).fill('');
      await settle(page);
      await expect(nameInput(page)).toHaveValue('');
      await expect(sheet(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled();
      await nameInput(page).scrollIntoViewIfNeeded();
      await testInfo.attach(`material-name-cleared-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await selectCatalog(page);
      await settle(page, '改めて選んだ教材名');
      await expect(nameInput(page)).toHaveValue('改めて選んだ教材名');
      await selectCatalog(page);
      await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
      await page.locator('.bookshelf-add-material-fab').click();
      await nameInput(page).fill('再表示後の下書き');
      await settle(page, '閉じた画面の古い教材名');
      await expect(nameInput(page)).toHaveValue('再表示後の下書き');
      await expect(sheet(page).getByRole('region', { name: '選択した教材の情報' })).toHaveCount(0);
      await expect(sheet(page).getByRole('button', { name: '保存', exact: true })).toBeEnabled();
      expect(externalRequests).toEqual([]);
    });
  });
}

async function expectVisibleInBody(locator, body) {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  const frame = await body.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(frame.x - 1);
  expect(rect.x + rect.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  expect(rect.y).toBeGreaterThanOrEqual(frame.y - 1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
  { width: 320, height: 480 },
  { width: 1280, height: 844 },
]) {
  test.describe(`compact material creation ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, screen: viewport });
    test('keeps the basic form readable and save/cancel in a stationary footer', async ({ page }, testInfo) => {
      const externalRequests = await boot(page, viewport.width);
      const dialog = page.getByRole('dialog', { name: '教材を追加', exact: true });
      const body = dialog.locator('.material-create-body');
      const footer = dialog.locator('.material-create-footer');
      const save = footer.getByRole('button', { name: '保存', exact: true });
      await expect(save).toBeDisabled();
      await expect(dialog.getByLabel('教材名', { exact: true })).toHaveAttribute('aria-required', 'true');
      const metrics = await dialog.evaluate(element => {
        const body = element.querySelector('.material-create-body');
        const heading = element.querySelector('h2').getBoundingClientRect();
        const close = element.querySelector('.section-header button').getBoundingClientRect();
        const cover = element.querySelector('.bookshelf-cover-preview').getBoundingClientRect();
        const controls = [...element.querySelectorAll('button, .field input, .field select')];
        return {
          background: getComputedStyle(element).backgroundColor,
          bodyOverflow: body.scrollHeight - body.clientHeight,
          scrollWidth: element.scrollWidth, width: element.clientWidth,
          headingRight: heading.right, closeLeft: close.left,
          coverWidth: cover.width, coverHeight: cover.height,
          controls: controls.filter(node => node.getClientRects().length).map(node => ({
            height: node.getBoundingClientRect().height,
            fontSize: parseFloat(getComputedStyle(node).fontSize),
            field: node.matches('.field input, .field select'),
          })),
        };
      });
      expect(metrics.background).toBe('rgb(255, 255, 255)');
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
      expect(metrics.headingRight).toBeLessThanOrEqual(metrics.closeLeft - 4);
      expect(metrics.coverWidth).toBeLessThanOrEqual(64);
      expect(metrics.coverHeight).toBeLessThanOrEqual(80);
      for (const control of metrics.controls) {
        expect(control.height).toBeGreaterThanOrEqual(44);
        if (control.field) expect(control.fontSize).toBeGreaterThanOrEqual(16);
      }
      if (viewport.height >= 740) expect(metrics.bodyOverflow).toBeLessThanOrEqual(1);
      const initialFooter = await footer.boundingBox();
      expect(initialFooter.y + initialFooter.height).toBeLessThanOrEqual(viewport.height + 1);
      await testInfo.attach(`material-add-initial-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
      await expectVisibleInBody(nameInput(page), body);
      await nameInput(page).fill(`新しい教材 ${viewport.width}`);
      await expectVisibleInBody(dialog.getByLabel('教科', { exact: true }), body);
      await expectVisibleInBody(dialog.getByLabel('学習状態', { exact: true }), body);
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      expect((await footer.boundingBox()).y).toBeCloseTo(initialFooter.y, 0);
      await expect(save).toBeEnabled();
      await save.click();
      await expect(dialog).toHaveCount(0);
      const saved = await page.evaluate(() => window.__plannerRecoveryRepository.readDurable());
      expect(saved.materials.find(material => material.name === `新しい教材 ${viewport.width}`)).toMatchObject({ paceEnabled: false, studyStatus: 'studying' });
      expect(externalRequests).toEqual([]);
    });
  });
}

test.describe('material creation expanded controls', () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } });

  test('keeps catalog/contents review optional and retains metadata and pace settings on save', async ({ page }, testInfo) => {
    const externalRequests = await boot(page, 390);
    const attribution = sheet(page).locator('.material-create-attribution');
    await expect(attribution.getByRole('link', { name: '国立国会図書館', exact: true })).toBeVisible();
    await expect(attribution.getByRole('link', { name: 'CC BY 4.0', exact: true })).toBeVisible();
    await expect(attribution.getByRole('link', { name: 'openBD', exact: true })).toBeHidden();
    // Click the disclosure marker, not either outgoing source link.
    await attribution.locator('summary').click({ position: { x: 5, y: 20 } });
    await expect(attribution.getByRole('link', { name: 'openBD', exact: true })).toBeVisible();
    await expect(attribution).toContainText('国立国会図書館全国書誌情報を加工');
    await attribution.locator('summary').click({ position: { x: 5, y: 20 } });
    await expect(attribution.getByRole('link', { name: 'openBD', exact: true })).toBeHidden();
    await selectCatalog(page, true);
    await settle(page);
    await expect(sheet(page).locator('.material-create-catalog summary')).toBeFocused();
    await expect(sheet(page).locator('.material-metadata-result')).toHaveCount(0);
    const details = sheet(page).locator('.material-create-catalog');
    await expect(details).not.toHaveAttribute('open');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open');
    await expect(details).toContainText('ISBN 9780000000000');
    await expect(details).toContainText('第1章 基本');
    await details.getByRole('button', { name: 'ページ数をペース管理に使う' }).click();
    await expect(sheet(page).getByLabel('総量', { exact: true })).toHaveValue('248');
    await sheet(page).getByLabel('現在位置', { exact: true }).fill('12');
    await testInfo.attach('material-add-catalog-and-pace', { body: await page.screenshot(), contentType: 'image/png' });
    await sheet(page).getByRole('button', { name: '保存', exact: true }).click();
    await expect(sheet(page)).toHaveCount(0);
    const saved = await page.evaluate(() => window.__plannerRecoveryRepository.readDurable());
    const material = saved.materials.find(material => material.catalogEntryId === candidate.catalogEntryId);
    expect(material).toMatchObject({ catalogIsbn13: candidate.isbn13, paceEnabled: true, totalUnits: 248, currentUnit: 12 });
    const preferences = await page.evaluate(material => JSON.parse(localStorage.getItem(`studyplanner:material-detail:v1:${material.userId}:${material.id}`)), material);
    expect(preferences).toMatchObject({ structureEnabled: true, structureVisible: true });
    expect(preferences.structureItems.map(item => item.title)).toEqual(candidate.tableOfContents);
    await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
    await page.reload();
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '教材', exact: true }).click();
    const reloaded = await page.evaluate(material => JSON.parse(localStorage.getItem(`studyplanner:material-detail:v1:${material.userId}:${material.id}`)), material);
    expect(reloaded).toEqual(preferences);
    expect((await page.evaluate(() => window.__plannerRecoveryRepository.readDurable())).materials.find(item => item.id === material.id)).toMatchObject({ catalogIsbn13: candidate.isbn13, totalUnits: 248, currentUnit: 12 });
    expect(externalRequests).toEqual([]);
  });

  test('keeps actions above a simulated keyboard and exposes every expanded field', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      window.__materialKeyboardViewport = viewport;
    });
    const externalRequests = await boot(page, 390);
    await nameInput(page).fill('キーボード確認');
    await sheet(page).getByLabel('教材ペース管理を使う').check();
    await page.evaluate(() => {
      Object.assign(window.__materialKeyboardViewport, { height: 400, offsetTop: 40 });
      window.__materialKeyboardViewport.dispatchEvent(new Event('resize'));
    });
    const body = sheet(page).locator('.material-create-body');
    const footer = sheet(page).locator('.material-create-footer');
    const rect = await footer.boundingBox();
    expect(rect.y + rect.height).toBeLessThanOrEqual(441);
    for (const label of ['単位', '総量', '現在位置', '目標日', '1単位あたりの目安時間', '1日の最大量']) {
      await expectVisibleInBody(sheet(page).getByLabel(label, { exact: true }), body);
    }
    await sheet(page).getByLabel('1日の最大量', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(footer.getByRole('button', { name: '保存', exact: true })).toBeFocused();
    await testInfo.attach('material-add-simulated-keyboard', { body: await page.screenshot(), contentType: 'image/png' });
    await footer.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await page.locator('.bookshelf-add-material-fab').click();
    await expect(nameInput(page)).toHaveValue('');
    await expect(sheet(page).getByLabel('教材ペース管理を使う')).not.toBeChecked();
    expect(externalRequests).toEqual([]);
  });

  test('allows 200% text and dark mode without losing controls or exposing the background', async ({ page }, testInfo) => {
    const externalRequests = await boot(page, 390);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      document.documentElement.dataset.theme = 'dark';
    });
    await expect(sheet(page)).toHaveCSS('background-color', 'rgb(24, 31, 35)');
    const body = sheet(page).locator('.material-create-body');
    for (const label of ['教材名', '教科', '学習状態']) {
      await expectVisibleInBody(sheet(page).getByLabel(label, { exact: true }), body);
    }
    await nameInput(page).fill('大きい文字');
    const footer = sheet(page).locator('.material-create-footer');
    const bounds = await footer.boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    expect(await sheet(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await testInfo.attach('material-add-large-text-dark', { body: await page.screenshot(), contentType: 'image/png' });
    await footer.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });
});

for (const theme of ['light', 'dark']) {
  test.describe(`material creation pixel ${theme}`, () => {
    test.use({ viewport: { width: 360, height: 740 }, screen: { width: 360, height: 740 } });
    test('keeps its header, body and footer opaque and on one page', async ({ page }, testInfo) => {
      const externalRequests = await boot(page, 360);
      await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click();
      await page.evaluate(theme => {
        localStorage.setItem('study-planner-appearance', 'pixel');
        localStorage.setItem('study-planner-theme-mode', theme);
        sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true');
      }, theme);
      const font = fs.readFileSync(new URL('../../public/fonts/DotGothic16-Regular.woff2', import.meta.url));
      await page.route('**/fonts/DotGothic16-Regular.woff2', route => route.fulfill({ contentType: 'font/woff2', body: font }));
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '教材', exact: true }).click();
      await page.locator('.bookshelf-add-material-fab').click();
      await expect.poll(() => nameInput(page).evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
      const geometry = await sheet(page).evaluate(element => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        const alpha = node => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(node).backgroundColor;
          context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[3];
        };
        const body = element.querySelector('.material-create-body');
        return {
          alpha: [element, element.querySelector('.section-header'), element.querySelector('.material-create-footer')].map(alpha),
          overflow: body.scrollHeight - body.clientHeight,
          horizontalOverflow: element.scrollWidth - element.clientWidth,
        };
      });
      expect(geometry.alpha).toEqual([255, 255, 255]);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
      await testInfo.attach(`material-add-pixel-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
      await nameInput(page).fill('ドットの教材');
      await expect(sheet(page).getByRole('button', { name: '保存', exact: true })).toBeEnabled();
      await sheet(page).getByRole('button', { name: 'キャンセル', exact: true }).click();
      await expect(sheet(page)).toHaveCount(0);
      expect(externalRequests).toEqual([]);
    });
  });
}
