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
        release();
        await expect(skeleton).toHaveCount(0);
        await expect(shell).toBeVisible();
        const after = await shell.boundingBox();
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
      } finally { release(); }
  });
}
