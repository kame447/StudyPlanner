import { expect, test } from '@playwright/test';

function currentMonthDays() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return {
    startDate: `${year}-${month}-10`,
    middleDate: `${year}-${month}-11`,
    endDate: `${year}-${month}-12`,
    outsideDate: `${year}-${month}-13`,
  };
}

async function seedRangeTestState(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const user = {
      id: 'month-range-user',
      email: 'month-range@example.com',
      username: 'month-range-user',
      avatar: '',
      createdAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.monthEvents', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-month-view')).toBeVisible();
}

function cellForDay(grid, page, day) {
  return grid
    .locator('[role="gridcell"]')
    .filter({
      has: page.locator('.month-date-number').filter({
        hasText: new RegExp(`^${day}$`),
      }),
    })
    .first();
}

test.describe('multi-day month events', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test('saves independent start/end dates and renders every covered day', async ({ page }) => {
    const dates = currentMonthDays();
    await seedRangeTestState(page);
    await openSchedule(page);

    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    const startCell = cellForDay(grid, page, 10);
    await expect(startCell).toBeVisible();
    await startCell.focus();
    await page.keyboard.press('Enter');

    const editorOverlay = page.locator('.month-event-modal-overlay');
    const editor = editorOverlay.locator('.month-event-modal');
    await expect(editor).toBeVisible();
    await editor.getByLabel('タイトル').fill('複数日イベント');

    const startDateButton = editor.getByRole('button', { name: '開始日' });
    const endDateButton = editor.getByRole('button', { name: '終了日' });
    await expect(startDateButton).toContainText('10日');
    await expect(endDateButton).toContainText('10日');

    await endDateButton.click();
    const picker = editorOverlay.locator(':scope > .date-picker-overlay');
    await expect(picker).toBeVisible();
    const endDay = picker
      .locator('.mini-calendar-day:not(.is-outside)')
      .filter({ hasText: /^12$/ })
      .first();
    await expect(endDay).toBeVisible();
    await endDay.click();

    await expect(startDateButton).toContainText('10日');
    await expect(endDateButton).toContainText('12日');
    await editor.getByRole('button', { name: '保存' }).click();

    await expect.poll(() =>
      page.evaluate(() => {
        const items = JSON.parse(localStorage.getItem('studyplanner.monthEvents') ?? '[]');
        const event = items.find((item) => item.title === '複数日イベント');
        return event
          ? {
              date: event.date,
              endDate: event.endDate,
            }
          : null;
      }),
    ).toEqual({ date: dates.startDate, endDate: dates.endDate });

    await expect(editorOverlay).toHaveCount(0, { timeout: 5000 });
    await expect(cellForDay(grid, page, 10)).toContainText('複数日イベント');
    await expect(cellForDay(grid, page, 11)).toContainText('複数日イベント');
    await expect(cellForDay(grid, page, 12)).toContainText('複数日イベント');
    await expect(cellForDay(grid, page, 13)).not.toContainText('複数日イベント');
  });
});
