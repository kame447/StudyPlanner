import { expect, test } from './support/startup-ready.mjs';

const HARNESS_URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
const escapedHarnessOrigin = new URL(HARNESS_URL).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const externalRequest = new RegExp(`^(?!${escapedHarnessOrigin}(?:/|$))https?://`);
// Playwright forwards this media setting through contextOptions, not use.reducedMotion.
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const candidate = { catalogEntryId: 'synthetic-name-catalog', title: '検索候補の教材名', authors: [], aliases: ['合成教材'] };
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
async function selectCatalog(page) {
  await sheet(page).getByLabel('ISBN / 教材名').fill('合成教材');
  await sheet(page).getByRole('button', { name: '検索', exact: true }).click();
  await sheet(page).locator('.material-metadata-result').click();
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
