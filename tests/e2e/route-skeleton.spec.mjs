import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const navigation = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
const nav = (page, name) => navigation(page).getByRole('button', { name, exact: true });
async function prepare(page, mode, view) {
  await page.addInitScript(({ mode, view, today }) => {
    window.requestIdleCallback = () => 1;
    window.cancelIdleCallback = () => {};
    const user = { id: 'skeleton-owner', email: 'skeleton@example.test', username: 'Skeleton', avatar: '', createdAt: '2026-10-29T00:00:00Z' };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('study-planner-theme-mode', mode);
    // The report link belongs to the populated Home dashboard, not setup.
    if (view === 'report') {
      localStorage.setItem('studyplanner.plans', JSON.stringify([{
        id: 'skeleton-report-plan', seriesId: 'skeleton-report-plan', userId: user.id,
        title: 'Report fixture plan', subject: 'Math', type: 'study', date: today,
        startTime: '11:00', endTime: '11:30', memo: '', recurrence: null,
        createdAt: user.createdAt, updatedAt: user.createdAt,
      }]));
    }
  }, { mode, view, today: E2E_TODAY });
}
async function open(page, view) {
  if (view === 'month') await nav(page, '予定').click();
  else if (view === 'bookshelf') await nav(page, '教材').click();
  else if (view === 'timetable') await nav(page, '時間割').click();
  else if (view === 'ai-planning') await nav(page, 'AI計画').click();
  else if (view === 'report') {
    await page.locator('.home-progress-panel').getByRole('button', { name: '詳細を見る', exact: true }).click();
  } else {
    await nav(page, '予定').click();
    const label = { week: '週', day: '日', todo: 'Todo' }[view];
    await page.getByRole('tablist', { name: '予定表示' }).getByRole('tab', { name: label, exact: true }).click();
  }
}
const modules = { month: 'MonthView', week: 'WeekView', day: 'DayView', todo: 'TodoView', bookshelf: 'BookshelfView', report: 'ReportView', timetable: 'TimetableView', 'ai-planning': 'AiPlanningView', contact: 'ContactPageContent' };
for (const width of [390, 1280]) for (const mode of ['light', 'dark']) for (const [view, module] of Object.entries(modules)) {
  test(`${view} skeleton keeps its shell and resolves at ${width}px ${mode}`, async ({ page }, testInfo) => {
      // Each test has a cold module and retains the project's browser/device context.
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await prepare(page, mode, view);
      let release;
      const delivery = new Promise(resolve => { release = resolve; });
      await page.route(`**/${module}-*.js`, async route => { await delivery; await route.continue(); });
      try {
        if (view === 'contact') await page.goto('/contact', { waitUntil: 'domcontentloaded' });
        else { await page.goto('/'); await expect(page.locator('.home-main')).toBeVisible(); await open(page, view); }
        const skeleton = page.locator(`.route-skeleton--${view}`);
        await expect(skeleton).toBeVisible();
        await expect(skeleton).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.route-skeleton__status')).toHaveCount(1);
        await expect(skeleton.getByRole('status')).toHaveCount(0);
        await expect(skeleton.locator('button, input, a, textarea')).toHaveCount(0);
        const shell = view === 'contact' ? page.locator('.legal-page-header') : navigation(page);
        const before = await shell.boundingBox();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await skeleton.locator('.route-skeleton__block').first().evaluate(node => ({ animation: getComputedStyle(node).animationName, background: getComputedStyle(node).backgroundColor }))).toEqual({ animation: 'none', background: mode === 'dark' ? 'rgba(225, 240, 236, 0.12)' : 'rgba(31, 43, 43, 0.1)' });
        await testInfo.attach(`${view}-${width}-${mode}`, { body: await page.screenshot(), contentType: 'image/png' });
        if (['bookshelf', 'report', 'timetable'].includes(view)) {
          await page.evaluate(view => {
            const selectors = ['.app-shell', '.primary-app-header', '.app-view-switcher', 'main', ...{
              bookshelf: ['.bookshelf-page-header', '.bookshelf-page-title-row', '.bookshelf-page-header > .bookshelf-category-chips', '.bookshelf-category-filter-row'],
              report: ['.learning-report-header', '.learning-report-summary-grid', '.learning-report-controls', '.learning-report-period-navigation'],
              timetable: ['.timetable-header', '.timetable-grid-shell', '.timetable-grid', '.timetable-weekday-cell', '.timetable-period-cell'],
            }[view]];
            const sample = () => ({ t: performance.now(), loaded: !document.querySelector(`.route-skeleton--${view}`),
              anchors: selectors.map(selector => ({ selector, rects: [...document.querySelectorAll(selector)].map(node => {
                const r = node.getBoundingClientRect(); return { box: node.getClientRects().length > 0, x: r.x, y: r.y, width: r.width, height: r.height };
              }) })) });
            const before = sample(); const frames = []; let frame;
            const tick = () => { frames.push(sample()); frame = requestAnimationFrame(tick); };
            window.__routeFirstFrames = { before, frames, stop: () => cancelAnimationFrame(frame) };
            frame = requestAnimationFrame(tick);
          }, view);
        }
        release();
        await expect(skeleton).toHaveCount(0);
        if (['bookshelf', 'report', 'timetable'].includes(view)) {
          await page.waitForFunction(() => window.__routeFirstFrames.frames.filter(frame => frame.loaded).length >= 8);
          const capture = await page.evaluate(() => {
            window.__routeFirstFrames.stop();
            return { before: window.__routeFirstFrames.before, frames: window.__routeFirstFrames.frames };
          });
          for (const anchor of capture.before.anchors.slice(4)) expect(anchor.rects.length, `${anchor.selector}: reserved anchor exists`).toBeGreaterThan(0);
          const loaded = capture.frames.filter(frame => frame.loaded);
          expect(loaded.length).toBeGreaterThanOrEqual(8);
          for (const frame of loaded) for (let i = 0; i < capture.before.anchors.length; i++) {
            const original = capture.before.anchors[i]; const current = frame.anchors[i];
            expect(current.rects.length, `${original.selector}: anchors stay present`).toBe(original.rects.length);
            // Data-dependent Bookshelf/Report body height is intentionally not fixed.
            const dimensions = view !== 'timetable' && ['.app-shell', 'main'].includes(original.selector)
              ? ['x', 'y', 'width'] : ['x', 'y', 'width', 'height'];
            for (let j = 0; j < original.rects.length; j++) {
              expect(current.rects[j].box, `${original.selector}: visibility`).toBe(original.rects[j].box);
              for (const dimension of dimensions) expect(Math.abs(current.rects[j][dimension] - original.rects[j][dimension]), `${original.selector}[${j}] ${dimension}`).toBeLessThanOrEqual(1);
            }
          }
        }
        await expect(shell).toBeVisible();
        const after = await shell.boundingBox();
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
      } finally {
        release();
        const evidence = await page.evaluate(() => {
          const recorder = window.__routeFirstFrames; if (!recorder) return null;
          recorder.stop(); return { before: recorder.before, frames: recorder.frames };
        }).catch(() => null);
        if (evidence) await testInfo.attach('route-first-visible-frames.json', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
      }
  });
}

