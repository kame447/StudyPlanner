import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

// Issue #696 S2: a save in the month grid is explained in place. A deleted
// event disappears at once and the events that remain glide into the gap it
// leaves; the day's other items do not replay.

const [year, month] = E2E_TODAY.split('-').map(Number);
const day = 14;
const date = `${year}-${String(month).padStart(2, '0')}-${day}`;

async function seed(page, motion) {
  await page.addInitScript(({ date, motion }) => {
    if (localStorage.getItem('reflow-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'reflow-user', email: 'reflow@example.test', username: 'reflow', avatar: '', createdAt: now };
    const event = (id, title, startTime, endTime) => ({ id, userId: user.id, date, endDate: date, title, startTime, endTime,
      repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now });
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('studyplanner.monthEvents', JSON.stringify([
      event('reflow-morning', '朝の模試', '09:00', '10:00'),
      event('reflow-evening', '夕方の塾', '18:00', '19:00'),
    ]));
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('reflow-seeded', 'true');
  }, { date, motion });
  // Record every effect the app starts, keyed by the item it explains.
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__motionLog = [];
    Element.prototype.animate = function animate(frames, options) {
      const key = this.dataset?.motionKey;
      if (key) window.__motionLog.push({ key, first: { ...(Array.isArray(frames) ? frames[0] : {}) } });
      return original.call(this, frames, options);
    };
  });
}

const motionLog = page => page.evaluate(() => window.__motionLog.map(entry => ({
  key: entry.key, properties: Object.keys(entry.first).filter(key => key !== 'offset').sort(), translate: entry.first.translate ?? null,
})));

async function deleteMorningEvent(page) {
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
  const grid = page.getByRole('grid', { name: '月間カレンダー' });
  const cell = grid.locator('[role="gridcell"]').filter({
    has: page.locator('.month-date-number').filter({ hasText: new RegExp(`^${day}$`) }),
  }).first();
  await expect(cell.locator('.month-major-event-pill')).toHaveCount(2);
  await cell.click();
  await page.locator('.month-day-sheet-event').filter({ hasText: '朝の模試' }).click();
  const editor = page.locator('.month-event-modal');
  await expect(editor.getByLabel('タイトル')).toHaveValue('朝の模試');
  await page.evaluate(() => { window.__motionLog.length = 0; });
  page.once('dialog', dialog => dialog.accept());
  await editor.getByRole('button', { name: '削除', exact: true }).click();
  await expect(cell.locator('.month-major-event-pill')).toHaveCount(1);
  return cell;
}

for (const width of [320, 390, 1280]) {
  test(`after a deletion the remaining event glides into the gap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page);
    await page.goto('/');
    const cell = await deleteMorningEvent(page);
    const glides = (await motionLog(page)).filter(entry => entry.key.startsWith(`event:${date}:`) && entry.key.includes('reflow-evening'));
    expect(glides).toHaveLength(1);
    expect(glides[0].properties).toEqual(['translate']);
    const [, y] = glides[0].translate.split(' ').map(Number.parseFloat);
    // It comes from below: it was drawn one row lower before the deletion.
    expect(y).toBeGreaterThan(0);
    // Nothing else in the month replays.
    expect((await motionLog(page)).filter(entry => !entry.key.includes('reflow-evening'))).toEqual([]);
    await expect.poll(() => cell.locator('.month-major-event-pill').evaluate(element => element.getAnimations().length)).toBe(0);
  });
}

for (const level of ['reduced', 'off']) {
  test(`at ${level} the remaining event is simply shown in its new place`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, level);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', level);
    await deleteMorningEvent(page);
    expect((await motionLog(page)).filter(entry => entry.properties.includes('translate'))).toEqual([]);
  });
}
