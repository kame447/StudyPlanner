import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

// Issue #696 S6: the study session reacts to the user's own steps, never to
// the running clock: starting, pausing and resuming settle the timer ring
// once, and finishing brings the record step forward in place (never
// sideways, which would widen the pane's scroll area). The report chart and the streak calendar slide from the side the
// user paged toward.

async function seed(page, motion) {
  await page.addInitScript(({ date, motion }) => {
    if (localStorage.getItem('study-motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'study-motion-user', email: 'study-motion@example.test', username: 'Study', avatar: '', createdAt: now };
    const plan = { id: 'study-plan', seriesId: 'study-plan', userId: user.id, title: '予定の学習', subject: '数学', type: 'study', date,
      startTime: '11:00', endTime: '12:00', memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      sourceType: 'manual', createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.todos.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('studyplanner.actuals', JSON.stringify([{ id: 'study-motion-actual', userId: user.id,
      planId: null, occurrenceDate: date, actualStartTime: '08:00', actualEndTime: '08:45', title: '朝の復習', subject: '数学',
      isAlignedToPlan: false, note: '', updatedAt: now }]));
    if (motion) localStorage.setItem('study-planner-motion', motion);
    localStorage.setItem('study-motion-seeded', 'true');
  }, { date: E2E_TODAY, motion });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    window.__motionLog = [];
    Element.prototype.animate = function animate(frames, options) {
      const first = (Array.isArray(frames) ? frames[0] : {}) ?? {};
      window.__motionLog.push({ target: String(this.className?.baseVal || this.className || this.tagName).split(' ')[0],
        properties: Object.keys(first).filter(name => name !== 'offset').sort(), translate: first.translate ?? null });
      return original.call(this, frames, options);
    };
  });
}

const motionLog = page => page.evaluate(() => window.__motionLog.splice(0));
const of = (log, target) => log.filter(entry => entry.target === target);

for (const width of [320, 390, 1280]) {
  test(`the study session reacts to each step, not to the clock, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: /勉強を開始/ }).click();
    const dialog = page.getByRole('dialog', { name: '学習を開始', exact: true });
    await expect(dialog).toBeVisible();
    await motionLog(page);

    await page.getByRole('button', { name: 'スタート', exact: true }).click();
    expect(of(await motionLog(page), 'study-session-timer-ring').map(entry => entry.properties)).toEqual([['scale']]);

    // The running clock does not animate anything.
    await page.clock.fastForward(5 * 60_000);
    expect(of(await motionLog(page), 'study-session-timer-ring')).toEqual([]);

    await page.getByRole('button', { name: '一時停止', exact: true }).click();
    await page.getByRole('button', { name: '再開', exact: true }).click();
    expect(of(await motionLog(page), 'study-session-timer-ring')).toHaveLength(2);

    await page.getByRole('button', { name: '終了する', exact: true }).click();
    await expect(page.getByRole('button', { name: '記録を保存', exact: true })).toBeVisible();
    const forward = of(await motionLog(page), 'study-session-content');
    expect(forward).toHaveLength(1);
    expect(forward[0].properties).toEqual(['opacity', 'scale']);
    const pane = await page.locator('.study-session-page').evaluate(element => [element.scrollWidth, element.clientWidth]);
    expect(pane[0]).toBeLessThanOrEqual(pane[1] + 1);
    await expect.poll(() => page.locator('.study-session-content').evaluate(element => element.getAnimations().length)).toBe(0);
  });
}

test('at off the study session shows each step with no motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, 'off');
  await page.goto('/');
  await page.getByRole('button', { name: /勉強を開始/ }).click();
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.clock.fastForward(60_000);
  await page.getByRole('button', { name: '終了する', exact: true }).click();
  await expect(page.getByRole('button', { name: '記録を保存', exact: true })).toBeVisible();
  const log = await motionLog(page);
  expect([...of(log, 'study-session-timer-ring'), ...of(log, 'study-session-content')]).toEqual([]);
});

test('the report chart and streak calendar slide from the side the user paged toward', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: '詳細を見る' }).click();
  await expect(page.getByRole('button', { name: '前の期間を表示' })).toBeVisible();
  await motionLog(page);
  await page.getByRole('button', { name: '前の期間を表示' }).click();
  // Sliding never adds horizontal page scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // This week has a record (chart); the previous one is empty (notice).
  const periodContent = log => log.filter(entry => ['learning-report-chart', 'learning-report-empty'].includes(entry.target));
  const back = periodContent(await motionLog(page));
  expect(back.map(entry => [entry.target, entry.properties, Number.parseFloat(entry.translate) < 0]))
    .toEqual([['learning-report-empty', ['opacity', 'translate'], true]]);
  await page.getByRole('button', { name: '次の期間を表示' }).click();
  expect(periodContent(await motionLog(page)).map(entry => [entry.target, Number.parseFloat(entry.translate) > 0]))
    .toEqual([['learning-report-chart', true]]);

  // Switching week/month is not paging: nothing slides.
  await page.getByRole('tablist', { name: '集計期間' }).getByRole('tab', { name: '月', exact: true }).click();
  await page.getByRole('tablist', { name: '集計期間' }).getByRole('tab', { name: '週', exact: true }).click();
  expect(periodContent(await motionLog(page))).toEqual([]);

  // The streak calendar pages the same way.
  await page.goto('/');
  await page.getByRole('button', { name: /連続学習/ }).first().click();
  await expect(page.getByRole('button', { name: '前の月' })).toBeVisible();
  await motionLog(page);
  await page.getByRole('button', { name: '前の月' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(of(await motionLog(page), 'TABLE').map(entry => [entry.properties, Number.parseFloat(entry.translate) < 0]))
    .toEqual([[['opacity', 'translate'], true]]);
  await page.getByRole('button', { name: '今日' }).click();
  expect(of(await motionLog(page), 'TABLE').map(entry => Number.parseFloat(entry.translate) > 0)).toEqual([true]);
});

for (const width of [320, 390]) {
  test(`paging forward never widens the page, even at the first frame, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: '詳細を見る' }).click();
    await page.getByRole('button', { name: '前の期間を表示' }).click();
    await page.getByRole('button', { name: '次の期間を表示' }).click();
    const frozen = await page.locator('.learning-report-chart').evaluate(element => {
      const animation = element.getAnimations()[0];
      animation?.pause();
      if (animation) animation.currentTime = 0;
      const right = element.getBoundingClientRect().right;
      const result = { running: Boolean(animation), right, innerWidth: window.innerWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
      animation?.play();
      return result;
    });
    console.log('FORWARD', width, JSON.stringify(frozen));
    expect(frozen.running).toBe(true);
    expect(frozen.pageOverflow).toBeLessThanOrEqual(0);
  });
}