for (const width of [390, 1280]) {
  test(`settings reopens on settings in its first visible frame at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await prepare(page, 'light', 'report');
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'メニューを開く', exact: true });
    const settings = page.locator('.app-settings-page');
    await menu.click();
    await settings.getByRole('tab', { name: 'サポート', exact: true }).click();
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await page.evaluate(() => {
      const frames = []; let frame;
      const tick = () => {
        const panel = document.querySelector('.app-settings-content');
        if (panel?.getClientRects().length && panel.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) frames.push({ t: performance.now(), labelledBy: panel.getAttribute('aria-labelledby') });
        frame = requestAnimationFrame(tick);
      };
      window.__settingsFirstFrames = { frames, stop: () => cancelAnimationFrame(frame) };
      frame = requestAnimationFrame(tick);
    });
    try {
      await menu.click();
      await expect(settings).toBeVisible();
      await page.waitForFunction(() => window.__settingsFirstFrames.frames.length >= 8);
      const frames = await page.evaluate(() => window.__settingsFirstFrames.frames);
      expect(frames.length).toBeGreaterThanOrEqual(8);
      expect(frames.every(frame => frame.labelledBy === 'app-settings-tab-settings')).toBe(true);
      await expect(settings.getByRole('tab', { name: '設定', exact: true })).toHaveAttribute('aria-selected', 'true');
    } finally {
      const frames = await page.evaluate(() => { window.__settingsFirstFrames.stop(); return window.__settingsFirstFrames.frames; }).catch(() => null);
      if (frames) await testInfo.attach('settings-first-visible-frames.json', { body: Buffer.from(JSON.stringify(frames)), contentType: 'application/json' });
    }
  });
}
