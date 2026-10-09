import { expect, test } from './support/fixed-clock.mjs';

async function boot(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupGateHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => false, refresh: async () => {} };
    }
  ` }));
  await page.goto('http://127.0.0.1:4174/startup-gates.html?startupTiming=1&preferenceWait=1');
  await page.waitForFunction(() => Boolean(window.__preferenceReadHarness));
  await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('accepted'); });
  await expect.poll(() => page.evaluate(() => window.__preferenceReadHarness.readCount)).toBeGreaterThan(0);
}
const recovery = page => page.getByRole('heading', { name: '学習設定を読み込めませんでした' });

for (const width of [320, 390, 1280]) {
  test(`stalled preferences recover with a fresh read and preserve planner readiness at ${width}px`, async ({ page }) => {
    await boot(page, width);
    const initialReads = await page.evaluate(() => window.__preferenceReadHarness.readCount);
    await page.clock.fastForward(15_000);
    await expect(recovery(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'この設定で始める' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '週の始まり' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'ログアウトする' })).toBeEnabled();
    expect(await page.evaluate(() => window.__preferenceReadHarness.writes)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/preferences-recovery-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    await expect(recovery(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__preferenceReadHarness.readCount)).toBe(initialReads + 1);
    await page.evaluate(async initial => {
      for (let i = 0; i < initial; i += 1) await window.__preferenceReadHarness.resolve(i);
    }, initialReads);
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    await page.evaluate(index => window.__preferenceReadHarness.resolve(index), initialReads);
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryRepository.snapshot().pendingReads)).toContain('getScheduleSnapshot');
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.home-main')).toContainText('最新の予定');
    expect(await page.evaluate(() => window.__preferenceReadHarness.writes)).toBe(0);
  });
}

test('successful missing-profile retry preserves explicit initial settings selection', async ({ page }) => {
  await boot(page, 390);
  await page.clock.fastForward(15_000);
  await expect(recovery(page)).toBeVisible();
  await page.getByRole('button', { name: 'もう一度読み込む' }).click();
  await page.evaluate(() => window.__preferenceReadHarness.resolve(window.__preferenceReadHarness.readCount - 1, true));
  await expect(page.getByRole('heading', { name: '1週間の始まりを選択' })).toBeVisible();
  await page.getByRole('combobox', { name: '週の始まり' }).selectOption('sunday');
  await page.getByRole('button', { name: 'この設定で始める' }).click();
  await expect.poll(() => page.evaluate(() => window.__preferenceReadHarness.writes)).toBe(1);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(`studyplanner-weekly-personalization-v1:${window.__startupGateHarness.ownerId}`)).weekStartsOn.value)).toBe('sunday');
});
