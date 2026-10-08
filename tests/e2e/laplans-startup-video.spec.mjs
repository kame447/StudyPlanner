import { expect, test } from './support/fixed-clock.mjs';

test.use({ reducedMotion: 'no-preference', hasTouch: true });
const URL = 'http://127.0.0.1:4174/startup-gates.html';
const skipName = '起動アニメーションをスキップ';

function observeVideoTransfers(page) {
  const transfers = { requests: [], responses: [], assetModules: [] };
  const isMp4 = url => new globalThis.URL(url).pathname.endsWith('.mp4');
  page.on('request', request => {
    if (!isMp4(request.url())) return;
    const observed = { url: request.url(), resourceType: request.resourceType() };
    // Vite imports a JavaScript URL module before React renders. It is not a
    // media transfer; fetch/XHR/preload requests still count, as do media loads.
    if (observed.resourceType === 'script') transfers.assetModules.push(observed);
    else transfers.requests.push(observed);
  });
  page.on('response', response => {
    if (isMp4(response.url()) && /^video\/mp4(?:;|$)/i.test(response.headers()['content-type'] ?? '')) {
      transfers.responses.push({ url: response.url(), status: response.status() });
    }
  });
  return transfers;
}

async function boot(page, width = 390, beforeNavigation) {
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
  await beforeNavigation?.();
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
    const transfers = observeVideoTransfers(page);
    await boot(page, width);
    const video = page.locator('video');
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
    await expect.poll(() => transfers.requests.length).toBeGreaterThan(0);
    await expect.poll(() => transfers.responses.length).toBeGreaterThan(0);
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

test('Pages-style full-body 200 delivery completes the video while startup data remains pending', async ({ page }, testInfo) => {
  const { readFile } = await import('node:fs/promises');
  const clip = await readFile(new globalThis.URL('../../src/assets/laplans_blackhole_1080x1920.mp4', import.meta.url));
  const deliveries = [];
  await boot(page, 390, async () => {
    await page.route('**/*.mp4*', async route => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.resourceType() === 'script' || url.hostname !== '127.0.0.1') return route.fallback();
      deliveries.push({ range: request.headers().range ?? null, resourceType: request.resourceType(), status: 200, bytes: clip.length });
      // Match Pages' observed delivery boundary: ignore Range and send the
      // complete original binary with a strong ETag and no Content-Range.
      await route.fulfill({ status: 200, contentType: 'video/mp4',
        headers: { 'Content-Length': String(clip.length), ETag: '"laplans-full-body-fixture"' }, body: clip });
    });
  });
  try {
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
    expect(deliveries.some(delivery => /^bytes=/.test(delivery.range ?? ''))).toBe(true);
    expect(deliveries.every(delivery => delivery.status === 200 && delivery.bytes === 1_628_755)).toBe(true);
    await expectStaticLoading(page);
  } finally {
    await testInfo.attach('pages-full-body-delivery', { body: Buffer.from(JSON.stringify(deliveries, null, 2)), contentType: 'application/json' });
  }
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
  const transfers = observeVideoTransfers(page);
  await boot(page);
  await expectStaticLoading(page);
  await startPlanner(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  expect(transfers.requests).toEqual([]);
  expect(transfers.responses).toEqual([]);
});

test('video transfer observer detects a deliberately downloaded MP4 under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transfers = observeVideoTransfers(page);
  await boot(page);
  await expectStaticLoading(page);
  expect(transfers.requests).toEqual([]);
  expect(transfers.responses).toEqual([]);

  // Negative control for the no-transfer claim: fetch the actual binary after
  // the untouched application has proved it did not request it automatically.
  const importedAsset = transfers.assetModules.find(request => new globalThis.URL(request.url).searchParams.has('import'));
  expect(importedAsset).toBeDefined();
  const assetUrl = new globalThis.URL(importedAsset.url);
  assetUrl.searchParams.delete('import');
  const downloaded = await page.evaluate(async url => {
    const response = await fetch(url, { cache: 'no-store' });
    return { ok: response.ok, type: response.headers.get('content-type'), size: (await response.arrayBuffer()).byteLength };
  }, assetUrl.href);
  expect(downloaded).toEqual({ ok: true, type: 'video/mp4', size: 1_628_755 });
  expect(transfers.requests).not.toEqual([]);
  await expect.poll(() => transfers.responses.length).toBeGreaterThan(0);
  await expectStaticLoading(page);
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
