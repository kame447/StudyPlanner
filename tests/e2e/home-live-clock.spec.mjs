import { expect, test } from '@playwright/test';

async function seed(page, timestamp) {
  await page.addInitScript(({ timestamp }) => {
    if (localStorage.getItem('home-live-clock-seeded')) return;
    const user = { id: 'home-clock-user', email: 'clock@example.test', username: '表示時計', avatar: '', createdAt: timestamp };
    const plan = (id, title, date, startTime, endTime) => ({
      id, seriesId: id, userId: user.id, title, subject: '数学', type: 'study', date, startTime, endTime,
      repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '', createdAt: timestamp, updatedAt: timestamp,
    });
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([
      plan('ending', '17時に終了', '2026-10-07', '16:00', '17:00'),
      plan('evening', '18時の予定', '2026-10-07', '18:00', '19:00'),
      plan('late', '前日の最後', '2026-10-07', '23:00', '24:00'),
      plan('morning', '当日の最初', '2026-10-08', '08:00', '09:00'),
      plan('future', '将来の予定', '2026-10-10', '12:00', '13:00'),
    ]));
    for (const key of ['studyplanner.actuals', 'studyplanner.monthEvents', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('study-planner-home-scene-style', 'pixel');
    localStorage.setItem('study-planner-home-scene-motion', 'false');
    localStorage.setItem('home-live-clock-seeded', '1');
  }, { timestamp });
}
const storedPlans = page => page.evaluate(() => localStorage.getItem('studyplanner.plans'));
const todaySection = page => page.locator('[data-home-section="today-schedule"]');
const nextTitle = page => page.locator('[data-home-section="next-plan"] h1');
const homeButton = page => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'ホーム', exact: true });
const scheduleButton = page => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true });

for (const { zone, offset } of [{ zone: 'Asia/Tokyo', offset: '+09:00' }, { zone: 'America/New_York', offset: '-04:00' }]) {
  for (const width of [390, 1280]) {
    test.describe(`Home live clock ${zone} ${width}px`, () => {
      test.use({ timezoneId: zone, viewport: { width, height: 900 } });
      const instant = local => new Date(`2026-10-${local}${offset}`);

      test('advances next plan and midnight together while retaining the separately selected planner day', async ({ page }, testInfo) => {
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.clock.install({ time: instant('07T16:50:00') });
        await seed(page, instant('07T16:50:00').toISOString());
        await page.goto('/');
        await expect(nextTitle(page)).toHaveText('17時に終了');
        const before = await storedPlans(page);
        await page.clock.pauseAt(instant('07T16:59:59'));
        await page.clock.runFor(1000);
        await expect(nextTitle(page)).toHaveText('18時の予定');
        await expect(page.locator('.home-date-display')).toHaveAttribute('datetime', '2026-10-07');
        await page.clock.resume();

        // Select a different calendar day using the actual navigation, then leave it selected.
        await scheduleButton(page).click();
        await page.getByRole('tab', { name: '日', exact: true }).click();
        for (let count = 0; count < 3; count += 1) await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText('10月10日');
        await homeButton(page).click();
        await expect(nextTitle(page)).toHaveText('18時の予定');
        await page.clock.pauseAt(instant('07T23:59:59'));
        await expect(nextTitle(page)).toHaveText('前日の最後');
        await page.clock.runFor(1000);
        await expect(page.locator('.home-date-display')).toHaveAttribute('datetime', '2026-10-08');
        await expect(nextTitle(page)).toHaveText('当日の最初');
        await expect(todaySection(page).locator('.home-schedule-row strong')).toHaveText(['当日の最初']);
        await expect(todaySection(page)).not.toContainText('将来の予定');
        await page.clock.resume();
        const screenshot = testInfo.outputPath('home-live-clock-midnight.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach('Home after local midnight', { path: screenshot, contentType: 'image/png' });

        await scheduleButton(page).click();
        await page.getByRole('tab', { name: '日', exact: true }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText('10月10日');
        await homeButton(page).click();
        await expect(nextTitle(page)).toHaveText('当日の最初');
        await todaySection(page).getByRole('button', { name: 'すべて見る' }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText('10月8日');
        expect(await storedPlans(page)).toEqual(before);
        expect(errors).toEqual([]);
      });

      test('refreshes real Home components on a simulated hidden/resume lifecycle', async ({ page }) => {
        await page.clock.install({ time: instant('07T23:50:00') });
        await seed(page, instant('07T23:50:00').toISOString());
        await page.goto('/');
        await expect(nextTitle(page)).toHaveText('前日の最後');
        const before = await storedPlans(page);
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.pauseAt(instant('08T08:00:00'));
        await expect(page.locator('.home-date-display')).toHaveAttribute('datetime', '2026-10-07');
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('pageshow'));
        });
        await expect(page.locator('.home-date-display')).toHaveAttribute('datetime', '2026-10-08');
        await expect(nextTitle(page)).toHaveText('当日の最初');
        await expect(todaySection(page).locator('.home-schedule-row strong')).toHaveText(['当日の最初']);
        await expect(page.locator('.home-next-card .home-study-scene')).toHaveAttribute('data-scene-period', 'day');
        await page.clock.resume();
        await todaySection(page).getByRole('button', { name: 'すべて見る' }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText('10月8日');
        expect(await storedPlans(page)).toEqual(before);
      });
    });
  }
}
