import { expect, test } from '@playwright/test';

const NOW = new Date('2026-10-08T01:07:00+09:00');
const TODAY = '2026-10-08';

async function seed(page, currentCount) {
  await page.addInitScript(({ count, today, timestamp }) => {
    if (localStorage.getItem('home-today-dates-seeded')) return;
    const user = { id: 'home-today-user', email: 'home-today@example.test', username: 'Home日付検証', avatar: '', createdAt: timestamp };
    const plan = (id, title, date, startTime, endTime) => ({
      id, seriesId: id, userId: user.id, title, subject: '学校行事', type: 'school-event', date,
      startTime, endTime, repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      memo: '', createdAt: timestamp, updatedAt: timestamp,
    });
    const current = [
      plan('today-class', '当日の授業', today, '10:20', '11:50'),
      plan('today-work', '当日の用事', today, '18:00', '20:30'),
    ].slice(0, count);
    const future = [
      plan('future-seminar', '将来の授業A', '2026-10-12', '08:40', '11:50'),
      plan('future-network', '将来の授業B', '2026-10-12', '12:45', '14:15'),
    ];
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([...current, ...future]));
    for (const key of ['studyplanner.actuals', 'studyplanner.monthEvents', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{
      id: 'overdue-todo', userId: user.id, title: '期限を過ぎた課題', subject: '', type: 'study',
      estimatedMinutes: 30, dueDate: '2026-07-10', memo: '', status: 'open', scheduledPlanId: null,
      createdAt: timestamp, updatedAt: timestamp,
    }]));
    localStorage.setItem('home-today-dates-seeded', 'true');
  }, { count: currentCount, today: TODAY, timestamp: NOW.toISOString() });
}

const durableSchedule = page => page.evaluate(() => Object.fromEntries(
  ['studyplanner.plans', 'studyplanner.scheduleEvents.v1', 'studyplanner.todos.v1']
    .map(key => [key, localStorage.getItem(key)]),
));

for (const width of [390, 1280]) {
  test.describe(`Home today-only schedule at ${width}px`, () => {
    test.use({ timezoneId: 'Asia/Tokyo', viewport: { width, height: 900 } });

    for (const count of [0, 2]) {
      test(`keeps October 12 outside October 8 with ${count} today items`, async ({ page }, testInfo) => {
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.clock.setFixedTime(NOW);
        await seed(page, count);
        await page.goto('/');
        const home = page.locator('.home-main');
        const today = home.locator('[data-home-section="today-schedule"]');
        await expect(home).toBeVisible();
        await expect(today.locator('.home-schedule-row')).toHaveCount(count);
        await expect(today).not.toContainText('将来の授業A');
        await expect(today).not.toContainText('将来の授業B');
        await expect(home.locator('[data-home-section="attention"]')).toContainText('期限を過ぎた課題');
        await expect(today.getByRole('button', { name: '今日の予定に追加', exact: true })).toBeVisible();
        if (count > 0) {
          await expect(today.locator('.home-schedule-row strong')).toHaveText(['当日の授業', '当日の用事']);
        }
        const before = await durableSchedule(page);
        await page.screenshot({ path: testInfo.outputPath('home-today-only.png'), fullPage: true });

        await today.getByRole('button', { name: 'すべて見る' }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText('10月8日');
        for (let day = 0; day < 4; day += 1) {
          await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
        }
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText('10月12日');
        await expect(page.locator('.timeline-plan-block').filter({ hasText: '将来の授業A' })).toHaveCount(1);
        await expect(page.locator('.timeline-plan-block').filter({ hasText: '将来の授業B' })).toHaveCount(1);
        const navigation = page.getByRole('navigation', { name: '主要ナビゲーション' });
        await navigation.getByRole('button', { name: 'ホーム', exact: true }).click();
        await expect(home).toBeVisible();
        await expect(today).toBeVisible();
        await expect(today.locator('.home-schedule-row')).toHaveCount(count);
        await page.reload();
        await expect(home).toBeVisible();
        await expect(today).toBeVisible();
        await expect(today.getByRole('button', { name: '今日の予定に追加', exact: true })).toBeVisible();
        await expect(today.locator('.home-schedule-row')).toHaveCount(count);
        expect(await durableSchedule(page)).toEqual(before);
        expect(errors).toEqual([]);
      });
    }
  });
}
