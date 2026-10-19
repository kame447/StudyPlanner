import { expect, test } from './support/fixed-clock.mjs';
import { test as timingTest } from './support/startup-ready.mjs';

const initialPath = '/?preserved=a%20b&preserved=c+d&startupTransport=forced&startupProfile=off&startupMarker=off#kept';
const startLabel = '起動を計測して再読み込み';
const stopLabel = '計測を終了して再読み込み';

async function openSupport(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const settings = page.getByRole('main', { name: 'アプリ設定' });
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'サポート', exact: true }).click();
  return settings;
}

async function boot(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const read = performance.getEntriesByType.bind(performance);
    window.__startupDeliveryReads = [];
    performance.getEntriesByType = type => {
      if (type === 'navigation' || type === 'resource') window.__startupDeliveryReads.push(type);
      return read(type);
    };
    if (localStorage.getItem('startup-diagnostics-seeded')) return;
    const user = { id: 'startup-diagnostics-owner', email: 'diagnostics@example.test', username: '起動診断', avatar: '', createdAt: '2026-08-19T01:00:00.000Z' };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('startup-diagnostics-seeded', 'true');
    sessionStorage.setItem('startup-diagnostics-context', 'same-existing-context');
  });
  await page.goto(initialPath);
  await expect(page.locator('.home-main')).toBeVisible();
}

const retainedState = page => page.evaluate(() => ({
  owner: localStorage.getItem('studyplanner.session'),
  users: localStorage.getItem('studyplanner.users'),
  plans: localStorage.getItem('studyplanner.plans'),
  context: sessionStorage.getItem('startup-diagnostics-context'),
}));

for (const width of [320, 390, 1280]) {
  test(`ordinary support and query URLs keep developer diagnostics hidden at ${width}px`, async ({ page }, testInfo) => {
    await boot(page, width);
    const before = await retainedState(page);
    const originalUrl = page.url();
    expect(await page.evaluate(() => window.__startupDeliveryReads)).toEqual([]);
    let settings = await openSupport(page);
    await expect(settings.getByRole('button', { name: startLabel, exact: true })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: stopLabel, exact: true })).toHaveCount(0);
    await expect(settings.getByRole('link', { name: 'お問い合わせ', exact: true })).toBeVisible();
    expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach(`ordinary-support-${width}`, { body: await settings.screenshot(), contentType: 'image/png' });
    await page.goto(originalUrl.replace('#kept', '&startupTiming=1#kept'));
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByLabel('起動時間の診断')).toHaveCount(0);
    expect(await page.evaluate(() => window.__startupDeliveryReads)).toEqual([]);
    settings = await openSupport(page);
    await expect(settings.getByRole('button', { name: startLabel, exact: true })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: stopLabel, exact: true })).toHaveCount(0);
    expect(await retainedState(page)).toEqual(before);
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('.home-main')).toBeVisible();
    await page.reload();
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByLabel('起動時間の診断')).toHaveCount(0);
    expect(await page.evaluate(() => window.__startupDeliveryReads)).toEqual([]);
    expect(await retainedState(page)).toEqual(before);
  });
}


// The browser owns all timing entries below. The six inert responses mimic only
// the current built asset names; they are not production startup/PWA benchmarks.
// Keep the performance clock real instead of the date-dependent screen fixture.
const deliveryAssets = [
  ['entry-script', '/assets/index-timing_fixture.js'],
  ['react-vendor', '/assets/vendor-react-timing_fixture.js'],
  ['firebase-vendor', '/assets/vendor-firebase-timing_fixture.js'],
  ['runtime-vendor', '/assets/vendor-runtime-timing_fixture.js'],
  ['icons-vendor', '/assets/vendor-icons-timing_fixture.js'],
  ['entry-styles', '/assets/index-timing_fixture.css'],
];
const privateMarker = 'synthetic-private-startup-marker';

