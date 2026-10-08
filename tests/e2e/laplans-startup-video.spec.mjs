import { expect, test } from './support/fixed-clock.mjs';

test.use({ reducedMotion: 'no-preference', hasTouch: true });
const URL = 'http://127.0.0.1:4174/startup-gates.html';
const skipName = '起動アニメーションをスキップ';

async function boot(page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new globalThis.URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupGateHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => false, refresh: async () => {} };
    }
  ` }));
  await page.goto(URL);
  await page.waitForFunction(() => Boolean(window.__startupGateHarness));
}

async function startPlanner(page) {
  await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('accepted'); });
}

async function expectStaticLoading(page) {
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Laplans', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'アプリ起動中', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('アプリを準備しています...');
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
}

for (const width of [390, 1280]) {
  test(`plays the supplied clip inline once and touch skip preserves startup gates at ${width}px`, async ({ page }, testInfo) => {
    await boot(page, width);
    const video = page.locator('video');
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
    const original = await page.locator('.splash-screen:visible').elementHandle();
    expect(await video.evaluate(node => ({ muted: node.muted, inline: node.playsInline, controls: node.controls,
      width: node.videoWidth, height: node.videoHeight, fit: getComputedStyle(node).objectFit })))
      .toEqual({ muted: true, inline: true, controls: false, width: 512, height: 910, fit: 'contain' });
    await startPlanner(page);
    await expect(video).toHaveCount(1);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: skipName }).tap();
    await expectStaticLoading(page);
    expect(await original.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor,
      splash: getComputedStyle(document.querySelector('.startup-splash')).backgroundColor })))
      .toEqual({ body: 'rgb(6, 9, 20)', splash: 'rgb(6, 9, 20)' });
    await testInfo.attach(`laplans-skipped-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.splash-screen:visible')).toHaveCount(0);
  });
}

for (const key of ['Enter', 'Space', 'Escape']) {
  test(`keyboard ${key} skips the decoration without releasing pending authentication`, async ({ page }) => {
    await boot(page);
    const button = page.getByRole('button', { name: skipName });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press(key);
    await expectStaticLoading(page);
  });
}

test('actual video completion keeps the final Laplans frame while data remains pending', async ({ page }) => {
  await boot(page);
  await startPlanner(page);
  await expect.poll(() => page.locator('video').evaluate(node => node.currentTime)).toBeGreaterThan(0);
  await page.locator('video').evaluate(node => {
    node.addEventListener('ended', () => { window.__laplansEnded = { time: node.currentTime, duration: node.duration }; }, { once: true });
  });
  await expect(page.locator('video')).toHaveCount(0, { timeout: 12_000 });
  const ended = await page.evaluate(() => window.__laplansEnded);
  expect(ended).toBeDefined();
  expect(ended.time).toBeCloseTo(9, 1);
  expect(ended.duration).toBeCloseTo(9, 1);
  await expectStaticLoading(page);
});

test('ready application removes playing video immediately and unloads the media source', async ({ page }) => {
  await boot(page);
  await expect.poll(() => page.locator('video').evaluate(node => node.currentTime)).toBeGreaterThan(0);
  const media = await page.locator('video').elementHandle();
  await startPlanner(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await media.evaluate(node => ({ connected: node.isConnected, source: node.getAttribute('src'), paused: node.paused })))
    .toEqual({ connected: false, source: null, paused: true });
});

test('reduced motion presents the final frame and makes no video request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requestedVideos = [];
  page.on('request', request => { if (new globalThis.URL(request.url()).pathname.endsWith('.mp4')) requestedVideos.push(request.url()); });
  await boot(page);
  await expectStaticLoading(page);
  await startPlanner(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  expect(requestedVideos).toEqual([]);
});

test('blocked autoplay falls back without trapping startup', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Blocked autoplay fixture', 'NotAllowedError'));
  });
  await boot(page);
  await expectStaticLoading(page);
  await startPlanner(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
});
