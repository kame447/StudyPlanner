import { expect, test } from './support/fixed-clock.mjs';

const RUNTIME = /\/assets\/weeklyPlanningStableV5InstrumentedRuntimeExecutor-[\w-]+\.js(?:\?.*)?$/;
const CAPSULE_KEY = 'studyplanner.aiPlanning.moduleRecovery.v1';
const IMAGE = { name: 'recovery.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };

async function openFixture(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Reload must retain canonical chat and capsule data; seed only the first document.
    if (localStorage.getItem('issue443.fixture.seeded')) return;
    const user = { id: 'issue443-fixture', email: 'issue443@example.com', username: 'issue443-fixture', avatar: '', createdAt: new Date().toISOString() };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents',
      'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('issue443.fixture.seeded', 'true');
  });
  let htmlFailure = true;
  const runtimeResponses = [];
  const externalRequests = [];
  // No live AI, OCR, auth, or other third-party request may leave this fixture.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return route.fallback();
    externalRequests.push({ method: route.request().method(), origin: url.origin });
    await route.abort('blockedbyclient');
  });
  await page.route(RUNTIME, async route => {
    if (htmlFailure) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>SPA fallback for missing hashed module</body></html>' });
    await route.continue();
  });
  page.on('response', response => {
    if (RUNTIME.test(response.url())) runtimeResponses.push(response.headers()['content-type'] ?? '');
  });
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();
  return { externalRequests, runtimeResponses, repairRuntime: () => { htmlFailure = false; } };
}

test('actual production runtime MIME failure preserves a mobile draft through explicit reload without auto-submission', async ({ page }, testInfo) => {
  const fixture = await openFixture(page);
  const input = page.locator('.ai-planning-composer textarea');
  const originalText = '  明日の予定立てたい\n';
  await input.fill(originalText);
  await page.locator('.ai-planning-attachment-input').setInputFiles(IMAGE);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('計画に必要な機能を読み込めませんでした');
  await expect(input).toHaveValue(originalText);
  await expect(page.getByLabel('添付画像 recovery.png', { exact: true })).toBeVisible();
  await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
  expect(fixture.externalRequests).toEqual([]);
  expect(fixture.runtimeResponses.some(type => type.startsWith('text/html'))).toBe(true);

  const reloadButton = page.getByRole('button', { name: '入力を一時保存して画面を更新', exact: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await reloadButton.scrollIntoViewIfNeeded();
    await expect(reloadButton).toBeVisible();
    const box = await reloadButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(input).toHaveValue(originalText);
  }
  await page.screenshot({ path: testInfo.outputPath('issue443-mobile-load-error.png'), fullPage: true });

  fixture.repairRuntime();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name: '入力を一時保存して画面を更新', exact: true }).click(),
  ]);
  await page.locator('.primary-bottom-nav button').filter({ hasText: 'AI計画' }).click();
  await expect(input).toHaveValue(originalText);
  await expect(page.getByLabel('添付画像 recovery.png', { exact: true })).toBeVisible();
  await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), CAPSULE_KEY)).toBeNull();
  expect(fixture.externalRequests).toEqual([]);
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('issue443-mobile-restored-draft.png'), fullPage: true });

  // Resume only on an explicit user action. Removing the image avoids requiring a Firebase
  // OCR identity; provider requests remain blocked. This proves runtime resumption, not live-AI success.
  await page.getByRole('button', { name: '添付画像を削除', exact: true }).click();
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => fixture.runtimeResponses.some(type => type.includes('javascript'))).toBe(true);
  await expect(page.locator('.ai-planning-message-row.user')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '入力を一時保存して画面を更新', exact: true })).toHaveCount(0);
});

test('explicit reload fails closed on browser sessionStorage quota and keeps editable input and image', async ({ page }) => {
  const fixture = await openFixture(page);
  await page.locator('.ai-planning-composer textarea').fill('保存失敗でも残す入力');
  await page.locator('.ai-planning-attachment-input').setInputFiles(IMAGE);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('計画に必要な機能を読み込めませんでした');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === sessionStorage && name === key) throw new DOMException('fixture quota', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, CAPSULE_KEY);
  const document = await page.locator('html').elementHandle();
  await page.getByRole('button', { name: '入力を一時保存して画面を更新', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('画面は更新していません');
  expect(await document.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('.ai-planning-composer textarea')).toHaveValue('保存失敗でも残す入力');
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  await expect(page.getByLabel('添付画像 recovery.png', { exact: true })).toBeVisible();
  await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
  expect(fixture.externalRequests).toEqual([]);
});
