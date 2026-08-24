import { expect, test } from '@playwright/test';

function formatIsoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function currentMonthDays() {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();

  for (let day = 2; day <= 20; day += 1) {
    if (new Date(year, monthIndex, day).getDay() !== 1) {
      continue;
    }

    return {
      startDate: formatIsoDate(year, monthIndex, day),
      middleDate: formatIsoDate(year, monthIndex, day + 1),
      endDate: formatIsoDate(year, monthIndex, day + 2),
      outsideDate: formatIsoDate(year, monthIndex, day + 3),
      startDay: day,
      middleDay: day + 1,
      endDay: day + 2,
      outsideDay: day + 3,
    };
  }

  throw new Error('Could not find a Monday in the current month test window.');
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

  test('saves one date range and paints one continuous bar across covered cells', async ({ page }) => {
    const dates = currentMonthDays();
    await seedRangeTestState(page);
    await openSchedule(page);

    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    const startCell = cellForDay(grid, page, dates.startDay);
    await expect(startCell).toBeVisible();
    await startCell.focus();
    await page.keyboard.press('Enter');

    const editorOverlay = page.locator('.month-event-modal-overlay');
    const editor = editorOverlay.locator('.month-event-modal');
    await expect(editor).toBeVisible();
    await editor.getByLabel('タイトル').fill('複数日イベント');

    const startDateButton = editor.getByRole('button', { name: '開始日' });
    const endDateButton = editor.getByRole('button', { name: '終了日' });
    await expect(startDateButton).toContainText(`${dates.startDay}日`);
    await expect(endDateButton).toContainText(`${dates.startDay}日`);

    await endDateButton.click();
    const picker = editorOverlay.locator(':scope > .date-picker-overlay');
    await expect(picker).toBeVisible();
    const endDay = picker
      .locator('.mini-calendar-day:not(.is-outside)')
      .filter({ hasText: new RegExp(`^${dates.endDay}$`) })
      .first();
    await expect(endDay).toBeVisible();
    await endDay.click();

    await expect(picker).toHaveCount(0);
    await expect(startDateButton).toContainText(`${dates.startDay}日`);
    await expect(endDateButton).toContainText(`${dates.endDay}日`);
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

    const rangeBar = cellForDay(grid, page, dates.startDay)
      .locator('.month-range-segment')
      .filter({ hasText: '複数日イベント' });
    await expect(rangeBar).toHaveCount(1);
    await expect(cellForDay(grid, page, dates.outsideDay)).not.toContainText('複数日イベント');

    const middleIndependentPill = cellForDay(grid, page, dates.middleDay)
      .locator('.month-major-event-pill')
      .filter({ hasText: '複数日イベント' });
    const endIndependentPill = cellForDay(grid, page, dates.endDay)
      .locator('.month-major-event-pill')
      .filter({ hasText: '複数日イベント' });
    await expect(middleIndependentPill).toHaveCount(0);
    await expect(endIndependentPill).toHaveCount(0);

    const geometry = await rangeBar.evaluate((element) => {
      const barBox = element.getBoundingClientRect();
      const cell = element.closest('[role="gridcell"]');
      if (!(cell instanceof HTMLElement)) return null;
      const cellBox = cell.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        widthRatio: barBox.width / cellBox.width,
        leftRadius: Number.parseFloat(style.borderTopLeftRadius),
        rightRadius: Number.parseFloat(style.borderTopRightRadius),
        barTop: barBox.top,
        barBottom: barBox.bottom,
        cellTop: cellBox.top,
        cellBottom: cellBox.bottom,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.widthRatio).toBeGreaterThan(2.8);
    expect(geometry.widthRatio).toBeLessThan(3.1);
    expect(geometry.leftRadius).toBeGreaterThan(0);
    expect(geometry.rightRadius).toBeGreaterThan(0);
    expect(geometry.barTop).toBeGreaterThanOrEqual(geometry.cellTop);
    expect(geometry.barBottom).toBeLessThanOrEqual(geometry.cellBottom + 1);
  });
});
