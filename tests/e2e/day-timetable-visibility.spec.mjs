import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

// Playwright 1.62.1 forwards motion preferences through contextOptions. Keep
// this behavior spec aligned with the intended reduced-motion CI profile.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const OWNER = 'day-occurrence-owner';
async function seed(page) {
  await page.addInitScript(({ date, owner }) => {
    if (localStorage.getItem('day-occurrence-controls-seeded')) return;
    const base = { userId: owner, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const template = { ...base, id: 'class-1', title: '自動表示の授業', subject: '数学', type: 'school-event', weekday: 'wed',
      termId: 'term', periodNumber: 1, startTime: '10:00', endTime: '11:00', memo: '', active: true };
    const plan = { ...base, id: 'recurring-plan', seriesId: 'recurring-plan', title: '毎週の学習', subject: '数学', type: 'study', date,
      startTime: '13:00', endTime: '14:00', repeat: 'weekly', repeatUntil: null, excludedDates: [], recurrenceRules: [], memo: '' };
    const actual = { id: 'plan-actual', userId: owner, planId: plan.id, occurrenceDate: date, actualStartTime: '13:00', actualEndTime: '14:00',
      subject: '数学', note: '残す記録', updatedAt: base.updatedAt };
    const entries = {
      'studyplanner.users': [{ id: owner, email: 'day-occurrence@example.test', username: '日表示', avatar: '', createdAt: base.createdAt }],
      'studyplanner.timetableTerms.v1': [{ ...base, id: 'term', year: 2026, kind: 'fullYear', label: '2026年', isActive: true }],
      'studyplanner.scheduleTemplates.v1': [template, { ...template, id: 'class-2', periodNumber: 2, startTime: '11:00', endTime: '12:00' }],
      'studyplanner.plans': [plan, { ...plan, id: 'imported', seriesId: 'imported', title: '保存済み授業', repeat: 'none', sourceType: 'timetable', sourceId: 'saved-template', startTime: '16:00', endTime: '17:00' }],
      'studyplanner.monthEvents': [{ ...base, id: 'event', title: '毎週の予定', date, startTime: '14:00', endTime: '15:00',
        repeat: 'weekly', repeatUntil: null, excludedDates: [], memo: '', url: '', checklist: [], locationTags: [] }],
      'studyplanner.actuals': [actual, { ...actual, id: 'event-actual', planId: 'event', actualStartTime: '14:00', actualEndTime: '15:00' }],
      'studyplanner.timetablePeriods.v1': [], 'studyplanner.todos.v1': [], 'studyplanner.studySubjects.v1': [], 'studyplanner.studyMaterials.v1': [],
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('studyplanner.session', owner); localStorage.setItem('day-occurrence-controls-seeded', 'true');
  }, { date: E2E_TODAY, owner: OWNER });
}
async function openDay(page) {
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
}
const card = (page, title) => page.locator('.timeline-plan-block').filter({ hasText: title });

const dataKeys = ['studyplanner.scheduleEvents.v1', 'studyplanner.plans', 'studyplanner.monthEvents', 'studyplanner.actuals',
  'studyplanner.scheduleTemplates.v1', 'studyplanner.timetableTerms.v1', 'studyplanner.timetablePeriods.v1'];
const snapshot = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), dataKeys);
async function settings(page) { await page.getByRole('button', { name: 'メニューを開く', exact: true }).click(); }
const group = (page, view) => page.getByRole('group', { name: `${view}カレンダーに時間割を表示`, exact: true });
async function choose(page, view, visible) {
  const choice = group(page, view).getByRole('button', { name: visible ? '表示する' : '表示しない', exact: true });
  await choice.click(); await expect(choice).toHaveAttribute('aria-pressed', 'true');
}
async function closeSettings(page) { await page.locator('.app-settings-page').getByRole('button', { name: '戻る', exact: true }).click(); }
async function expectViewport(page, width) {
  const actual = await page.evaluate(width => ({
    clientWidth: document.documentElement.clientWidth,
    visualWidth: window.visualViewport.width,
    innerWidth: window.innerWidth,
    exactMedia: window.matchMedia(`(width: ${width}px)`).matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }), width);
  expect(actual.clientWidth).toBe(width);
  expect(actual.innerWidth).toBe(width);
  expect(actual.visualWidth).toBeCloseTo(width, 1);
  expect(actual.exactMedia).toBe(true);
  expect(actual.reducedMotion).toBe(true);
}
async function rejectExternalRequests(page, testInfo) {
  const external = [];
  // Block every external HTTP request without proxying the app's own static assets
  // through the test process. An exact origin boundary also rejects lookalike hosts
  // and different ports; the external-attempt assertion remains unchanged.
  const appOrigin = new URL(testInfo.project.use.baseURL).origin;
  const escapedOrigin = appOrigin.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  await page.context().route(new RegExp(`^(?!${escapedOrigin}(?:/|$))https?://`), route => {
    external.push(route.request().url()); return route.abort();
  });
  return external;
}
for (const width of [390, 1280]) {
  test.describe(`initial viewport ${width}px`, () => {
    // Mobile WebKit must receive its viewport at context creation, not after launch.
    test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 } });
    test(`day and month settings persist independently without changing schedules at ${width}px`, async ({ page }, testInfo) => {
      const external = await rejectExternalRequests(page, testInfo);
      await seed(page); await page.goto('/'); await openDay(page);
      await expectViewport(page, width);
      await expect(card(page, '自動表示の授業')).toHaveCount(1);
      const before = await snapshot(page);
      await settings(page);
      await expect(group(page, '日').getByRole('button', { name: '表示する', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await group(page, '日').scrollIntoViewIfNeeded();
      await expectViewport(page, width);
      const settingsBounds = await group(page, '日').boundingBox();
      expect(settingsBounds.x).toBeGreaterThanOrEqual(0);
      expect(settingsBounds.x + settingsBounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`day-settings-${width}.png`), animations: 'disabled' });
      await choose(page, '日', false); await closeSettings(page);
      await expect(card(page, '自動表示の授業')).toHaveCount(0);
      for (const title of ['保存済み授業', '毎週の学習', '毎週の予定']) await expect(card(page, title)).toHaveCount(1);
      await expect(page.locator('.timeline-actual-block')).toHaveCount(2);
      await page.getByRole('tab', { name: '月', exact: true }).click();
      const grid = page.getByRole('grid', { name: '月間カレンダー' });
      await expect(grid).toContainText('自動表示の授業');
      await settings(page); await choose(page, '月', false); await choose(page, '日', true); await closeSettings(page);
      await expect(grid).not.toContainText('自動表示の授業');
      await page.getByRole('tab', { name: '日', exact: true }).click();
      await expect(card(page, '自動表示の授業')).toHaveCount(1);
      await card(page, '自動表示の授業').click();
      const detail = page.getByRole('dialog', { name: '自動表示の授業の詳細', exact: true });
      await expect(detail).toBeVisible();
      await expect(detail.getByRole('button', { name: 'この日だけ削除', exact: true })).toHaveCount(0);
      await detail.getByRole('button', { name: '閉じる', exact: true }).click();
      await page.reload(); await openDay(page);
      await expect(card(page, '自動表示の授業')).toHaveCount(1);
      await page.getByRole('tab', { name: '月', exact: true }).click(); await expect(grid).not.toContainText('自動表示の授業');
      await settings(page);
      await page.evaluate(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('study-planner-day-timetable:')) throw new DOMException('Test write blocked', 'QuotaExceededError');
          return setItem.call(this, key, value);
        };
        window.restoreDayStorage = () => { Storage.prototype.setItem = setItem; };
      });
      await group(page, '日').getByRole('button', { name: '表示しない', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('設定を保存できませんでした');
      await expect(group(page, '日').getByRole('button', { name: '表示する', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(() => window.restoreDayStorage()); await choose(page, '日', false);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await closeSettings(page); await page.getByRole('tab', { name: '日', exact: true }).click();
      await expect(card(page, '自動表示の授業')).toHaveCount(0);
      await page.reload(); await openDay(page); await expect(card(page, '自動表示の授業')).toHaveCount(0);
      expect(await snapshot(page)).toEqual(before); expect(external).toEqual([]);
    });

    test('day visibility stays independent across pixel and standard appearance at ' + width + 'px', async ({ page }, testInfo) => {
      const external = await rejectExternalRequests(page, testInfo);
      await seed(page); await page.goto('/'); await openDay(page);
      await expectViewport(page, width);
      const before = await snapshot(page);
      await settings(page); await choose(page, '日', false);
      await page.getByRole('button', { name: 'ドット', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
      await expect.poll(() => page.locator('#day-timetable-label').evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
      await expect(group(page, '日').getByRole('button', { name: '表示しない', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(group(page, '月').getByRole('button', { name: '表示する', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await group(page, '日').scrollIntoViewIfNeeded(); await expectViewport(page, width);
      const box = await group(page, '日').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.locator('.app-settings-content').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('day-pixel-settings-' + width + '.png'), animations: 'disabled' });
      await closeSettings(page);
      await expect(card(page, '自動表示の授業')).toHaveCount(0);
      await expect(card(page, '保存済み授業')).toHaveCount(1);
      await expect(page.locator('.timeline-actual-block')).toHaveCount(2);
      await page.reload(); await openDay(page);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
      await expect(card(page, '自動表示の授業')).toHaveCount(0);
      await settings(page); await choose(page, '日', true);
      await page.getByRole('button', { name: '標準', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'standard');
      await expect(group(page, '日').getByRole('button', { name: '表示する', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(group(page, '月').getByRole('button', { name: '表示する', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await closeSettings(page);
      await expect(card(page, '自動表示の授業')).toHaveCount(1);
      expect(await snapshot(page)).toEqual(before); expect(external).toEqual([]);
    });
  });
}

test.describe('saved timetable desktop viewport', () => {
  test.use({ viewport: { width: 1280, height: 900 }, screen: { width: 1280, height: 900 } });
  test('saved timetable classes remain draggable with Day auto-display off, including undo and redo', async ({ page }) => {
    await seed(page); await page.goto('/'); await openDay(page);
    await expectViewport(page, 1280);
    // Master projections remain read-only, just as on main.
    await expect(card(page, '自動表示の授業')).not.toHaveClass(/schedule-week-plan-button/);
    await settings(page); await choose(page, '日', false); await closeSettings(page);
    await expect(card(page, '自動表示の授業')).toHaveCount(0);
    const saved = card(page, '保存済み授業'); await saved.scrollIntoViewIfNeeded();
    await expect(saved.locator('.timeline-entry-time')).toHaveText('16:00-17:00');
    const canvas = await page.locator('.timeline-canvas.split').boundingBox();
    const box = await saved.boundingBox();
    expect(canvas).not.toBeNull(); expect(box).not.toBeNull();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y + canvas.height / 24, { steps: 5 }); await page.mouse.up();
    await expect(saved.locator('.timeline-entry-time')).toHaveText('17:00-18:00');
    await page.getByRole('button', { name: '変更を元に戻す' }).click();
    await expect(saved.locator('.timeline-entry-time')).toHaveText('16:00-17:00');
    await page.getByRole('button', { name: '変更をやり直す' }).click();
    await expect(saved.locator('.timeline-entry-time')).toHaveText('17:00-18:00');
    await expect(page.locator('.timeline-actual-block')).toHaveCount(2);
    await page.reload(); await openDay(page);
    await expect(card(page, '保存済み授業').locator('.timeline-entry-time')).toHaveText('17:00-18:00');
    await expect(card(page, '自動表示の授業')).toHaveCount(0);
  });
});
