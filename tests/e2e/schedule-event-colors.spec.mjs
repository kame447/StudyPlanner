import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const TITLE = '塾バイト';
async function seed(page, theme) {
  await page.addInitScript(({ date, theme, title }) => {
    if (localStorage.getItem('event-colors-seeded')) return;
    const owner = 'event-colors-owner';
    const now = new Date().toISOString();
    const base = { userId: owner, date, endDate: date, repeat: 'weekly', repeatUntil: null,
      excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now };
    const entries = {
      'studyplanner.users': [{ id: owner, email: 'event-colors@example.test', username: '予定色', avatar: '', createdAt: now }],
      'studyplanner.monthEvents': [
        { ...base, id: 'shift-1', title, startTime: '17:00', endTime: '21:30' },
        { ...base, id: 'earlier-event', title: '先の予定', startTime: '15:00', endTime: '16:30' },
      ],
      'studyplanner.plans': [], 'studyplanner.actuals': [], 'studyplanner.todos.v1': [],
      'studyplanner.studySubjects.v1': [], 'studyplanner.studyMaterials.v1': [],
      'studyplanner.scheduleTemplates.v1': [], 'studyplanner.timetableTerms.v1': [],
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('studyplanner.session', owner);
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('event-colors-seeded', 'true');
  }, { date: E2E_TODAY, theme, title: TITLE });
}

async function background(locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate(element => getComputedStyle(element).backgroundColor);
}
async function expectTint(locator, accent) {
  await expect(locator).toBeVisible();
  const paint = await locator.evaluate((element, color) => {
    const reference = document.createElement('span');
    reference.style.background = `color-mix(in srgb, ${color} 24%, var(--surface) 76%)`;
    element.append(reference);
    const expected = getComputedStyle(reference).backgroundColor;
    reference.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  }, accent);
  expect(paint.actual).toBe(paint.expected);
  expect(paint.actual).not.toBe('rgba(0, 0, 0, 0)');
}
const nav = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true });

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test.describe(`saved event color ${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
      test('paints the same event hue across all six surfaces and after reload', async ({ page }, testInfo) => {
        await seed(page, theme);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await nav(page, '予定').click();
        const cell = page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]');
        const pill = cell.locator('.month-major-event-pill').filter({ hasText: TITLE });
        await expect(pill).toBeVisible();
        await cell.click();
        const sheetEntry = page.locator('.month-day-sheet-event').filter({ hasText: TITLE });
        const accent = await background(sheetEntry.locator('.month-day-sheet-bar'));
        expect(accent).not.toBe('rgba(0, 0, 0, 0)');
        await sheetEntry.click();
        const editor = page.locator('.month-event-modal');
        const editorBar = editor.locator('.month-event-timeline-item').filter({ hasText: TITLE }).locator('.month-event-timeline-bar');
        expect(await background(editorBar)).toBe(accent);
        await page.screenshot({ path: testInfo.outputPath('editor-colors.png'), animations: 'disabled' });
        await editor.getByRole('button', { name: '閉じる', exact: true }).click();
        await expectTint(pill, accent);
        await page.screenshot({ path: testInfo.outputPath('month-colors.png'), animations: 'disabled' });
        await page.getByRole('tab', { name: '週', exact: true }).click();
        const weekBlock = page.locator('.schedule-week-block').filter({ hasText: TITLE });
        await expectTint(weekBlock, accent);
        await page.screenshot({ path: testInfo.outputPath('week-colors.png'), animations: 'disabled' });
        await page.getByRole('tab', { name: '日', exact: true }).click();
        const dayBlock = page.locator('.timeline-plan-block').filter({ hasText: TITLE });
        await dayBlock.scrollIntoViewIfNeeded();
        await expectTint(dayBlock, accent);
        await page.screenshot({ path: testInfo.outputPath('day-colors.png'), animations: 'disabled' });
        await nav(page, 'ホーム').click();
        const homeDot = page.locator('.home-schedule-row').filter({ hasText: TITLE }).locator('.home-time-dot');
        await expectTint(homeDot, accent);
        await page.reload();
        await expectTint(homeDot, accent);
        await page.screenshot({ path: testInfo.outputPath('home-colors.png'), animations: 'disabled' });
      });
    });
  }
}

for (const width of [390, 1280]) {
  test.describe(`event editor controls ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
    test('persists explicit color and automatic reset and keeps addon fields', async ({ page }, testInfo) => {
      await seed(page, 'light');
      await page.addInitScript(() => {
        if (localStorage.getItem('editor-controls-single')) return;
        const events = JSON.parse(localStorage.getItem('studyplanner.monthEvents'));
        events.forEach(event => { event.repeat = 'none'; });
        localStorage.setItem('studyplanner.monthEvents', JSON.stringify(events));
        localStorage.setItem('editor-controls-single', 'true');
      });
      const editor = page.locator('.month-event-modal');
      const open = async () => {
        await nav(page, '予定').click();
        await page.getByRole('tab', { name: '月', exact: true }).click();
        await page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]').click();
        await page.locator('.month-day-sheet-event').filter({ hasText: TITLE }).click();
        await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue(TITLE);
      };
      await page.goto('/'); await open();
      await expect(editor.getByRole('button', { name: '追加', exact: true })).toBeVisible();
      await expect(editor.getByRole('button', { name: '自動', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await editor.getByRole('button', { name: '青', exact: true }).click();
      await editor.getByRole('button', { name: /メモ/ }).click();
      await editor.getByLabel('メモ', { exact: true }).fill('色を確認');
      await editor.getByRole('button', { name: /メモ/ }).click();
      await page.screenshot({ path: testInfo.outputPath(`event-editor-controls-${width}.png`), animations: 'disabled' });
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.reload(); await open();
      await expect(editor.getByRole('button', { name: '青', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(editor.getByLabel('メモ', { exact: true })).toHaveValue('色を確認');
      await editor.getByRole('button', { name: '自動', exact: true }).click();
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.reload(); await open();
      await expect(editor.getByRole('button', { name: '自動', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
  });
}

test.describe('calendar swipe navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, contextOptions: { reducedMotion: 'reduce' } });
  test('changes month and week horizontally while ignoring vertical and cancelled gestures', async ({ page }, testInfo) => {
    await seed(page, 'light'); await page.goto('/'); await nav(page, '予定').click();
    const period = page.locator('.schedule-period-picker-trigger');
    const swipe = async (surface, dx, dy, cancel = false) => surface.evaluate((element, { dx, dy, cancel }) => {
      const fire = (type, x, y) => {
        const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
        element.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchstart' || type === 'touchmove' ? [touch] : [], changedTouches: [touch] }));
      };
      fire('touchstart', 190, 250); fire('touchmove', 190 + dx, 250 + dy); fire(cancel ? 'touchcancel' : 'touchend', 190 + dx, 250 + dy);
    }, { dx, dy, cancel });
    for (const [tab, selector] of [['月', '.schedule-month-view'], ['週', '.schedule-week-view']]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const surface = page.locator(selector); const original = await period.innerText();
      await swipe(surface, 10, 120); await expect(period).toHaveText(original);
      await swipe(surface, -120, 0, true); await expect(period).toHaveText(original);
      await swipe(surface, -120, 0); await expect(period).not.toHaveText(original);
      await page.screenshot({ path: testInfo.outputPath(`calendar-swipe-${tab === '月' ? 'month' : 'week'}.png`), animations: 'disabled' });
      await swipe(surface, 120, 0); await expect(period).toHaveText(original);
    }
  });
});
