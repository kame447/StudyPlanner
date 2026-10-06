import { expect, test } from './support/fixed-clock.mjs';
const URL = 'http://127.0.0.1:4174/startup-schedule-preview.html?startupTiming=1';
async function boot(page, width, miss = false) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new globalThis.URL(route.request().url()).hostname) ? route.continue() : route.abort());
  // Replace only external identity/consent verdicts. Preferences, planner reads,
  // cache capture, root visibility, memory provider and App remain production.
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupPreviewHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => false, refresh: async () => {} };
    }
  ` }));
  await page.goto(URL + (miss ? '&miss=1' : ''));
  await page.waitForFunction(() => Boolean(window.__startupPreviewHarness));
}
const preview = page => page.getByRole('main', { name: '前回取得した予定', exact: true });
const rows = async page => JSON.parse(await page.getByLabel('起動時間の診断').locator('pre').textContent());
for (const width of [1280, 390]) {
  test(`cached schedules remain read-only until current readiness at ${width}px`, async ({ page }, testInfo) => {
    await boot(page, width);
    await expect(preview(page)).toHaveCount(0);
    const originalSplash = await page.locator('.splash-screen:visible').elementHandle();
    expect(originalSplash).not.toBeNull();
    await page.evaluate(() => window.__startupPreviewHarness.emitAuth());
    expect(await originalSplash.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.locator('.splash-screen')).toHaveCount(1);
    await expect(preview(page)).toHaveCount(0);
    await page.evaluate(() => window.__startupPreviewHarness.emitPolicy('accepted'));
    await expect(preview(page)).toBeVisible();
    await expect(preview(page)).toContainText('前回の予定');
    await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toHaveCount(0);
    await expect(page.locator('.ai-planning-composer')).toHaveCount(0);
    await expect(preview(page).locator('button,input,textarea,a')).toHaveCount(0);
    await expect.poll(async () => (await rows(page)).some(row => row.phase === 'cached-schedule-visible')).toBe(true);
    expect((await rows(page)).some(row => row.phase === 'home-visible')).toBe(false);
    expect(await page.evaluate(() => window.__realWeeklyEvents)).toEqual([]);
    const shot = testInfo.outputPath(`startup-preview-${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('Read-only startup schedules', { path: shot, contentType: 'image/png' });
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(preview(page)).toHaveCount(0);
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.home-main')).toContainText('最新の予定');
    await expect.poll(async () => (await rows(page)).some(row => row.phase === 'home-visible')).toBe(true);
    const timings = await rows(page);
    expect(timings.find(row => row.phase === 'home-visible').startMs).toBeGreaterThan(timings.find(row => row.phase === 'cached-schedule-visible').startMs);
    await testInfo.attach('Controlled startup milestone order', { body: JSON.stringify({ scope: 'Synthetic held reads, not production latency', timings }), contentType: 'application/json' });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(`studyplanner.startup-schedule.v1:${window.__startupPreviewHarness.ownerId}`)));
    expect(stored.rows.some(row => row.title === '最新の予定')).toBe(true);
    await page.reload(); await page.waitForFunction(() => Boolean(window.__startupPreviewHarness));
    await page.evaluate(() => { window.__startupPreviewHarness.emitAuth(); window.__startupPreviewHarness.emitPolicy('accepted'); });
    await expect(preview(page)).toContainText('最新の予定');
    await page.evaluate(() => window.__startupPreviewHarness.emitAuth(null));
    await expect(preview(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.startup-schedule.v1:startup-preview-owner'))).toBeNull();
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.startup-schedule.v1:startup-preview-owner'))).toBeNull();
  });
}
test('cache miss uses normal splash and failed cached load stays read-only', async ({ page }) => {
  await boot(page, 390, true);
  const originalSplash = await page.locator('.splash-screen:visible').elementHandle();
  expect(originalSplash).not.toBeNull();
  await page.evaluate(() => { window.__startupPreviewHarness.emitAuth(); window.__startupPreviewHarness.emitPolicy('accepted'); });
  await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
  expect(await originalSplash.evaluate(node => node.isConnected)).toBe(true);
  await expect(preview(page)).toHaveCount(0);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  expect(await originalSplash.evaluate(node => node.isConnected)).toBe(false);
  await page.reload(); await page.waitForFunction(() => Boolean(window.__startupPreviewHarness));
  await page.evaluate(() => { window.__startupPreviewHarness.emitAuth(); window.__startupPreviewHarness.emitPolicy('accepted'); window.__plannerRecoveryRepository.failNextMonthRead(); });
  await expect(preview(page)).toBeVisible();
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(preview(page)).toContainText('最新の予定を確認できませんでした');
  await expect(preview(page).getByRole('button', { name: '再読み込み', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toHaveCount(0);
});
