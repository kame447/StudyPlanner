import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

// Issue #696 S7: the pixel cat or turtle hops once when the user records
// study while Home is open. It follows the illustration's own motion
// setting and the app motion level, never plays on first paint, and leaves
// the time-of-day sky as it is.

async function seed(page, { style = 'pixel-cat', sceneMotion = 'true', motion } = {}) {
  await page.addInitScript(({ date, style, sceneMotion, motion }) => {
    if (localStorage.getItem('companion-motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'companion-user', email: 'companion@example.test', username: 'Study', avatar: '', createdAt: now };
    const plan = { id: 'companion-plan', seriesId: 'companion-plan', userId: user.id, title: '予定の学習', subject: '数学', type: 'study', date,
      startTime: '11:00', endTime: '12:00', memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      sourceType: 'manual', createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('study-planner-home-scene-style', style);
    localStorage.setItem('study-planner-home-scene-motion', sceneMotion);
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('companion-motion-seeded', 'true');
  }, { date: E2E_TODAY, style, sceneMotion, motion });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__hops = [];
    Element.prototype.animate = function animate(frames, options) {
      const companion = this.getAttribute?.('data-scene-companion');
      if (companion) window.__hops.push({ companion, easing: options?.easing ?? null });
      return original.call(this, frames, options);
    };
  });
}

const hops = page => page.evaluate(() => window.__hops.splice(0));
const sky = page => page.locator('.home-study-scene').getAttribute('data-scene-period');

async function recordStudy(page) {
  await page.getByRole('button', { name: /勉強を開始/ }).click();
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.clock.fastForward(20 * 60_000);
  await page.getByRole('button', { name: '終了する', exact: true }).click();
  await page.getByRole('button', { name: '記録を保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '学習を記録', exact: true })).toHaveCount(0);
  await expect(page.locator('.home-time-dot.completed')).toHaveCount(1);
}

for (const [width, style] of [[320, 'pixel-cat'], [390, 'pixel-turtle'], [1280, 'pixel-cat']]) {
  test(`the ${style.slice(6)} hops once when study is recorded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page, { style });
    await page.goto('/');
    await expect(page.locator(`[data-scene-companion="${style.slice(6)}"]`)).toHaveCount(1);
    expect(await hops(page)).toEqual([]);
    const period = await sky(page);
    await recordStudy(page);
    expect(await hops(page)).toEqual([{ companion: style.slice(6), easing: 'steps(6, end)' }]);
    expect(await sky(page)).toBe(period);
  });
}

for (const [name, options] of [
  ['the illustration motion setting is off', { sceneMotion: 'false' }],
  ['the app motion level is reduced', { motion: 'reduced' }],
  ['the app motion level is off', { motion: 'off' }],
]) {
  test(`the companion stays still when ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, options);
    await page.goto('/');
    await recordStudy(page);
    expect(await hops(page)).toEqual([]);
  });
}