async function bootDeliverySample(page, width, missingRole) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/assets/*timing_fixture*', route => route.fulfill({
    contentType: new URL(route.request().url()).pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
    body: '/* inert startup delivery fixture */',
  }));
  await page.route('**/startup-gates.html?*', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const declarations = deliveryAssets.filter(([role]) => role !== missingRole).map(([, path]) => path.endsWith('.css')
      ? `<link rel="stylesheet" href="${path}">` : `<script src="${path}"></script>`).join('');
    // A query-bearing lookalike is deliberately loaded but must not be projected.
    const privateResource = `<script src="/assets/index-private_timing_fixture.js?owner=${privateMarker}"></script>`;
    await route.fulfill({ response, body: html.replace('</head>', `${declarations}${privateResource}</head>`) });
  });
  await page.goto(`http://127.0.0.1:4174/startup-gates.html?startupTiming=1&privateMarker=${privateMarker}`);
  const panel = page.getByLabel('起動時間の診断', { exact: true });
  await panel.locator('summary').click();
  const delivery = panel.getByLabel('起動配信の診断', { exact: true });
  await expect(delivery).toBeVisible();
  await expect.poll(async () => JSON.parse(await panel.locator('pre').textContent())
    .some(row => row.phase === 'splash-mounted')).toBe(true);
  return { panel, delivery };
}

for (const { width, missingRole } of [
  { width: 390, missingRole: null }, { width: 1280, missingRole: null },
  { width: 390, missingRole: 'icons-vendor' },
]) {
  timingTest(`passive delivery timing renders ${missingRole ? 'an incomplete' : 'a complete'} browser sample at ${width}px`, async ({ page }, testInfo) => {
    const { panel, delivery } = await bootDeliverySample(page, width, missingRole);
    const observed = await page.evaluate(assets => {
      const nav = performance.getEntriesByType('navigation')[0];
      const entries = performance.getEntriesByType('resource');
      return { navigation: { fetchStart: nav.fetchStart, requestStart: nav.requestStart,
        responseStart: nav.responseStart, responseEnd: nav.responseEnd },
      assets: assets.map(([role, path]) => {
        const entry = entries.find(candidate => candidate.name === location.origin + path);
        return { role, timing: entry ? { startTime: entry.startTime, responseEnd: entry.responseEnd,
          transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize } : null };
      }) };
    }, deliveryAssets);
    const phaseRows = JSON.parse(await panel.locator('pre').textContent());
    const splash = phaseRows.find(row => row.phase === 'splash-mounted').startMs;
    const milliseconds = value => `${Math.round(value)} ms`;
    const positiveMs = value => value > 0 ? milliseconds(value) : '不明';
    const byteCount = value => value > 0 ? `${value} B` : '不明';
    await expect(delivery).toContainText(`HTML: 取得開始 ${milliseconds(observed.navigation.fetchStart)} / リクエスト開始 ${positiveMs(observed.navigation.requestStart)} / 応答開始 ${positiveMs(observed.navigation.responseStart)} / 応答完了 ${milliseconds(observed.navigation.responseEnd)}`);
    await expect(delivery.locator('li')).toHaveCount(6);
    for (const { role, timing } of observed.assets) {
      const row = delivery.locator('li').filter({ hasText: `${role}:` });
      if (role === missingRole) {
        expect(timing).toBeNull();
        await expect(row).toContainText('不明');
      } else {
        expect(timing).not.toBeNull();
        expect(timing.responseEnd).toBeLessThanOrEqual(splash);
        await expect(row).toContainText(`開始 ${milliseconds(timing.startTime)} / 応答完了 ${milliseconds(timing.responseEnd)} / 転送 ${byteCount(timing.transferSize)} / 圧縮後 ${byteCount(timing.encodedBodySize)} / 展開後 ${byteCount(timing.decodedBodySize)}`);
      }
    }
    const residual = missingRole ? '不明' : milliseconds(splash - Math.max(observed.navigation.responseEnd,
      ...observed.assets.map(asset => asset.timing.responseEnd)));
    await expect(delivery).toContainText(`受信後からSplashまでの未観測区間（推定）: ${residual}`);
    await expect(delivery).toContainText('CPU時間や初回描画の実測ではありません');
    expect(await panel.textContent()).not.toMatch(/synthetic-private-startup-marker|https?:|startup-gates-owner|startup-gates@example/);
    expect(await delivery.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await testInfo.attach(`passive-delivery-${width}-${missingRole ?? 'complete'}`, {
      body: await panel.screenshot(), contentType: 'image/png',
    });
    await testInfo.attach('passive-delivery-observation', { body: JSON.stringify({
      scope: 'Native browser timing of inert synthetic initial resources in the existing development harness; not production/PWA latency.',
      width, missingRole, observed, splash, residual,
    }, null, 2), contentType: 'application/json' });
  });
}
