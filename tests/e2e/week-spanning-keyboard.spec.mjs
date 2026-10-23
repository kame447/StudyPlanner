import { E2E_TODAY, expect, newFixedClockContext, test } from './support/fixed-clock.mjs';

for (const width of [390, 1280]) {
  for (const multiDay of [false, true]) {
    test(`week spanning major event native keyboard actions (${width}px, multiDay=${multiDay})`, async ({ browser }) => {
      const context = await newFixedClockContext(browser, { viewport: { width, height: 900 } });
      const page = await context.newPage();
      try {
        await page.addInitScript(({ today, multiDay }) => {
          const now = new Date().toISOString();
          const user = { id: 'spanning-keyboard', email: 'spanning-keyboard@example.com', username: 'keyboard', avatar: '', createdAt: now };
          const event = { id: 'major-event', userId: user.id, date: today, title: 'キーボード行事',
            startTime: '00:00', endTime: '24:00', repeat: 'none', repeatUntil: null, excludedDates: [],
            recurrenceRules: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now };
          if (multiDay) event.endDate = '2026-08-20';
          localStorage.setItem('studyplanner.users', JSON.stringify([user]));
          localStorage.setItem('studyplanner.session', user.id);
          localStorage.setItem('studyplanner.monthEvents', JSON.stringify([event]));
          for (const key of ['plans', 'actuals', 'todos.v1', 'studySubjects.v1', 'studyMaterials.v1']) {
            localStorage.setItem(`studyplanner.${key}`, '[]');
          }
        }, { today: E2E_TODAY, multiDay });
        await page.goto('/');
        await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
        const week = page.getByRole('tab', { name: '週', exact: true });
        if (await week.getAttribute('aria-selected') !== 'true') await week.click();
        const card = page.locator('[data-week-spanning-event="true"]').filter({ hasText: 'キーボード行事' });
        await expect(card).toHaveCount(1);
        await expect(card).toHaveRole('button');
        await expect(card).toHaveAccessibleName('キーボード行事。終日または日を跨ぐ予定。タップまたは長押しで操作');
        // Reach the spanning card by native Tab, not programmatic focus on the card.
        await page.locator('.weekly-draft-preview-date').last().focus();
        await page.keyboard.press('Tab');
        await expect(card).toBeFocused();
        const storedBefore = await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'));
        expect(storedBefore).not.toBeNull();
        expect(JSON.parse(storedBefore)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'month-event:major-event', title: 'キーボード行事' })]));
        const menu = page.getByRole('menu', { name: 'キーボード行事の操作', exact: true });
        for (const key of ['Enter', 'Space', 'ContextMenu', 'Shift+F10']) {
          await expect(card).toBeFocused();
          await page.keyboard.press(key);
          await expect(menu).toBeVisible();
          await expect(menu.getByRole('menuitem')).toHaveCount(6);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
          await expect(card).toBeFocused();
        }
        await expect(page.locator('[role="dialog"]')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toBe(storedBefore);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'))).toHaveLength(0);
      } finally {
        await context.close();
      }
    });
  }
}
