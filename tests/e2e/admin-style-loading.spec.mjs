import { expect, test } from './support/fixed-clock.mjs';

const adminCss = /\/assets\/AdminApp-[^/]+\.css(?:\?.*)?$/;
const widths = [[320, '10px'], [390, '12px'], [600, '12px'], [900, '14px'], [1280, '14px']];

async function navigateInDocument(page, path) {
  await page.evaluate(path => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function hasConsoleRules(page, adminOnly = false) {
  return page.evaluate(adminOnly => {
    const text = rules => [...rules].map(rule => rule.cssText).join('\n');
    return [...document.styleSheets]
      .filter(sheet => !adminOnly || /\/assets\/AdminApp-[^/]+\.css$/.test(new URL(sheet.href || location.href).pathname))
      .some(sheet => text(sheet.cssRules).includes('.admin-console-layout'));
  }, adminOnly);
}

async function publicCardStyle(page) {
  return page.locator('.legal-page-card').evaluate(element => {
    const style = getComputedStyle(element);
    return Object.fromEntries(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderRadius', 'backgroundColor', 'color', 'fontFamily', 'display'].map(key => [key, style[key]]));
  });
}

function holdAdminStyles(page) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = [];
  const install = page.route(adminCss, async route => {
    requests.push(route.request().url());
    await gate;
    await route.continue();
  });
  return { install, release: () => release(), requests };
}

async function expectPendingAdmin(page, held) {
  await expect.poll(() => held.requests.length).toBe(1);
  await expect(page.getByRole('status')).toHaveText('管理者画面を開いています');
  await expect(page.locator('.admin-app-shell')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter(link => /\/assets\/AdminApp-[^/]+\.css$/.test(new URL(link.href).pathname))
    .some(link => link.sheet))).toBe(false);
}

async function expectAdminReady(page) {
  await expect(page.locator('.admin-state-card strong')).toHaveText('ログインが必要です');
  await expect(page.locator('.admin-app-shell')).toBeVisible();
  await expect.poll(() => hasConsoleRules(page, true)).toBe(true);
}

for (const theme of ['light', 'dark']) for (const appearance of ['standard', 'pixel']) {
  test(`production lazy admin CSS preserves panel cascade and normal page: ${theme}/${appearance}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(({ theme, appearance }) => {
      localStorage.setItem('study-planner-theme-mode', theme);
      localStorage.setItem('study-planner-appearance', appearance);
      sessionStorage.setItem('admin-css-document-loads', String(Number(sessionStorage.getItem('admin-css-document-loads') || 0) + 1));
    }, { theme, appearance });
    // This is the ordinary production build, with no real account or remote API.
    await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
    const held = holdAdminStyles(page);
    await held.install;
    try {
      await page.goto('/terms');
      await expect(page.getByRole('heading', { name: '利用規約', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
      if (appearance === 'pixel') {
        await expect(page.locator('.legal-page-card')).toHaveCSS('border-radius', '0px');
        await page.evaluate(() => document.fonts.ready);
      }
      // The root has the final theme color while body is still transitioning.
      // Do not store an intermediate inherited color as the round-trip baseline.
      const settledColor = await page.locator('html').evaluate(element => getComputedStyle(element).color);
      await expect(page.locator('.legal-page-card')).toHaveCSS('color', settledColor);
      const before = await publicCardStyle(page);
      expect(held.requests).toHaveLength(0);
      expect(await hasConsoleRules(page)).toBe(false);
      await navigateInDocument(page, '/admin');
      await expectPendingAdmin(page, held);
      held.release();
      await expectAdminReady(page);
      // The authenticated overview is deliberately not fabricated. These labelled
      // DOM probes use its exact shared class pairs under the real loaded CSS.
      await page.locator('.admin-shell').evaluate(shell => {
        const probes = document.createElement('section');
        probes.id = 'admin-css-probes';
        probes.setAttribute('aria-label', 'CSS probes, not authenticated overview data');
        for (const name of ['metric', 'card', 'alerts']) {
          const element = document.createElement(name === 'alerts' ? 'section' : 'article');
          element.className = `admin-overview-${name} panel`;
          element.dataset.adminCssProbe = name;
          element.textContent = `CSS probe: ${name}`;
          probes.append(element);
        }
        shell.append(probes);
      });
      const observations = [];
      for (const [width, padding] of widths) {
        await page.setViewportSize({ width, height: 844 });
        for (const name of ['metric', 'card', 'alerts']) {
          const probe = page.locator(`[data-admin-css-probe="${name}"]`);
          for (const side of ['top', 'right', 'bottom', 'left']) await expect(probe).toHaveCSS(`padding-${side}`, padding);
        }
        observations.push({ width, padding, classes: ['metric', 'card', 'alerts'] });
        if (width === 390) await info.attach(`admin-css-probes-${theme}-${appearance}`, {
          body: await page.screenshot(), contentType: 'image/png',
        });
      }
      await info.attach('production-admin-css-padding-observations', {
        body: Buffer.from(JSON.stringify({ theme, appearance, observations })), contentType: 'application/json',
      });
      await page.locator('#admin-css-probes').evaluate(element => element.remove());
      await page.setViewportSize({ width: 390, height: 844 });
      await navigateInDocument(page, '/terms');
      await expect(page.getByRole('heading', { name: '利用規約', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
      await expect.poll(() => publicCardStyle(page)).toEqual(before);
      expect(await hasConsoleRules(page, true)).toBe(true);
      expect(await page.evaluate(() => sessionStorage.getItem('admin-css-document-loads'))).toBe('1');
      await navigateInDocument(page, '/admin');
      await expectAdminReady(page);
      expect(held.requests).toHaveLength(1);
    } finally { held.release(); }
  });
}

test('direct production admin entry waits for its real lazy stylesheet', async ({ page }) => {
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  const held = holdAdminStyles(page);
  await held.install;
  try {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expectPendingAdmin(page, held);
    held.release();
    await expectAdminReady(page);
  } finally { held.release(); }
});

for (const resource of ['js', 'css']) {
  test(`production Admin ${resource} delivery failure offers explicit reload and recovers the real guarded entry`, async ({ page }, info) => {
    await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
    await page.addInitScript(() => {
      sessionStorage.setItem('admin-recovery-document-loads', String(Number(sessionStorage.getItem('admin-recovery-document-loads') || 0) + 1));
    });
    const documents = [];
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
    const failedAsset = new RegExp(`/assets/AdminApp-[^/]+\\.${resource}(?:\\?.*)?$`);
    let attempts = 0;
    const failedUrls = new Set();
    const reject = route => {
      attempts += 1; failedUrls.add(route.request().url());
      // A temporary server failure can recover on reload. WebKit's inspector
      // abort retains its blocked module across documents without a new request.
      return route.fulfill({ status: 503, headers: { 'cache-control': 'no-store' },
        contentType: resource === 'js' ? 'application/javascript' : 'text/css', body: '/* temporary delivery failure */' });
    };
    await page.route(failedAsset, reject);
    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert')).toContainText('管理者画面を読み込めませんでした');
    await expect(page.getByRole('button', { name: '通常画面へ戻る', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible();
    await expect(page.locator('.admin-console-layout')).toHaveCount(0);
    expect(documents).toHaveLength(1);
    // Vite's modulepreload and foreground import may each request failed JS.
    expect(failedUrls.size).toBe(1);
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThanOrEqual(resource === 'js' ? 2 : 1);
    const initialAttempts = attempts;
    await info.attach(`admin-${resource}-failure`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => { window.__adminBeforeRecovery = 'old document'; });
    expect(await page.evaluate(() => sessionStorage.getItem('admin-recovery-document-loads'))).toBe('1');
    expect(attempts).toBe(initialAttempts);
    await page.unroute(failedAsset, reject);
    const recoveredAsset = page.waitForResponse(response => failedAsset.test(response.url()) && response.status() === 200);
    await page.getByRole('button', { name: '再読み込み', exact: true }).click();
    await recoveredAsset;
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expectAdminReady(page);
    expect(documents).toHaveLength(2);
    // The fixed clock replaces Performance entries; observe the document itself.
    expect(await page.evaluate(() => sessionStorage.getItem('admin-recovery-document-loads'))).toBe('2');
    expect(await page.evaluate(() => window.__adminBeforeRecovery)).toBeUndefined();
  });
}
