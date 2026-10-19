import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';
import { prepareMonthObservation, observeMonthControl, attachMonthObservation } from './support/month-overnight-observation.mjs';

function formatIsoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function currentMonthDays() {
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

async function seedRangeTestState(page, monthEvents = []) {
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

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-month-view')).toBeVisible();
}

async function readCanonicalMonthEventRange(page, title) {
  return page.evaluate((eventTitle) => {
    const items = JSON.parse(
      localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]',
    );
    const event = items.find(
      (item) =>
        item.title === eventTitle &&
        item.provenance?.legacy?.kind === 'month-event',
    );
    return event
      ? {
          date: event.date,
          endDate: event.endDate,
        }
      : null;
  }, title);
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

async function readRangeGeometry(rangeBar) {
  return rangeBar.evaluate((element) => {
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
}

function expectThreeDayRangeGeometry(geometry) {
  expect(geometry).not.toBeNull();
  expect(geometry.widthRatio).toBeGreaterThan(2.8);
  expect(geometry.widthRatio).toBeLessThan(3.1);
  expect(geometry.leftRadius).toBeGreaterThan(0);
  expect(geometry.rightRadius).toBeGreaterThan(0);
  expect(geometry.barTop).toBeGreaterThanOrEqual(geometry.cellTop);
  expect(geometry.barBottom).toBeLessThanOrEqual(geometry.cellBottom + 1);
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
      readCanonicalMonthEventRange(page, '複数日イベント'),
    ).toEqual({ date: dates.startDate, endDate: dates.endDate });

    const legacyContainsNewEvent = await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('studyplanner.monthEvents') ?? '[]');
      return items.some((item) => item.title === '複数日イベント');
    });
    expect(legacyContainsNewEvent).toBe(false);

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

    expectThreeDayRangeGeometry(await readRangeGeometry(rangeBar));
  });

  test('editing an event into another month keeps selection, keyboard navigation and views aligned', async ({ page }) => {
    const dates = currentMonthDays();
    const [year, month] = dates.startDate.split('-').map(Number);
    const nextMonth = new Date(year, month, dates.startDay);
    const targetDate = formatIsoDate(nextMonth.getFullYear(), nextMonth.getMonth(), dates.startDay);
    const title = '別月へ移動する予定';
    const now = new Date().toISOString();
    await seedRangeTestState(page, [{
      id: 'moved-month-event', userId: 'month-range-user', date: dates.startDate, endDate: dates.startDate,
      title, startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
      excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now,
    }]);
    await openSchedule(page);
    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    await cellForDay(grid, page, dates.startDay).click();
    await page.locator('.month-day-sheet-event').filter({ hasText: title }).click();
    const editorOverlay = page.locator('.month-event-modal-overlay');
    const editor = editorOverlay.locator('.month-event-modal');
    await expect(editor.getByLabel('タイトル')).toHaveValue(title);
    await editor.getByRole('button', { name: '開始日' }).click();
    const picker = editorOverlay.locator(':scope > .date-picker-overlay');
    await picker.getByRole('button', { name: '翌月', exact: true }).click();
    await picker.locator('.mini-calendar-day:not(.is-outside)')
      .filter({ hasText: new RegExp(`^${dates.startDay}$`) }).click();
    await expect(picker).toHaveCount(0);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editorOverlay).toHaveCount(0);
    await expect.poll(() => readCanonicalMonthEventRange(page, title))
      .toEqual({ date: targetDate, endDate: targetDate });

    const heading = page.locator('.schedule-period-picker-trigger');
    const targetMonthLabel = `${nextMonth.getFullYear()}年 ${nextMonth.getMonth() + 1}月`;
    await expect(heading).toContainText(targetMonthLabel.replace('年 ', '年'));
    const selected = grid.locator('[role="gridcell"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(grid.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    await expect(selected.locator('.month-date-number')).toHaveText(String(dates.startDay));
    await selected.focus();
    await page.keyboard.press('ArrowRight');
    await expect(selected.locator('.month-date-number')).toHaveText(String(dates.startDay + 1));
    await expect(selected).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(selected.locator('.month-date-number')).toHaveText(String(dates.startDay));
    await expect(selected).toBeFocused();
    await page.getByRole('tab', { name: '日', exact: true }).click();
    await expect(heading).toContainText(`${targetMonthLabel}${dates.startDay}日`);
    // The event also names its accent in the legend. Verify the actual event
    // control, not an unscoped text match that can resolve to either surface.
    const dayEvent = page.locator('.timeline-plan-block').filter({ hasText: title });
    await expect(dayEvent).toHaveCount(1);
    await expect(dayEvent.getByText(title, { exact: true })).toBeVisible();
    await expect(dayEvent).toHaveAttribute('aria-label', new RegExp(`${title}、09:00から10:00`));
    await page.getByRole('tab', { name: '週', exact: true }).click();
    await expect(heading).toContainText(targetMonthLabel);
    await expect(page.locator('.schedule-week-view').getByText(title, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '月', exact: true }).click();
    await expect(selected).toHaveCount(1);
    await expect(selected.locator('.month-date-number')).toHaveText(String(dates.startDay));
  });

  for (const action of ['edit-single', 'edit-future', 'single-delete', 'future-delete']) {
    test(`keeps October visible after ${action} of a May-anchored recurring event`, async ({ page }, testInfo) => {
      const title = '5月開始の繰り返し予定';
      const now = new Date().toISOString();
      await seedRangeTestState(page, [{
        id: 'recurring-navigation-event', userId: 'month-range-user', date: '2026-05-15', endDate: '2026-05-15',
        title, startTime: '09:00', endTime: '10:00', repeat: 'monthly', repeatUntil: null,
        excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now,
      }]);
      await openSchedule(page);
      // The shared browser clock starts in August. Navigate through the real toolbar.
      await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
      await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
      const heading = page.locator('.schedule-period-picker-trigger');
      await expect(heading).toContainText('2026年10月');
      const grid = page.getByRole('grid', { name: '月間カレンダー' });
      await cellForDay(grid, page, 15).click();
      await page.locator('.month-day-sheet-event').filter({ hasText: title }).click();
      const overlay = page.locator('.month-event-modal-overlay');
      const editor = overlay.locator('.month-event-modal');
      await expect(editor.getByRole('button', { name: '開始日', exact: true })).toContainText('2026年10月15日');
      if (action.startsWith('edit-')) {
        await editor.getByLabel('タイトル', { exact: true }).fill('10月で編集した繰り返し予定');
        const before = await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'));
        await editor.getByRole('button', { name: '保存', exact: true }).click();
        const scope = editor.getByRole('group', { name: '繰り返し予定の更新範囲' });
        await expect(scope).toBeVisible();
        const originalViewport = page.viewportSize();
        for (const layout of [
          { width: 320, height: 568, textScale: '100%' },
          { width: 812, height: 375, textScale: '200%' },
          { width: 1280, height: 720, textScale: '100%' },
        ]) {
          await page.setViewportSize({ width: layout.width, height: layout.height });
          await page.evaluate(scale => { document.documentElement.style.fontSize = scale; }, layout.textScale);
          await expect.poll(() => editor.evaluate(element => {
            const prompt = element.querySelector('.month-event-edit-scope').getBoundingClientRect();
            const body = element.querySelector('.month-event-editor-body').getBoundingClientRect();
            return body.top - prompt.bottom;
          })).toBeGreaterThanOrEqual(0);
          for (const name of ['この予定だけ変更', 'これ以降も全部変更', 'キャンセル']) {
            const button = scope.getByRole('button', { name, exact: true });
            await button.scrollIntoViewIfNeeded();
            await expect(button).toBeInViewport();
            // Normal hit-testing must succeed even though the input fieldset is disabled.
            await button.click({ trial: true });
          }
          await page.screenshot({ path: testInfo.outputPath(`recurring-event-${action}-scope-${layout.width}-${layout.textScale}.png`) });
        }
        await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
        await page.setViewportSize(originalViewport);
        await page.screenshot({ path: testInfo.outputPath(`recurring-event-${action}-scope-confirmation.png`) });
        expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toBe(before);
        await scope.getByRole('button', { name: 'キャンセル', exact: true }).click();
        expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toBe(before);
        await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('10月で編集した繰り返し予定');
        await editor.getByRole('button', { name: '保存', exact: true }).click();
        await scope.getByRole('button', { name: action === 'edit-single' ? 'この予定だけ変更' : 'これ以降も全部変更', exact: true }).click();
      } else {
        await editor.getByRole('button', { name: '削除', exact: true }).click();
        await editor.getByRole('button', {
          name: action === 'single-delete' ? 'この予定だけ削除' : 'これ以降も全部削除', exact: true,
        }).click();
      }
      await expect(overlay).toHaveCount(0);
      await expect(heading).toContainText('2026年10月');
      const selected = grid.locator('[role="gridcell"][aria-selected="true"]');
      await expect(selected).toHaveCount(1);
      await expect(selected.locator('.month-date-number')).toHaveText('15');
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]')
        .find(item => item.provenance?.legacy?.kind === 'month-event'));
      expect(stored).toMatchObject({ date: '2026-05-15', endDate: '2026-05-15' });
      if (action.startsWith('edit-')) {
        expect(stored.title).toBe(title);
        const created = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]')
          .find(item => item.title === '10月で編集した繰り返し予定'));
        expect(created).toMatchObject({ date: '2026-10-15', endDate: '2026-10-15',
          recurrence: { repeat: action === 'edit-single' ? 'none' : 'monthly' } });
        if (action === 'edit-single') expect(stored.recurrence.excludedDates).toContain('2026-10-15');
        else expect(stored.recurrence.repeatUntil).toBe('2026-09-15');
        await expect(selected).toContainText('10月で編集した繰り返し予定');
        await page.screenshot({ path: testInfo.outputPath(`recurring-event-${action}-october-preserved.png`) });
      } else if (action === 'single-delete') {
        expect(stored.recurrence.excludedDates).toContain('2026-10-15');
      } else {
        expect(stored.recurrence.repeatUntil).toBe('2026-09-15');
      }
    });
  }

  test('keeps new and edited event input after save failure and allows retry', async ({ page }) => {
    const dates = currentMonthDays();
    await seedRangeTestState(page);
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      window.__monthEventSaveFailures = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'studyplanner.scheduleEvents.v1' && window.__monthEventSaveFailures > 0) {
          window.__monthEventSaveFailures -= 1;
          throw new DOMException('Fixture storage failure', 'QuotaExceededError');
        }
        return setItem.call(this, key, value);
      };
    });
    await openSchedule(page);
    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    await cellForDay(grid, page, dates.startDay).focus();
    await page.keyboard.press('Enter');
    const editorOverlay = page.locator('.month-event-modal-overlay');
    const editor = editorOverlay.locator('.month-event-modal');
    async function waitForEditorEntrance() {
      await expect(editor).toBeVisible();
      await editor.evaluate(async (element) => {
        const motion = element.closest('.month-event-dialog-motion');
        if (!(motion instanceof HTMLElement)) throw new Error('Month event motion root is missing');
        const entranceAnimations = motion.getAnimations({ subtree: true })
          .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
        await Promise.all(entranceAnimations.map(animation => animation.finished.catch(() => undefined)));
      });
    }
    // Storage recovery is the subject here; click only after the real entrance finishes.
    await waitForEditorEntrance();
    const title = '失敗しても残す予定';
    await editor.getByLabel('タイトル').fill(title);
    await page.evaluate(() => { window.__monthEventSaveFailures = 1; });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__monthEventSaveFailures)).toBe(0);
    await expect(editor.getByRole('alert')).toContainText('もう一度保存');
    await expect(editor.getByLabel('タイトル')).toHaveValue(title);
    await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await expect.poll(() => readCanonicalMonthEventRange(page, title)).toBeNull();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editorOverlay).toHaveCount(0);
    await expect.poll(() => readCanonicalMonthEventRange(page, title))
      .toEqual({ date: dates.startDate, endDate: dates.startDate });

    await cellForDay(grid, page, dates.startDay).click();
    await page.locator('.month-day-sheet-event').filter({ hasText: title }).click();
    await waitForEditorEntrance();
    const editedTitle = '編集も残す予定';
    await editor.getByLabel('タイトル').fill(editedTitle);
    await page.evaluate(() => { window.__monthEventSaveFailures = 1; });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__monthEventSaveFailures)).toBe(0);
    await expect(editor.getByRole('alert')).toContainText('もう一度保存');
    await expect(editor.getByLabel('タイトル')).toHaveValue(editedTitle);
    await expect.poll(() => readCanonicalMonthEventRange(page, title))
      .toEqual({ date: dates.startDate, endDate: dates.startDate });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editorOverlay).toHaveCount(0);
    await expect.poll(() => readCanonicalMonthEventRange(page, editedTitle))
      .toEqual({ date: dates.startDate, endDate: dates.startDate });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]').length)).toBe(1);
  });

  test('repeated multi-day occurrences stay continuous instead of falling back to daily pills', async ({ page }, testInfo) => {
    const dates = currentMonthDays();
    const now = new Date().toISOString();
    const recurringEvent = {
      id: 'recurring-range-event',
      userId: 'month-range-user',
      date: dates.startDate,
      endDate: dates.endDate,
      title: '毎週の合宿',
      startTime: '09:00',
      endTime: '18:00',
      repeat: 'weekly',
      repeatUntil: null,
      excludedDates: [],
      url: '',
      memo: '',
      checklist: [],
      locationTags: [],
      createdAt: now,
      updatedAt: now,
    };

    await seedRangeTestState(page, [recurringEvent]);
    await openSchedule(page);

    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    const repeatedStartCell = cellForDay(grid, page, dates.repeatedStartDay);
    const repeatedRangeBar = repeatedStartCell
      .locator('.month-range-segment')
      .filter({ hasText: '毎週の合宿' });

    await expect(repeatedRangeBar).toHaveCount(1);
    await expect(
      cellForDay(grid, page, dates.repeatedMiddleDay)
        .locator('.month-major-event-pill')
        .filter({ hasText: '毎週の合宿' }),
    ).toHaveCount(0);
    await expect(
      cellForDay(grid, page, dates.repeatedEndDay)
        .locator('.month-major-event-pill')
        .filter({ hasText: '毎週の合宿' }),
    ).toHaveCount(0);

    expectThreeDayRangeGeometry(await readRangeGeometry(repeatedRangeBar));

    await page.screenshot({
      path: testInfo.outputPath('recurring-multi-day-range.png'),
      fullPage: true,
    });
  });
});


