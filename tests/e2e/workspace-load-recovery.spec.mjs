import { expect, test } from './support/fixed-clock.mjs';

const entries = [
  { view: 'Day', message: 'この日の予定を読み込めませんでした。' },
  { view: 'Timetable', message: '時間割を読み込めませんでした。' },
  { view: 'Report', message: '学習レポートを読み込めませんでした。' },
];
const navigation = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
const home = page => navigation(page).getByRole('button', { name: 'ホーム', exact: true });
async function open(page, view) {
  if (view === 'Timetable') await navigation(page).getByRole('button', { name: '時間割', exact: true }).click();
  else if (view === 'Day') await page.locator('.home-today-panel').getByRole('button', { name: /すべて見る/ }).click();
  else await page.getByRole('button', { name: /詳細を見る/ }).click();
}
async function prepare(page) {
  await page.addInitScript(() => {
    // Suppress only optional warming; keep the production foreground imports.
    window.requestIdleCallback = () => 1;
    window.cancelIdleCallback = () => {};
    const user = { id: 'workspace-delivery-owner', email: 'workspace-delivery@example.test', username: 'Delivery fixture', avatar: '', createdAt: '2026-10-17T00:00:00Z' };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['plans', 'actuals', 'todos.v1', 'monthEvents', 'studySubjects.v1', 'studyMaterials.v1', 'scheduleTemplates.v1', 'timetablePeriods.v1', 'timetableTerms.v1']) {
      localStorage.setItem(`studyplanner.${key}`, '[]');
    }
  });
}
const data = page => page.evaluate(() => Object.fromEntries([
  'studyplanner.session', 'studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1',
  'studyplanner.studyMaterials.v1', 'studyplanner.scheduleTemplates.v1', 'studyplanner.timetablePeriods.v1',
].map(key => [key, localStorage.getItem(key)])));

for (const { view, message } of entries) {
  test(`${view} delivery failure keeps Home available through cached reentry`, async ({ page }) => {
    await prepare(page);
    let requests = 0, documents = 0;
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
    await page.route(`**/${view}View-*.js`, route => { requests++; return route.abort('failed'); });
    await page.goto('/');
    await expect(page.locator('.home-main')).toBeVisible();
    const before = await data(page);
    expect(requests).toBe(0);
    for (let visit = 0; visit < 2; visit++) {
      await open(page, view);
      await expect(page.getByRole('alert')).toHaveText(message);
      await expect(home(page)).toBeVisible();
      await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toHaveCount(0);
      await home(page).click();
      await expect(page.locator('.home-main')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(home(page)).toHaveAttribute('aria-current', 'page');
    }
    expect(requests).toBe(1);
    expect(documents).toBe(1);
    expect(await data(page)).toEqual(before);
  });

  test(`late ${view} delivery rejection cannot replace Home after leaving`, async ({ page }) => {
    await prepare(page);
    let release, finish, requests = 0, documents = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const rejected = new Promise(resolve => { finish = resolve; });
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
    await page.route(`**/${view}View-*.js`, async route => { requests++; await pending; await route.abort('failed'); finish(); });
    try {
      await page.goto('/');
      await expect(page.locator('.home-main')).toBeVisible();
      const before = await data(page);
      await open(page, view);
      await expect.poll(() => requests).toBe(1);
      await expect(home(page)).toBeVisible();
      await home(page).click();
      release(); await rejected;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('.home-main')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await open(page, view);
      await expect(page.getByRole('alert')).toHaveText(message);
      await home(page).click();
      await expect(page.locator('.home-main')).toBeVisible();
      expect(requests).toBe(1);
      expect(documents).toBe(1);
      expect(await data(page)).toEqual(before);
    } finally { release(); }
  });
}
