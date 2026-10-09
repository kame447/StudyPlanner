import { expect, test } from './support/fixed-clock.mjs';

test.use({ skipStartupVideo: false, contextOptions: { reducedMotion: 'no-preference' }, hasTouch: true });
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

async function readyPlanner(page) {
  await startPlanner(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.getByRole('button', { name: skipName })).toBeEnabled();
  await expect(page.locator('.startup-video__hint')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('準備できました');
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
}

async function observeEnded(video) {
  await video.evaluate(node => {
    node.addEventListener('ended', event => {
      window.__laplansEnded = { time: node.currentTime, duration: node.duration, trusted: event.isTrusted };
    }, { once: true });
  });
}

async function expectRealCompletion(page) {
  await expect(page.locator('video')).toHaveCount(0, { timeout: 12_000 });
  const ended = await page.evaluate(() => window.__laplansEnded);
  expect(ended).toBeDefined();
  expect(ended.trusted).toBe(true);
  expect(ended.time).toBeCloseTo(5, 1);
  expect(ended.duration).toBeCloseTo(5, 1);
  return ended;
}

async function expectUnloaded(media) {
  expect(await media.evaluate(node => ({ connected: node.isConnected, source: node.getAttribute('src'), paused: node.paused })))
    .toEqual({ connected: false, source: null, paused: true });
}

async function expectStaticLoading(page) {
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Laplance', exact: true })).toBeVisible();
  await expect(page.getByRole('main', { name: 'アプリ起動中', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('アプリを準備しています...');
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
}

for (const width of [390, 1280]) {
  test(`plays the supplied clip inline and allows a ready touch skip at ${width}px`, async ({ page }, testInfo) => {
    const transfers = observeVideoTransfers(page);
    await boot(page, width);
    const video = page.locator('video');
    await expect(video).toHaveCount(1);
    await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
    await expect.poll(() => transfers.requests.length).toBeGreaterThan(0);
    await expect.poll(() => transfers.responses.length).toBeGreaterThan(0);
    const original = await page.locator('.splash-screen:visible').elementHandle();
    const media = await video.elementHandle();
    expect(await video.evaluate(node => ({ muted: node.muted, inline: node.playsInline, controls: node.controls, loop: node.loop,
      width: node.videoWidth, height: node.videoHeight, fit: getComputedStyle(node).objectFit })))
      .toEqual({ muted: true, inline: true, controls: false, loop: false, width: 512, height: 910, fit: 'contain' });
    await startPlanner(page);
    await expect(video).toHaveCount(1);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await original.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor,
      splash: getComputedStyle(document.querySelector('.startup-splash')).backgroundColor })))
      .toEqual({ body: 'rgb(6, 9, 20)', splash: 'rgb(6, 9, 20)' });
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    const button = page.getByRole('button', { name: skipName });
    await expect(button).toBeEnabled();
    await expect(page.locator('.startup-video__hint')).toBeVisible();
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    expect(await original.evaluate(node => node.isConnected)).toBe(true);
    expect(await media.evaluate(node => node === document.querySelector('video') && !node.ended)).toBe(true);
    await testInfo.attach(`laplans-ready-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await button.tap();
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.splash-screen:visible')).toHaveCount(0);
    await expectUnloaded(media);
  });
}

for (const width of [390, 1280]) {
  test.describe(`public authentication initial viewport ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, screen: { width, height: 844 } });
  test(`opens ordinary authentication without a preview key after the intro at ${width}px`, async ({ page }, testInfo) => {
    await boot(page, width);
    const actualViewport = await page.evaluate(width => ({
      client: document.documentElement.clientWidth,
      visual: window.visualViewport?.width,
      media: matchMedia(`(width: ${width}px)`).matches,
    }), width);
    expect(actualViewport.client).toBe(width);
    expect(actualViewport.visual).toBeCloseTo(width, 0);
    expect(actualViewport.media).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.app-access-key'))).toBeNull();
    await page.evaluate(() => window.__startupGateHarness.emitAuth(null));
    await expect(page.getByRole('button', { name: skipName })).toBeEnabled();
    await expect(page.getByRole('heading', { name: '新規会員登録' })).toHaveCount(0);
    const video = page.locator('video');
    await observeEnded(video);
    if (width === 390) await expectRealCompletion(page);
    else await page.getByRole('button', { name: skipName }).click();

    await expect(page.getByRole('heading', { name: '新規会員登録' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '限定公開キー' })).toHaveCount(0);
    await expect(page.getByLabel('閲覧キー', { exact: true })).toHaveCount(0);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`auth-entry-signup-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ログイン', exact: true })).toBeVisible();
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    await expect(page.getByLabel('パスワード', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Googleでログイン' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'パスワードを再設定' })).toBeVisible();
    await testInfo.attach(`auth-entry-login-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    await page.evaluate(() => localStorage.setItem('studyplanner.app-access-key', 'obsolete-synthetic-value'));
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__startupGateHarness));
    await page.evaluate(() => window.__startupGateHarness.emitAuth(null));
    await page.getByRole('button', { name: skipName }).click();
    await expect(page.getByRole('heading', { name: '新規会員登録' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '限定公開キー' })).toHaveCount(0);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.app-access-key'))).toBe('obsolete-synthetic-value');
  });
  });
}

