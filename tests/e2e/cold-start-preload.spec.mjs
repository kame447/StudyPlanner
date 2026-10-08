import { expect, test } from '@playwright/test';

// Use a real performance clock (no date-dependent assertions). A fresh Playwright
// context has an empty HTTP cache. Reload reuses that context; record actual
// transfer sizes rather than assuming every response becomes a cache hit.
const OPTIONAL_VIEWS = ['WeekView', 'DayView', 'TodoView', 'ReportView',
  'TimetableView', 'BookshelfView', 'QuickEntryModal', 'TimetableOcrImportDialog'];
const optionalNames = resources => OPTIONAL_VIEWS.filter(name => resources.some(resource =>
  new URL(resource.name).pathname.match(new RegExp(`/assets/${name}-[^/]+\\.js$`))));

async function instrument(page, signedIn) {
  await page.addInitScript(({ signedIn }) => {
    // A controlled idle boundary tests scheduling without a timing-sensitive sleep.
    // This does not mock imports, repositories or the built application.
    let nextId = 0;
    const callbacks = new Map();
    window.requestIdleCallback = callback => {
      callbacks.set(++nextId, callback);
      return nextId;
    };
    window.cancelIdleCallback = id => callbacks.delete(id);
    window.__startupIdle = {
      pending: () => callbacks.size,
      flush: () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 50 });
      },
    };
    if (signedIn && !localStorage.getItem('cold-start-seeded')) {
      const owner = { id: 'cold-start-owner', email: 'startup@example.test',
        username: '起動検証', avatar: '', createdAt: '2026-08-19T00:00:00Z' };
      localStorage.setItem('studyplanner.users', JSON.stringify([owner]));
      localStorage.setItem('studyplanner.session', owner.id);
      localStorage.setItem('cold-start-seeded', 'true');
    }
    const observer = new MutationObserver(() => {
      const target = document.querySelector(signedIn ? '.home-main' : '.auth-card');
      if (target && target.getClientRects().length && getComputedStyle(target).visibility !== 'hidden') {
        performance.mark('startup-visible');
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  }, { signedIn });
}

const snapshot = page => page.evaluate(() => ({
  visible: performance.getEntriesByName('startup-visible').map(entry => entry.startTime),
  navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
  resources: performance.getEntriesByType('resource').map(entry => ({
    name: entry.name, startTime: entry.startTime, duration: entry.duration,
    transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
  })),
  pendingIdle: window.__startupIdle.pending(),
}));

for (const width of [1280, 390]) {
  test(`cold/warm startup defers optional screens until owned Home is ready at ${width}px`, async ({ page, browser }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await instrument(page, false);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '新規会員登録', exact: true })).toBeVisible();
    await expect(page.getByLabel('起動時間の診断')).toHaveCount(0);
    const loggedOut = await snapshot(page);
    expect(loggedOut.pendingIdle).toBe(0);
    expect(optionalNames(loggedOut.resources)).toEqual([]);

    // A second fresh context measures authenticated Home with an empty HTTP cache.
    // Seed only a synthetic local-repository owner; no credentials or cloud data.
    const homeContext = await browser.newContext({ viewport: { width, height: 900 } });
    const homePage = await homeContext.newPage();
    homePage.on('pageerror', error => errors.push(String(error)));
    try {
      await instrument(homePage, true);
      await homePage.goto('http://127.0.0.1:4173/?startupTiming=1');
      await expect(homePage.locator('.home-main')).toBeVisible();
      await expect.poll(() => homePage.evaluate(() => window.__startupIdle.pending())).toBe(1);
      const diagnostics = homePage.getByLabel('起動時間の診断');
      await expect(diagnostics).toBeVisible();
      const timingRows = async () => JSON.parse(await diagnostics.locator('pre').textContent());
      await expect.poll(async () => (await timingRows()).some(row => row.phase === 'home-visible')).toBe(true);
      const diagnosticRows = await timingRows();
      expect(diagnosticRows.length).toBeLessThanOrEqual(80);
      for (const phase of ['profile', 'schedule-snapshot', 'actuals', 'bootstrap', 'home-visible']) {
        expect(diagnosticRows.some(row => row.phase === phase && row.outcome === 'success')).toBe(true);
      }
      // One combined full-load read owns both projections. Retain the
      // startup completion/privacy checks without demanding retired spans.
      expect(diagnosticRows.filter(row => row.phase === 'schedule-snapshot')).toHaveLength(1);
      expect(diagnosticRows.filter(row => ['plans', 'month-events'].includes(row.phase))).toEqual([]);
      for (const row of diagnosticRows) {
        expect(Object.keys(row).sort()).toEqual(['durationMs', 'id', 'outcome', 'phase', 'startMs']);
        expect(Number.isFinite(row.startMs)).toBe(true);
        expect(row.durationMs === null || Number.isFinite(row.durationMs)).toBe(true);
      }
      expect(JSON.stringify(diagnosticRows)).not.toMatch(/startup@example|cold-start-owner|起動検証/);
      const coldHome = await snapshot(homePage);
      expect(coldHome.pendingIdle).toBe(1);
      expect(optionalNames(coldHome.resources)).toEqual([]);
      await homePage.evaluate(() => window.__startupIdle.flush());
      await expect.poll(async () => optionalNames((await snapshot(homePage)).resources)).toEqual(OPTIONAL_VIEWS);
      const afterPreload = await snapshot(homePage);
      expect(coldHome.visible).toHaveLength(1);
      for (const resource of afterPreload.resources.filter(resource => optionalNames([resource]).length)) {
        expect(resource.startTime).toBeGreaterThanOrEqual(coldHome.visible[0]);
      }
      await homePage.getByRole('navigation', { name: '主要ナビゲーション' })
        .getByRole('button', { name: '時間割', exact: true }).click();
      await expect(homePage.locator('.timetable-view')).toBeVisible();

      await homePage.reload();
      await expect(homePage.locator('.home-main')).toBeVisible();
      await expect.poll(() => homePage.evaluate(() => window.__startupIdle.pending())).toBe(1);
      const warmHome = await snapshot(homePage);
      expect(warmHome.pendingIdle).toBe(1);
      expect(optionalNames(warmHome.resources)).toEqual([]);
      await homePage.evaluate(() => window.__startupIdle.flush());
      await expect.poll(async () => optionalNames((await snapshot(homePage)).resources)).toEqual(OPTIONAL_VIEWS);
      const warmAfterPreload = await snapshot(homePage);
      expect(warmHome.visible).toHaveLength(1);
      for (const resource of warmAfterPreload.resources.filter(resource => optionalNames([resource]).length)) {
        expect(resource.startTime).toBeGreaterThanOrEqual(warmHome.visible[0]);
      }
      expect(errors).toEqual([]);
      await testInfo.attach('startup-resource-order-and-timings', {
        body: JSON.stringify({ scope: 'Production bundle, local repository, controlled idle callback. First navigation is cold HTTP cache; authenticated Home uses another cold context; final reload reuses its cache. Transfer sizes document actual hits/revalidation. Not Firebase startup latency or a network-throttled benchmark.',
          width, loggedOut, coldHome, afterPreload, warmHome, warmAfterPreload }, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await homeContext.close();
    }
  });
}
