import { expect, test } from './support/startup-ready.mjs';

async function prepare(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => {
    // Delay background warming only; the production route/imports remain real.
    window.requestIdleCallback = () => 1;
    window.cancelIdleCallback = () => {};
    const owner = { id: 'month-loading-owner', email: 'month-loading@example.test',
      username: 'Month loading', avatar: '', createdAt: '2026-10-16T00:00:00Z' };
    localStorage.setItem('studyplanner.users', JSON.stringify([owner]));
    localStorage.setItem('studyplanner.session', owner.id);
  });
}
const nav = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true });
async function addSchedule(page) {
  await page.getByRole('button', { name: 'クイック追加メニューを開く', exact: true }).click();
  await page.getByRole('menuitem', { name: '予定を追加', exact: true }).click();
}

for (const width of [390, 1280]) {
  test(`month keeps an add request during chunk delivery at ${width}px`, async ({ page }) => {
    await prepare(page, width);
    let release;
    const delivered = new Promise(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/MonthView-*.js', async route => { requests++; await delivered; await route.continue(); });
    await page.goto('/');
    await expect(page.locator('.home-main')).toBeVisible();
    expect(requests).toBe(0);
    await nav(page, '予定').click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('.schedule-month-view')).toHaveCount(0);
    await addSchedule(page);
    await expect(page.locator('.month-event-modal')).toHaveCount(0);
    release();
    await expect(page.locator('.schedule-month-view')).toBeVisible();
    await expect(page.locator('.month-event-modal')).toBeVisible();
    await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('');
    await page.locator('.month-event-modal').getByRole('button', { name: '閉じる', exact: true }).click();
    await nav(page, 'ホーム').click();
    await expect(page.locator('.home-main')).toBeVisible();
    await nav(page, '予定').click();
    await expect(page.locator('.schedule-month-view')).toBeVisible();
    await expect(page.locator('.month-event-modal')).toHaveCount(0);
    expect(requests).toBe(1);
  });

  test(`month delivery cannot reopen an abandoned view at ${width}px`, async ({ page }) => {
    await prepare(page, width);
    let release;
    const delivered = new Promise(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/MonthView-*.js', async route => { requests++; await delivered; await route.continue(); });
    await page.goto('/');
    await expect(page.locator('.home-main')).toBeVisible();
    await nav(page, '予定').click();
    await expect.poll(() => requests).toBe(1);
    await addSchedule(page);
    await nav(page, 'ホーム').click();
    release();
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.schedule-month-view')).toHaveCount(0);
    await expect(page.locator('.month-event-modal')).toHaveCount(0);
    await nav(page, '予定').click();
    await expect(page.locator('.schedule-month-view')).toBeVisible();
    await expect(page.locator('.month-event-modal')).toHaveCount(0);
  });

  test(`month chunk failure retains Home navigation at ${width}px`, async ({ page }) => {
    await prepare(page, width);
    await page.route('**/MonthView-*.js', route => route.abort('failed'));
    await page.goto('/');
    await expect(page.locator('.home-main')).toBeVisible();
    await nav(page, '予定').click();
    await expect(page.getByRole('alert')).toHaveText('月の予定を読み込めませんでした。');
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toHaveCount(0);
    await nav(page, 'ホーム').click();
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
