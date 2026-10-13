import { readFileSync } from 'node:fs';
import { expect, test } from './support/fixed-clock.mjs';

// Exercise the actual root/recovery/App and local repositories. Firebase write
// semantics are covered by the real-repository Vitest cases, not duplicated here.
test.use({ skipStartupVideo: false, reducedMotion: 'reduce' });
const URL = 'http://127.0.0.1:4174/startup-gates.html?profileRecovery=1&cachedAuth=1';
const logo = readFileSync(new globalThis.URL('../../public/icons/laplans-192.png', import.meta.url));
const recovery = page => page.getByTestId('profile-restore-recovery');
const retry = page => recovery(page).getByRole('button');

async function boot(page, { width = 390, mode = 'light', intro = false } = {}) {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: intro ? 'no-preference' : 'reduce' });
  await page.addInitScript(({ mode }) => {
    localStorage.setItem('study-planner-theme-mode', mode);
    localStorage.setItem('study-planner-theme-palette', 'ocean');
  }, { mode });
  // No theme attribute or CSS variable is injected by this test.
  await page.route('**/*', route => {
    const hostname = new globalThis.URL(route.request().url()).hostname;
    if (['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  // The test-only Vite root has no production public directory. Serve the exact
  // shared logo bytes without changing global harness configuration or markup.
  await page.route('http://127.0.0.1:4174/icons/laplans-192.png', route => route.fulfill({ contentType: 'image/png', body: logo }));
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupGateHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => false, refresh: async () => {} };
    }
  ` }));
  if (intro) {
    await page.clock.pauseAt(new Date('2026-08-19T10:01:00+09:00'));
    // Freeze the media watchdog while inspecting its separate readiness gate.
    // A held healthy media promise lets this case inspect the independent
    // presentation gate; it is not a claim about native playback performance.
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); };
      document.addEventListener('play', event => {
        if (event.target instanceof HTMLMediaElement) event.target.pause();
      }, true);
    });
  }
  await page.goto(URL);
  await page.waitForFunction(() => Boolean(window.__profileRestoreHarness && window.__startupGateHarness));
  await page.evaluate(() => window.__startupGateHarness.emitPolicy('accepted'));
  await expect.poll(() => page.evaluate(() => window.__profileRestoreHarness.calls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__profileRestoreHarness.memoryCalls)).toBeGreaterThan(0);
  await expect(recovery(page)).toHaveCount(0);
  await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBeNull();
  return () => { expect(errors).toEqual([]); expect(external).toEqual([]); };
}

async function releaseMemory(page) {
  await page.evaluate(() => window.__profileRestoreHarness.releaseMemory());
  await expect(recovery(page)).toBeVisible();
  await expect(page.getByRole('tablist', { name: '認証モード' })).toHaveCount(0);
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  await expect(retry(page)).toBeEnabled();
}
async function beginRetry(page, { burst = false } = {}) {
  const before = await page.evaluate(() => window.__profileRestoreHarness.calls);
  await page.evaluate(() => { window.__profileRestoreHarness.rejectImmediately = false; });
  if (burst) {
    // One dedicated synthetic same-task burst tests synchronous admission.
    await retry(page).evaluate(button => { button.click(); button.click(); button.click(); });
  } else {
    await retry(page).click();
  }
  await expect.poll(() => page.evaluate(() => window.__profileRestoreHarness.calls)).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => window.__profileRestoreHarness.pending)).toBe(1);
  await expect(retry(page)).toBeDisabled();
  await expect(recovery(page)).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.splash-screen:visible')).toHaveCount(0);
  return before + 1;
}
async function finishRetry(page, calls) {
  await page.evaluate(() => window.__profileRestoreHarness.resolveRestore());
  await expect.poll(() => page.evaluate(() => window.__plannerRecoveryRepository.snapshot().pendingReads)).toContain('getScheduleSnapshot');
  await expect(recovery(page)).toBeVisible();
  await expect(retry(page)).toBeDisabled();
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  await expect(page.locator('.home-main')).toContainText('最新の予定');
  await expect(recovery(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__profileRestoreHarness.calls)).toBe(calls);
}

for (const width of [320, 390, 1280]) {
  for (const mode of ['light', 'dark']) {
    test(`cold profile recovery restores saved ${mode}/ocean at ${width}px`, async ({ page }, testInfo) => {
      const assertSafe = await boot(page, { width, mode });
      await releaseMemory(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe(mode === 'dark' ? '#6fb2ff' : '#2f6fc2');
      expect(await page.evaluate(() => ({ mode: localStorage.getItem('study-planner-theme-mode'), palette: localStorage.getItem('study-planner-theme-palette') }))).toEqual({ mode, palette: 'ocean' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = await retry(page).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(40); expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expect.poll(() => recovery(page).locator('.brand-mark').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
      await testInfo.attach(`profile-recovery-${mode}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.clock.fastForward(4000);
      await expect(recovery(page)).toBeVisible();
      const calls = await beginRetry(page);
      await finishRetry(page, calls);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      assertSafe();
    });
  }
}

test('repeat restoration failure stays recoverable and external sign-out retires a pending retry', async ({ page }) => {
  const assertSafe = await boot(page, { mode: 'dark' });
  await releaseMemory(page);
  await beginRetry(page, { burst: true });
  await page.evaluate(() => window.__profileRestoreHarness.rejectRestore());
  await expect(recovery(page)).toBeVisible(); await expect(retry(page)).toBeEnabled();
  await expect(recovery(page)).toHaveAttribute('aria-busy', 'false');
  const calls = await beginRetry(page);
  await page.evaluate(() => window.__startupGateHarness.emitAuth(null));
  await expect(page.getByRole('tablist', { name: '認証モード' })).toBeVisible();
  await expect(recovery(page)).toHaveCount(0);
  await page.evaluate(() => window.__profileRestoreHarness.resolveRestore());
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: '認証モード' })).toBeVisible();
  expect(await page.evaluate(() => window.__profileRestoreHarness.calls)).toBe(calls);
  expect(await page.evaluate(() => window.__plannerRecoveryRepository.snapshot().calls.filter(call => call.phase === 'called'))).toEqual([]);
  assertSafe();
});

test('cold failure keeps the healthy intro until a ready skip and retry does not replay it', async ({ page }) => {
  const assertSafe = await boot(page, { mode: 'dark', intro: true });
  const originalVideo = await page.locator('video').elementHandle();
  expect(originalVideo).not.toBeNull();
  await page.evaluate(() => window.__profileRestoreHarness.releaseMemory());
  const skip = page.getByRole('button', { name: '起動アニメーションをスキップ', exact: true });
  await expect(skip).toBeEnabled();
  await expect(recovery(page)).toBeHidden();
  expect(await originalVideo.evaluate(node => node === document.querySelector('video'))).toBe(true);
  await skip.click();
  await expect(recovery(page)).toBeVisible(); await expect(page.locator('video')).toHaveCount(0);
  await finishRetry(page, await beginRetry(page));
  await expect(page.locator('video')).toHaveCount(0);
  assertSafe();
});
