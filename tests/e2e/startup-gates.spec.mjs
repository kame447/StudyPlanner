import { expect, test } from './support/fixed-clock.mjs';
const URL = 'http://127.0.0.1:4174/startup-gates.html?startupTiming=1';
async function boot(page, width, query = '') {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new globalThis.URL(route.request().url()).hostname) ? route.continue() : route.abort());
  // Replace only external identity/consent verdicts. Preferences, planner reads,
  // root visibility, memory provider and App remain production.
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupGateHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => false, refresh: async () => {} };
    }
  ` }));
  await page.goto(URL + query);
  await page.waitForFunction(() => Boolean(window.__startupGateHarness));
}

const rows = async page => JSON.parse(await page.getByLabel('起動時間の診断').locator('pre').textContent());
for (const width of [1280, 390]) {
  test(`normal Home follows one visible Splash and never a retired preview at ${width}px`, async ({ page }) => {
    await boot(page, width);
    const originalSplash = await page.locator('.splash-screen:visible').elementHandle();
    expect(originalSplash).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem(`studyplanner.startup-schedule.v1:${window.__startupGateHarness.ownerId}`))).toBeNull();
    await page.evaluate(() => window.__startupGateHarness.emitAuth());
    expect(await originalSplash.evaluate(node => node.isConnected)).toBe(true);
    await page.evaluate(() => window.__startupGateHarness.emitPolicy('accepted'));
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    expect(await originalSplash.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.getByRole('main', { name: '前回取得した予定', exact: true })).toHaveCount(0);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    expect((await rows(page)).some(row => row.phase === 'home-visible')).toBe(false);
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.home-main')).toContainText('最新の予定');
    expect(await originalSplash.evaluate(node => node.isConnected)).toBe(false);
    await expect.poll(async () => (await rows(page)).some(row => row.phase === 'home-visible')).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem(`studyplanner.startup-schedule.v1:${window.__startupGateHarness.ownerId}`))).toBeNull();
    await page.reload(); await page.waitForFunction(() => Boolean(window.__startupGateHarness));
    await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('accepted'); });
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    await page.evaluate(() => window.__startupGateHarness.emitAuth(null));
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    await expect(page.getByRole('main', { name: '前回取得した予定', exact: true })).toHaveCount(0);
  });
}
test('current read failure uses ordinary recovery, never the retired copy', async ({ page }) => {
  await boot(page, 390);
  await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('accepted'); window.__plannerRecoveryRepository.failNextMonthRead(); });
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  await expect(page.getByLabel('学習データの表示状況')).toBeVisible();
  await expect(page.getByRole('button', { name: '表示の更新を再試行', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: '前回取得した予定', exact: true })).toHaveCount(0);
  expect((await rows(page)).some(row => row.phase === 'month-events' && row.outcome === 'error')).toBe(true);
});

for (const cachedAuth of [false, true]) {
  for (const mode of ['off', 'observe']) {
    test(`StrictMode ${mode} observation releases every listener with ${cachedAuth ? 'cached' : 'pending'} auth`, async ({ page }) => {
      await boot(page, 390, `&startupProfile=${mode}&cachedAuth=${cachedAuth ? '1' : '0'}`);
      if (!cachedAuth) await page.evaluate(() => window.__startupGateHarness.emitAuth());
      await page.evaluate(() => window.__startupGateHarness.emitPolicy('accepted'));
      await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
      if (mode === 'observe') await expect.poll(() => page.evaluate(() => window.__startupGateHarness.observations.active)).toBe(1);
      await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
      await expect(page.locator('.home-main')).toBeVisible();
      const counts = await page.evaluate(() => window.__startupGateHarness.observations);
      expect(counts.active).toBe(0);
      expect(counts.stopped).toBe(counts.started);
      expect(counts.maxActive).toBe(mode === 'observe' ? 1 : 0);
      if (mode === 'observe') expect(counts.started).toBeGreaterThanOrEqual(2);
      else expect(counts.started).toBe(0);
      const diagnosticBox = await page.getByLabel('起動時間の診断').boundingBox();
      const navigationBox = await page.getByRole('navigation', { name: '主要ナビゲーション' }).boundingBox();
      expect(diagnosticBox.y + diagnosticBox.height).toBeLessThanOrEqual(navigationBox.y);
      await page.getByRole('button', { name: '予定', exact: true }).click();
      await expect(page.locator('.schedule-main')).toBeVisible();
    });
  }
}

for (const cachedAuth of [false, true]) {
  test(`StrictMode marker observation survives profile and closes at bootstrap with ${cachedAuth ? 'cached' : 'pending'} auth`, async ({ page }) => {
    await boot(page, 390, `&startupMarker=observe&startupProfile=off&cachedAuth=${cachedAuth ? '1' : '0'}`);
    if (!cachedAuth) await page.evaluate(() => window.__startupGateHarness.emitAuth());
    await page.evaluate(() => window.__startupGateHarness.emitPolicy('accepted'));
    await expect.poll(() => page.evaluate(() => window.__startupGateHarness.markerObservations.active)).toBe(1);
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main')).toBeVisible();
    const counts = await page.evaluate(() => window.__startupGateHarness.markerObservations);
    expect(counts.started).toBeGreaterThanOrEqual(2);
    expect(counts.stopped).toBe(counts.started); expect(counts.active).toBe(0); expect(counts.maxActive).toBe(1);
    expect(await page.evaluate(() => window.__startupGateHarness.observations.started)).toBe(0);
    await page.getByRole('button', { name: '予定', exact: true }).click();
    await expect(page.locator('.schedule-main')).toBeVisible();
  });
}
