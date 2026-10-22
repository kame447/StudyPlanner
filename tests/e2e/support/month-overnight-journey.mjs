import { E2E_TODAY, expect } from './fixed-clock.mjs';
import { prepareMonthObservation, observeMonthControl } from './month-overnight-observation.mjs';

export function formatIsoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function currentMonthDays() {
  const [year, month] = E2E_TODAY.split('-').map(Number);
  const monthIndex = month - 1;

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
      repeatedStartDay: day + 7,
      repeatedMiddleDay: day + 8,
      repeatedEndDay: day + 9,
    };
  }

  throw new Error('Could not find a Monday in the current month test window.');
}

export async function seedRangeTestState(page, monthEvents = []) {
  await page.addInitScript(({ seededMonthEvents }) => {
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
    localStorage.setItem('studyplanner.monthEvents', JSON.stringify(seededMonthEvents));
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  }, { seededMonthEvents: monthEvents });
}

export async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-month-view')).toBeVisible();
}

export function cellForDay(grid, page, day) {
  return grid
    .locator('[role="gridcell"]')
    .filter({
      has: page.locator('.month-date-number').filter({
        hasText: new RegExp(`^${day}$`),
      }),
    })
    .first();
}

export async function runMonthOvernightJourney(page, testInfo, width) {
  await prepareMonthObservation(page, testInfo, {
    viewport: { width, height: 900 }, contract: 'overnight-create-edit-reload',
  });
  const dates = currentMonthDays();
  const title = `翌朝までの予定 ${width}`;
  await seedRangeTestState(page);
  await openSchedule(page);
  const grid = page.getByRole('grid', { name: '月間カレンダー' });
  await cellForDay(grid, page, dates.startDay).focus();
  await page.keyboard.press('Enter');
  const overlay = page.locator('.month-event-modal-overlay');
  const editor = overlay.locator('.month-event-modal');
  await editor.getByLabel('タイトル').fill(title);

  async function chooseTime(index, hour, observeEditPicker = false) {
    const input = editor.locator('.month-event-time-input').nth(index);
    if (observeEditPicker) {
      await observeMonthControl(input, testInfo, 'month-edit-end-picker', () => input.click());
    } else await input.click();
    const picker = page.getByRole('dialog', { name: index === 0 ? '開始時刻を選択' : '終了時刻を選択', exact: true });
    await picker.locator('.time-wheel-column').nth(0).getByRole('button', { name: hour, exact: true }).click();
    const minute = picker.locator('.time-wheel-column').nth(1).getByRole('button', { name: '00', exact: true });
    await expect(minute).toBeVisible();
    // Keep the selected minute without repeating its scroll/stability cycle.
    // A different starting minute still needs an ordinary user selection.
    if (!(await minute.getAttribute('class'))?.split(/\s+/).includes('active')) {
      await minute.click();
    }
    await expect(minute).toHaveClass(/\bactive\b/);
    await picker.getByRole('button', { name: '決定', exact: true }).click();
    await expect(editor.locator('.month-event-time-input').nth(index)).toHaveText(`${hour}:00`);
  }
  await chooseTime(0, '18');
  await editor.getByRole('button', { name: '終了日', exact: true }).click();
  const calendar = overlay.locator(':scope > .date-picker-overlay');
  await calendar.locator('.mini-calendar-day:not(.is-outside)')
    .filter({ hasText: new RegExp(`^${dates.middleDay}$`) }).click();
  await expect(calendar).toHaveCount(0);
  await chooseTime(1, '09');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay).toHaveCount(0);

  const read = () => page.evaluate(eventTitle => {
    const records = JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]');
    return records.filter(event => event.title === eventTitle && event.provenance?.legacy?.kind === 'month-event')
      .map(({ id, date, endDate, startTime, endTime }) => ({ id, date, endDate, startTime, endTime }));
  }, title);
  await expect.poll(read).toEqual([expect.objectContaining({
    date: dates.startDate, endDate: dates.middleDate, startTime: '18:00', endTime: '09:00',
  })]);
  const [created] = await read();
  await page.reload();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(read()).resolves.toEqual([created]);
  await cellForDay(grid, page, dates.startDay).click();
  const daySheetEvent = page.locator('.month-day-sheet-event').filter({ hasText: title });
  await observeMonthControl(daySheetEvent, testInfo, 'month-day-sheet-edit', () => daySheetEvent.click());
  await expect(editor.getByLabel('タイトル')).toHaveValue(title);
  await chooseTime(1, '18', true);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect.poll(read).toEqual([{ ...created, endTime: '18:00' }]);
  await page.reload();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect.poll(read).toEqual([{ ...created, endTime: '18:00' }]);
  await expect(cellForDay(grid, page, dates.startDay).locator('.month-range-segment').filter({ hasText: title })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath(`month-event-overnight-${width}.png`), animations: 'disabled' });
}
