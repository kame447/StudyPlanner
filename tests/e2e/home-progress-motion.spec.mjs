import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

// Issue #696 S4: when a study record is saved while Home stays open, only
// what changed reacts: the plan's completion dot, the bars whose height
// changed, and the week ring sweeping to its new value. Home's measured row
// and card boxes never move. The first paint stays still.

async function seed(page, motion) {
  await page.addInitScript(({ date, motion }) => {
    if (localStorage.getItem('home-motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'home-motion-user', email: 'home-motion@example.test', username: 'Study', avatar: '', createdAt: now };
    const plan = { id: 'home-plan', seriesId: 'home-plan', userId: user.id, title: '予定の学習', subject: '数学', type: 'study', date,
      startTime: '11:00', endTime: '12:00', memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      sourceType: 'manual', createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('home-motion-seeded', 'true');
  }, { date: E2E_TODAY, motion });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__motionLog = [];
    Element.prototype.animate = function animate(frames, options) {
      const key = this.dataset?.motionKey ?? this.dataset?.barKey;
      if (key) window.__motionLog.push({ key, properties: Object.keys((Array.isArray(frames) ? frames[0] : {}) ?? {}).filter(name => name !== 'offset').sort() });
      return original.call(this, frames, options);
    };
  });
}

const motionLog = page => page.evaluate(() => window.__motionLog.splice(0));
const ringTransition = page => page.locator('.weekly-progress-ring').evaluate(element =>
  element.getAnimations().filter(animation => animation.transitionProperty === '--weekly-progress').length);

async function recordPlannedStudy(page) {
  await page.getByRole('button', { name: /勉強を開始/ }).click();
  await expect(page.getByRole('combobox', { name: '学習内容', exact: true })).toHaveValue('planned');
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.clock.fastForward(30 * 60_000);
  await page.getByRole('button', { name: '終了する', exact: true }).click();
  await page.getByRole('button', { name: '記録を保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '学習を記録', exact: true })).toHaveCount(0);
  await expect(page.locator('.home-time-dot.completed')).toHaveCount(1);
}

/** Home measures these boxes to fit the screen: nothing may move or resize them.
    (Home's own opacity-only surface fade is unrelated and allowed.) */
const measuredBoxesMoved = page => page.evaluate(() =>
  [...document.querySelectorAll('.home-schedule-row, .home-next-card, .home-schedule-list, .home-dashboard')]
    .flatMap(element => element.getAnimations()
      .filter(animation => animation.effect.getKeyframes()
        .some(frame => ['transform', 'translate', 'scale', 'height', 'width'].some(name => frame[name] !== undefined)))
      .map(animation => `${element.className}: ${animation.animationName ?? animation.transitionProperty ?? 'script'}`)));

for (const width of [320, 390, 1280]) {
  test(`a saved record is explained on Home without moving its measured boxes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page);
    await page.goto('/');
    await expect(page.locator('.home-schedule-row')).toHaveCount(1);
    expect(await motionLog(page)).toEqual([]);

    await recordPlannedStudy(page);
    const log = await motionLog(page);
    const keys = log.map(entry => entry.key);
    expect(keys).toContain(`done:home-plan::${E2E_TODAY}`);
    expect(log.find(entry => entry.key === `done:home-plan::${E2E_TODAY}`).properties).toEqual(['scale']);
    // The plan's content did not change, so it does not replay.
    expect(keys).not.toContain(`plan:home-plan::${E2E_TODAY}`);
    const bars = log.filter(entry => entry.key.endsWith(':actual') || entry.key.endsWith(':plan'));
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every(entry => entry.properties.join() === 'scale')).toBe(true);
    expect(await ringTransition(page)).toBe(1);

    expect(await measuredBoxesMoved(page)).toEqual([]);
  });
}

for (const level of ['reduced', 'off']) {
  test(`at ${level} nothing moves on Home when a record is saved`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, level);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', level);
    await recordPlannedStudy(page);
    const log = await motionLog(page);
    expect(log.filter(entry => entry.properties.some(name => name === 'scale' || name === 'translate'))).toEqual([]);
    if (level === 'off') expect(log).toEqual([]);
    expect(await ringTransition(page)).toBe(0);
  });
}
