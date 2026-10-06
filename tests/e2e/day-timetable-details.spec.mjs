import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

async function seed(page) {
  await page.addInitScript(({ date }) => {
    if (localStorage.getItem('day-timetable-detail-seeded')) return;
    const now = new Date().toISOString();
    const base = { userId: 'day-detail-owner', createdAt: now, updatedAt: now };
    const entries = {
      'studyplanner.users': [{ id: base.userId, email: 'day-detail@example.test', username: '日表示検証', avatar: '', createdAt: now }],
      'studyplanner.timetableTerms.v1': [{ ...base, id: 'term', year: 2026, kind: 'fullYear', label: '2026年 通年', isActive: true }],
      'studyplanner.scheduleTemplates.v1': [{ ...base, id: 'template', termId: 'term', weekday: 'wed', startTime: '13:00', endTime: '14:00',
        title: '未取込の授業', subject: '数学', type: 'school-event', periodNumber: 1, classroom: 'A室', memo: '', active: true }],
      'studyplanner.plans': [{ ...base, id: 'plan', seriesId: 'plan', title: '保存済み予定', subject: '英語', type: 'study', date,
        startTime: '15:00', endTime: '16:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '' }],
      'studyplanner.monthEvents': [{ ...base, id: 'event', title: '月予定の対照', date, startTime: '16:00', endTime: '17:00',
        repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [] }],
      'studyplanner.actuals': [], 'studyplanner.timetablePeriods.v1': [],
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('studyplanner.session', base.userId);
    localStorage.setItem('day-timetable-detail-seeded', 'true');
  }, { date: E2E_TODAY });
}
const durable = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
  .filter(key => ['studyplanner.plans', 'studyplanner.monthEvents', 'studyplanner.scheduleEvents.v1',
    'studyplanner.actuals', 'studyplanner.scheduleTemplates.v1', 'studyplanner.timetableTerms.v1'].includes(key))
  .sort().map(key => [key, localStorage.getItem(key)])));

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile timetable tap' : 'desktop timetable click', () => {
    test.use({ viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
    test('unimported class opens read-only details and the timetable route without changing saved data', async ({ page }, testInfo) => {
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await seed(page);
      await page.goto('/');
      const navigation = page.getByRole('navigation', { name: '主要ナビゲーション' });
      await navigation.getByRole('button', { name: '予定', exact: true }).click();
      await page.getByRole('tab', { name: '日', exact: true }).click();
      await expect(page.locator('.schedule-day-month-boundary').filter({ hasText: '9月' })).toHaveText('9月');
      await expect(page.locator('.schedule-day-month-boundary').getByText('ここから', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '2026年 9月1日 火', exact: true }).click();
      await expect(page.locator('.schedule-period-picker-trigger')).toContainText('9月1日');
      await page.getByRole('button', { name: '2026年 8月19日 水', exact: true }).click();
      await expect(page.locator('.schedule-period-picker-trigger')).toContainText('8月19日');
      const card = page.locator('.timeline-plan-block').filter({ hasText: '未取込の授業' });
      await expect(card).toHaveCount(1);
      await expect(page.locator('.timeline-actual-block')).toHaveCount(0);
      const before = await durable(page);
      const open = async () => {
        await card.scrollIntoViewIfNeeded();
        if (mobile) {
          const rect = await card.boundingBox();
          await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
        } else await card.click();
      };
      await open();
      const dialog = page.getByRole('dialog', { name: '未取込の授業の詳細', exact: true });
      await expect(dialog).toBeVisible();
      if (!mobile) {
        await expect(dialog.getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.getByRole('button', { name: '時間割を開く', exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
      }
      await expect(dialog).toContainText('13:00 - 14:00');
      await expect(dialog).toContainText('時間割から表示しています');
      await expect(dialog.getByRole('button', { name: '記録を保存', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '予定を編集', exact: true })).toHaveCount(0);
      // Visibility can become true during the bottom-sheet entrance animation.
      await dialog.evaluate(async element => {
        await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
      });
      const geometry = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const nav = document.querySelector('.primary-bottom-nav').getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, navTop: nav.top, left: rect.left, right: rect.right, width: innerWidth };
      });
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      await page.screenshot({ path: testInfo.outputPath('timetable-day-details.png'), fullPage: false });
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await open();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      if (!mobile) await expect(card).toBeFocused();
      for (const title of ['保存済み予定', '月予定の対照']) {
        await page.locator('.timeline-plan-block').filter({ hasText: title }).click();
        const savedDialog = page.getByRole('dialog', { name: `${title}の操作`, exact: true });
        await expect(savedDialog).toBeVisible();
        await savedDialog.getByRole('button', { name: '閉じる', exact: true }).click();
        await expect(savedDialog).toHaveCount(0);
      }
      await open();
      await dialog.getByRole('button', { name: '時間割を開く', exact: true }).click();
      await expect(page.locator('.timetable-view')).toBeVisible();
      await expect(dialog).toHaveCount(0);
      expect(await durable(page)).toEqual(before);
      expect(errors).toEqual([]);
    });
  });
}