for (const width of [390, 1280]) {
  test.describe(`midnight event boundary ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 } });

    test('midnight-ended events survive editor save and reload without spilling into the next day', async ({ page }, testInfo) => {
      const dates = currentMonthDays();
      const now = new Date().toISOString();
      const title = '深夜0時までの予定';
      const updatedTitle = '深夜0時までの予定（確認済み）';
      const controlTitles = ['24時終了の対照', '翌日0時終了の対照'];
      const base = {
        userId: 'month-range-user', date: dates.startDate, endDate: dates.startDate,
        startTime: '23:00', endTime: '00:00', repeat: 'none', repeatUntil: null,
        excludedDates: [], url: '', memo: '', checklist: [], locationTags: [],
        createdAt: now, updatedAt: now,
      };
      await seedRangeTestState(page, [
        { ...base, id: 'midnight-same-date', title },
        { ...base, id: 'midnight-24-control', title: controlTitles[0], endTime: '24:00' },
        { ...base, id: 'midnight-next-date-control', title: controlTitles[1], endDate: dates.middleDate },
      ]);
      const externalRequests = [];
      const origin = new URL(testInfo.project.use.baseURL).origin;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
          externalRequests.push(url.origin);
          return route.abort();
        }
        return route.continue();
      });
      const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
      await openSchedule(page);
      const grid = page.getByRole('grid', { name: '月間カレンダー' });
      await expect.poll(async () => (await stored()).length).toBe(3);
      const initial = await stored();
      const original = initial.find(event => event.title === title);
      expect(original).toMatchObject({ date: dates.startDate, endDate: dates.startDate, startTime: '23:00', endTime: '00:00' });
      await cellForDay(grid, page, dates.startDay).click();
      await page.locator('.month-day-sheet-event').filter({ hasText: title }).click();
      const editor = page.locator('.month-event-modal');
      await expect(editor.getByLabel('タイトル')).toHaveValue(title);
      await editor.getByLabel('タイトル').fill(updatedTitle);
      expect(await stored()).toEqual(initial);
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect.poll(async () => (await stored()).find(event => event.id === original.id)?.title).toBe(updatedTitle);
      const saved = await stored();
      expect(saved).toHaveLength(3);
      expect(saved.find(event => event.id === original.id)).toMatchObject({
        id: original.id, title: updatedTitle, date: dates.startDate, endDate: dates.startDate,
        startTime: '23:00', endTime: '00:00',
      });
      expect(saved.filter(event => event.id !== original.id)).toEqual(initial.filter(event => event.id !== original.id));

      for (const phase of ['saved', 'reloaded']) {
        if (phase === 'reloaded') {
          await page.reload();
          await openSchedule(page);
          await cellForDay(grid, page, dates.startDay).focus();
          await page.keyboard.press('ArrowRight');
          await page.keyboard.press('ArrowLeft');
        }
        await page.getByRole('tab', { name: '週', exact: true }).click();
        const week = page.locator('.schedule-week-view');
        for (const name of [updatedTitle, ...controlTitles]) {
          const block = week.locator('[data-week-spanning-event]').filter({ hasText: name });
          await expect(block).toHaveCount(1);
          await expect(block).toHaveAttribute('title', `${name} / ${dates.startDate} 23:00 - ${dates.middleDate} 00:00`);
          expect(await block.evaluate(element => element.style.gridColumn)).toBe('2 / 3');
        }
        const image = testInfo.outputPath(`midnight-week-${phase}-${width}.png`);
        await page.screenshot({ path: image, fullPage: true });
        await testInfo.attach(`midnight-week-${phase}-${width}`, { path: image, contentType: 'image/png' });
        await page.getByRole('tab', { name: '日', exact: true }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText(`${Number(E2E_TODAY.slice(5, 7))}月${dates.startDay}日`);
        for (const name of [updatedTitle, ...controlTitles]) {
          await expect(page.locator('[data-day-spanning-events] [data-schedule-occurrence-id], .timeline-plan-block').filter({ hasText: name })).toHaveCount(1);
        }
        await page.getByRole('tab', { name: '月', exact: true }).click();
        await cellForDay(grid, page, dates.middleDay).focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await page.getByRole('tab', { name: '日', exact: true }).click();
        await expect(page.locator('.schedule-period-picker-trigger')).toContainText(`${Number(E2E_TODAY.slice(5, 7))}月${dates.middleDay}日`);
        for (const name of [updatedTitle, ...controlTitles]) {
          await expect(page.locator('[data-day-spanning-events] [data-schedule-occurrence-id], .timeline-plan-block').filter({ hasText: name })).toHaveCount(0);
        }
        expect(await stored()).toEqual(saved);
      }
      expect(externalRequests).toEqual([]);
    });
  });
}

for (const width of [390, 1280]) {
  test.describe(`overnight month-event persistence at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 }, reducedMotion: 'reduce' });
    test.afterEach(async ({}, testInfo) => { await attachMonthObservation(testInfo); });
    test('creates, edits and reloads a range with an earlier end clock', async ({ page }, testInfo) => {
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
    });
  });
}