test('pending authentication and data disable skip and ignore touch, click and keyboard input', async ({ page }) => {
  await boot(page);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
  const media = await video.elementHandle();
  for (const phase of ['authentication', 'data']) {
    if (phase === 'data') await startPlanner(page);
    const button = page.getByRole('button', { name: '起動アニメーション', exact: true });
    await expect(button).toBeDisabled();
    await expect(page.getByRole('button', { name: skipName })).toHaveCount(0);
    await expect(page.locator('.startup-video__hint')).toHaveCount(0);
    // Native pointer input exercises a disabled button without Playwright
    // waiting for it to become enabled and accidentally skipping after ready.
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await button.evaluate(node => node.focus());
    await expect(button).not.toBeFocused();
    for (const key of ['Enter', 'Space', 'Escape']) await page.keyboard.press(key);
    await expect(video).toHaveCount(1);
    expect(await media.evaluate(node => node === document.querySelector('video') && !node.ended)).toBe(true);
    await expect(page.getByRole('status')).toHaveText('アプリを準備しています...');
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
  }
  await readyPlanner(page);
  // Earlier gestures must not be deferred until readiness becomes true.
  expect(await media.evaluate(node => node === document.querySelector('video') && !node.ended)).toBe(true);
  await page.getByRole('button', { name: skipName }).click();
  await expect(page.locator('.home-main')).toBeVisible();
  await expectUnloaded(media);
});

for (const key of ['Enter', 'Space', 'Escape']) {
  test(`keyboard ${key} skips only after the application is ready`, async ({ page }) => {
    await boot(page);
    await expect.poll(() => page.locator('video').evaluate(node => node.currentTime)).toBeGreaterThan(0);
    const media = await page.locator('video').elementHandle();
    await readyPlanner(page);
    const button = page.getByRole('button', { name: skipName });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.splash-screen:visible')).toHaveCount(0);
    await expectUnloaded(media);
  });
}

test('actual video completion keeps the final Laplance frame while data remains pending', async ({ page }) => {
  await boot(page);
  await startPlanner(page);
  await expect.poll(() => page.locator('video').evaluate(node => node.currentTime)).toBeGreaterThan(0);
  await observeEnded(page.locator('video'));
  await expectRealCompletion(page);
  await expectStaticLoading(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  await expect(page.locator('.splash-screen:visible')).toHaveCount(0);
});

test('Pages-style full-body 200 delivery completes the video while startup data remains pending', async ({ page }, testInfo) => {
  const { readFile } = await import('node:fs/promises');
  const clip = await readFile(new globalThis.URL('../../src/assets/laplance_blackhole_1080x1920.mp4', import.meta.url));
  const deliveries = [];
  let ended;
  let rangeProbe;
  await boot(page, 390, async () => {
    await page.route('**/*.mp4*', async route => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.resourceType() === 'script' || url.hostname !== '127.0.0.1') return route.fallback();
      deliveries.push({ url: request.url(), range: request.headers().range ?? null, resourceType: request.resourceType(), status: 200, bytes: clip.length });
      // Match Pages' observed delivery boundary: ignore Range and send the
      // complete original binary with a strong ETag and no Content-Range.
      await route.fulfill({ status: 200, contentType: 'video/mp4',
        headers: { 'Content-Length': String(clip.length), ETag: '"laplans-full-body-fixture"' }, body: clip });
    });
  });
  try {
    await startPlanner(page);
    await expect.poll(() => page.locator('video').evaluate(node => node.currentTime)).toBeGreaterThan(0);
    await observeEnded(page.locator('video'));
    ended = await expectRealCompletion(page);
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every(delivery => delivery.status === 200 && delivery.bytes === 839_108)).toBe(true);
    await expectStaticLoading(page);

    // Linux WebKit can request the native video without a Range header. Test
    // the Range-ignored response independently instead of imposing a transport
    // choice on the decoder whose real completion was asserted above.
    rangeProbe = await page.evaluate(async url => {
      const response = await fetch(url, { headers: { Range: 'bytes=0-63' }, cache: 'no-store' });
      return { status: response.status, type: response.headers.get('content-type'),
        contentRange: response.headers.get('content-range'), size: (await response.arrayBuffer()).byteLength };
    }, deliveries[0].url);
    expect(rangeProbe).toEqual({ status: 200, type: 'video/mp4', contentRange: null, size: 839_108 });
    expect(deliveries.some(delivery => delivery.range === 'bytes=0-63')).toBe(true);
    await expectStaticLoading(page);
  } finally {
    await testInfo.attach('pages-full-body-delivery', { body: Buffer.from(JSON.stringify({ deliveries, ended, rangeProbe }, null, 2)), contentType: 'application/json' });
  }
});

