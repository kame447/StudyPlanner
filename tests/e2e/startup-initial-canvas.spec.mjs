import { expect, test } from './support/startup-ready.mjs';

const GUARD = 'html:not(:has(#root:not(:empty)))';
const DARK_CANVAS = 'rgb(6, 9, 20)';
test.use({ skipStartupVideo: false, reducedMotion: 'no-preference' });

async function seed(page, theme, signedIn = false) {
  await page.addInitScript(({ theme, signedIn, guard }) => {
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('study-planner-appearance', 'standard');
    if (signedIn) {
      const user = { id: 'initial-canvas-owner', email: 'canvas@example.test', username: '起動検証', avatar: '', createdAt: '2026-08-19T00:00:00Z' };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
    }
    // Observe the actual DOM commit; do not substitute playback or readiness.
    window.__initialCanvasSplash = null;
    new MutationObserver(() => {
      const video = document.querySelector('.startup-splash video');
      if (video && !window.__initialCanvasSplash) {
        window.__initialCanvasSplash = {
          guard: document.documentElement.matches(guard),
          html: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
          muted: video.muted,
          inline: video.playsInline,
        };
      }
    }).observe(document, { childList: true, subtree: true });
  }, { theme, signedIn, guard: GUARD });
}

async function canvas(page) {
  return page.evaluate(guard => ({
    guard: document.documentElement.matches(guard),
    empty: document.querySelector('#root')?.matches(':empty'),
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    htmlImage: getComputedStyle(document.documentElement).backgroundImage,
    bodyImage: getComputedStyle(document.body).backgroundImage,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }), GUARD);
}

async function expectInitialCanvas(page) {
  expect(await canvas(page)).toEqual({ guard: true, empty: true,
    html: DARK_CANVAS, body: DARK_CANVAS, htmlImage: 'none', bodyImage: 'none', scheme: 'dark' });
}

async function expectThemeReleased(page, theme) {
  await expect.poll(async () => (await canvas(page)).guard).toBe(false);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  await expect(page.locator('body')).toHaveCSS('color-scheme', theme);
  await expect.poll(async () => (await canvas(page)).htmlImage).not.toBe('none');
  await expect.poll(async () => (await canvas(page)).bodyImage).not.toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`delayed CSS and script keep the canvas dark, then release ${theme} Home at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await seed(page, theme, true);
      let releaseStyles, releaseScripts;
      const styles = new Promise(resolve => { releaseStyles = resolve; });
      const scripts = new Promise(resolve => { releaseScripts = resolve; });
      let requestedStyles = 0, requestedScripts = 0;
      await page.route('**/*', async route => {
        const request = route.request();
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url()).hostname)) return route.abort();
        if (request.resourceType() === 'stylesheet') { requestedStyles++; await styles; }
        if (request.resourceType() === 'script') { requestedScripts++; await scripts; }
        await route.continue();
      });
      try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.locator('#root')).toHaveCount(1);
        await expect.poll(() => requestedStyles).toBeGreaterThan(0);
        await expect.poll(() => requestedScripts).toBeGreaterThan(0);
        expect(await page.evaluate(guard => CSS.supports(`selector(${guard})`), GUARD)).toBe(true);
        // Computed styles before external CSS, including the root canvas when the
        // still-empty body has no stylesheet-provided viewport height.
        await expectInitialCanvas(page);
        releaseStyles();
        await page.waitForFunction(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => link.sheet));
        await expect(page.locator('body')).toHaveCSS('margin', '0px');
        await expectInitialCanvas(page);
        await info.attach(`empty-root-${theme}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
        releaseScripts();
        await expect.poll(() => page.evaluate(() => window.__initialCanvasSplash)).not.toBeNull();
        expect(await page.evaluate(() => window.__initialCanvasSplash)).toEqual({
          guard: false, html: DARK_CANVAS, body: DARK_CANVAS, muted: true, inline: true,
        });
        // Use the existing ready-only gesture. Codec/autoplay fallbacks can also
        // complete normally; full healthy playback remains in the video suite.
        await page.addLocatorHandler(page.getByRole('button', { name: '起動アニメーションをスキップ', exact: true }), async button => { await button.click(); });
        await expect(page.locator('.home-main')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.startup-splash')).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectThemeReleased(page, theme);
        await info.attach(`home-${theme}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
        expect(errors).toEqual([]);
      } finally {
        releaseStyles();
        releaseScripts();
      }
    });
  }
}

for (const theme of ['light', 'dark']) {
  for (const { path, surface } of [
    { path: '/', surface: '.auth-card' },
    { path: '/terms', surface: '.legal-page-card' },
    { path: '/privacy', surface: '.legal-page-card' },
    { path: '/contact', surface: '.legal-page-card' },
    { path: '/admin', surface: '.admin-state-card' },
  ]) {
    test(`direct ${path} releases the empty canvas with stored ${theme}`, async ({ page }) => {
      await seed(page, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await page.goto(path);
      await expect(page.locator(surface)).toBeVisible();
      await expect(page.locator('.startup-splash')).toHaveCount(0);
      // Admin currently owns no persisted theme preference and uses base light.
      await expectThemeReleased(page, path === '/admin' ? 'light' : theme);
      await page.reload();
      await expect(page.locator(surface)).toBeVisible();
      await expectThemeReleased(page, path === '/admin' ? 'light' : theme);
    });
  }
}
