import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const OWNER_ID = 'month-timetable-visibility-user';
const DATA_KEYS = [
  'studyplanner.plans',
  'studyplanner.monthEvents',
  'studyplanner.scheduleEvents.v1',
  'studyplanner.scheduleTemplates.v1',
  'studyplanner.timetableTerms.v1',
  'studyplanner.timetablePeriods.v1',
];

async function seedMonthSchedule(page) {
  await page.addInitScript(({ ownerId, date }) => {
    // Reload must exercise persisted settings/data, not reseed over a regression.
    if (localStorage.getItem('month-timetable-visibility-seeded')) return;
    const now = new Date().toISOString();
    const base = { userId: ownerId, createdAt: now, updatedAt: now };
    const term = { ...base, id: 'visibility-term', year: 2026, kind: 'custom',
      label: '表示設定の学期', startDate: '2026-08-01', endDate: '2026-09-30', isActive: true };
    const template = { ...base, id: 'automatic-class', title: '自動表示の授業', subject: '授業',
      type: 'school-event', weekday: 'wed', startTime: '10:00', endTime: '11:00',
      termId: term.id, periodNumber: 1, classroom: '', memo: '', active: true };
    const saved = { ...base, id: 'saved-class', seriesId: 'saved-class', title: '保存した授業',
      subject: '授業', type: 'school-event', sourceType: 'timetable', sourceId: 'imported-class',
      date, startTime: '14:00', endTime: '15:00', repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], memo: '' };
    const entries = {
      'studyplanner.users': [{ id: ownerId, email: 'month-visibility@example.test',
        username: '表示設定テスト', avatar: '', createdAt: now }],
      'studyplanner.plans': [saved, { ...saved, id: 'normal', seriesId: 'normal',
        title: '通常予定', type: 'other', sourceType: 'manual', sourceId: null,
        startTime: '16:00', endTime: '17:00' }],
      'studyplanner.monthEvents': [{ ...base, id: 'month-event', title: '月予定', date,
        startTime: '17:00', endTime: '18:00', repeat: 'none', repeatUntil: null,
        excludedDates: [], url: '', memo: '', checklist: [], locationTags: [] }],
      'studyplanner.scheduleTemplates.v1': [template, { ...template, id: 'imported-class',
        title: '取り込み元の授業', startTime: '14:00', endTime: '15:00', periodNumber: 2 }],
      'studyplanner.timetableTerms.v1': [term],
      'studyplanner.timetablePeriods.v1': [],
      'studyplanner.actuals': [],
      'studyplanner.todos.v1': [],
      'studyplanner.studySubjects.v1': [],
      'studyplanner.studyMaterials.v1': [],
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('studyplanner.session', ownerId);
    localStorage.setItem('month-timetable-visibility-seeded', 'true');
  }, { ownerId: OWNER_ID, date: E2E_TODAY });
}

const rawScheduleData = page => page.evaluate(keys =>
  Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), DATA_KEYS);
const navigateToMonth = page => page.getByRole('navigation', { name: '主要ナビゲーション' })
  .getByRole('button', { name: '予定', exact: true }).click();

async function setMonthTimetableVisibility(page, visible) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const setting = page.getByRole('group', { name: '月カレンダーに時間割を表示', exact: true });
  const choice = setting.getByRole('button', { name: visible ? '表示する' : '表示しない', exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.app-settings-page').getByRole('button', { name: '戻る', exact: true }).click();
}

async function expectDateDetails(page, grid, showAutomatic) {
  const day = String(Number(E2E_TODAY.slice(-2)));
  const cell = grid.locator('[role="gridcell"]:not(.is-muted)').filter({
    has: page.locator('.month-date-number').filter({ hasText: new RegExp(`^${day}$`) }),
  });
  await cell.click();
  const sheet = page.locator('.month-day-sheet');
  await expect(sheet).toBeVisible();
  for (const title of ['保存した授業', '通常予定', '月予定']) await expect(sheet).toContainText(title);
  if (showAutomatic) await expect(sheet).toContainText('自動表示の授業');
  else await expect(sheet).not.toContainText('自動表示の授業');
  // The saved class continues to suppress its corresponding automatic occurrence.
  await expect(sheet).not.toContainText('取り込み元の授業');
  await sheet.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(sheet).toBeHidden();
}

for (const width of [1280, 390]) {
  test(`month timetable preference preserves mixed schedules through navigation and reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedMonthSchedule(page);
    await page.goto('/');
    await navigateToMonth(page);
    const grid = page.getByRole('grid', { name: '月間カレンダー' });
    await expect(grid).toContainText('自動表示の授業');
    await expectDateDetails(page, grid, true);
    // Snapshot after startup migration; changes below are display-only.
    const before = await rawScheduleData(page);
    const period = page.locator('.schedule-period-picker-trigger');
    const initialPeriod = await period.textContent();

    await setMonthTimetableVisibility(page, false);
    await expect(grid).not.toContainText('自動表示の授業');
    await expectDateDetails(page, grid, false);
    await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
    await expect(period).not.toHaveText(initialPeriod);
    await expect(grid).not.toContainText('自動表示の授業');
    await page.getByRole('button', { name: '前の期間へ', exact: true }).click();
    await expect(period).toHaveText(initialPeriod);
    await expectDateDetails(page, grid, false);

    await page.reload();
    await navigateToMonth(page);
    await expect(grid).toBeVisible();
    await expect(grid).not.toContainText('自動表示の授業');
    await expectDateDetails(page, grid, false);
    await expect.poll(() => rawScheduleData(page)).toEqual(before);

    await setMonthTimetableVisibility(page, true);
    await expect(grid).toContainText('自動表示の授業');
    await expectDateDetails(page, grid, true);
    await expect.poll(() => rawScheduleData(page)).toEqual(before);
  });
}