test('ready application preserves the playing video until its real five-second end', async ({ page }) => {
  await boot(page);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
  const media = await video.elementHandle();
  await observeEnded(video);
  await readyPlanner(page);
  const readyTime = await media.evaluate(node => node.currentTime);
  expect(readyTime).toBeLessThan(5);
  expect(await media.evaluate(node => node === document.querySelector('video') && !node.paused && !node.ended)).toBe(true);
  await expect.poll(() => media.evaluate(node => node.currentTime)).toBeGreaterThan(readyTime);
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  await expectRealCompletion(page);
  await expect(page.locator('.home-main')).toBeVisible();
  await expectUnloaded(media);
});

test('standalone App keeps exactly one video after readiness until real completion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new globalThis.URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4174/full-planner-recovery.html');
  const video = page.locator('video');
  await expect(video).toHaveCount(1);
  const media = await video.elementHandle();
  await observeEnded(video);
  await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: skipName })).toBeEnabled();
  await expect(page.locator('.startup-video__hint')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('準備できました');
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  expect(await media.evaluate(node => node === document.querySelector('video') && !node.ended)).toBe(true);
  await expectRealCompletion(page);
  await expect(page.locator('.home-main')).toBeVisible();
  await expectUnloaded(media);
});

test('hidden playback pauses past the stall limit and resumes the same video after readiness', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    // Drive the document boundary consistently on Chromium and WebKit. Native
    // media decoding and pause/resume remain unmodified.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    window.__laplansSetHidden = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
  });
  await boot(page);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
  const media = await video.elementHandle();
  await observeEnded(video);
  await page.evaluate(() => window.__laplansSetHidden(true));
  const pausedTime = await media.evaluate(node => node.currentTime);
  expect(await media.evaluate(node => node.paused)).toBe(true);
  await readyPlanner(page);
  await page.clock.fastForward(5_000);
  await expect(video).toHaveCount(1);
  expect(await media.evaluate(node => ({ same: node === document.querySelector('video'), paused: node.paused, time: node.currentTime })))
    .toEqual({ same: true, paused: true, time: pausedTime });
  expect(await page.evaluate(() => window.__laplansEnded)).toBeUndefined();
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  await page.evaluate(() => window.__laplansSetHidden(false));
  await expect.poll(() => media.evaluate(node => node.currentTime)).toBeGreaterThan(pausedTime);
  expect(await media.evaluate(node => node === document.querySelector('video') && !node.paused)).toBe(true);
  await expect(page.locator('.home-main:visible')).toHaveCount(0);
  await page.getByRole('button', { name: skipName }).tap();
  await expect(page.locator('.home-main')).toBeVisible();
  await expectUnloaded(media);
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
  expect(downloaded).toEqual({ ok: true, type: 'video/mp4', size: 839_108 });
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

test('a failed media request falls back without releasing pending startup data', async ({ page }) => {
  let failedMediaRequests = 0;
  await boot(page, 390, async () => {
    await page.route('**/*.mp4*', route => {
      if (route.request().resourceType() === 'script') return route.fallback();
      failedMediaRequests += 1;
      return route.abort('failed');
    });
  });
  await expectStaticLoading(page);
  expect(failedMediaRequests).toBeGreaterThan(0);
  await startPlanner(page);
  await expectStaticLoading(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
});

test('visible playback with no progress falls back without releasing pending startup data', async ({ page }) => {
  await boot(page);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0);
  const media = await video.elementHandle();
  await observeEnded(video);
  await startPlanner(page);
  await video.evaluate(node => node.pause());
  // The default five-second assertion bounds the existing four-second
  // no-progress fallback; no completion event or readiness is fabricated.
  await expectStaticLoading(page);
  expect(await page.evaluate(() => window.__laplansEnded)).toBeUndefined();
  await expectUnloaded(media);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
});
