import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

// Issue #690: one motion level (標準/控えめ/オフ) owned by the app, capped by the
// device reduced-motion setting, persisted per browser and applied to real
// interactions without delaying them.

async function seed(page) {
  await page.addInitScript(({ today }) => {
    if (localStorage.getItem('motion-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'motion-user', email: 'motion@example.test', username: 'モーション', avatar: '', createdAt: now };
    const plan = { id: 'motion-plan', seriesId: 'motion-plan', userId: user.id, title: '動きの確認', subject: '数学',
      type: 'study', sourceType: 'manual', date: today, startTime: '14:00', endTime: '15:00', memo: '', repeat: 'none',
      repeatUntil: null, excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('motion-seeded', 'true');
  }, { today: E2E_TODAY });
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const settings = page.getByRole('main', { name: 'アプリ設定' });
  await expect(settings).toBeVisible();
  return settings;
}

async function closeSettings(page) {
  await page.getByRole('main', { name: 'アプリ設定' }).getByRole('button', { name: '戻る', exact: true }).click();
}

const motionGroup = settings => settings.getByRole('group', { name: 'アニメーション' });

async function openWeek(page) {
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
  await page.getByRole('tablist', { name: '予定表示' }).getByRole('tab', { name: '週', exact: true }).click();
  await expect(page.locator('.schedule-week-preview-grid')).toBeVisible();
}

const gridAnimations = page => page.locator('.schedule-week-preview-grid').evaluate(element =>
  element.getAnimations().map(animation => ({
    state: animation.playState,
    properties: [...new Set(animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))]
      .filter(key => !['offset', 'easing', 'composite', 'computedOffset'].includes(key)).sort(),
  })));

for (const width of [390, 1280]) {
  test(`the chosen level persists, applies at once and keeps rapid navigation intact at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await seed(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'standard');

    let settings = await openSettings(page);
    await expect(motionGroup(settings).getByRole('button', { name: '標準' })).toHaveAttribute('aria-pressed', 'true');
    await motionGroup(settings).getByRole('button', { name: 'オフ' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
    await expect(settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす' })).toBeDisabled();
    await motionGroup(settings).scrollIntoViewIfNeeded();
    await testInfo.attach(`motion-setting-off-${width}`, { body: await settings.screenshot(), contentType: 'image/png' });
    expect(await settings.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
    // Settings is a route: the reload returns to it.
    settings = page.getByRole('main', { name: 'アプリ設定' });
    await expect(settings).toBeVisible();
    await expect(motionGroup(settings).getByRole('button', { name: 'オフ' })).toHaveAttribute('aria-pressed', 'true');
    await closeSettings(page);

    await openWeek(page);
    const next = page.getByRole('button', { name: '次の期間へ' });
    const heading = page.locator('.schedule-week-preview-grid .weekly-draft-preview-date').first();
    const firstDay = await heading.getAttribute('aria-label');
    await next.click();
    await expect(heading).not.toHaveAttribute('aria-label', firstDay);
    expect(await gridAnimations(page)).toEqual([]);

    settings = await openSettings(page);
    await motionGroup(settings).getByRole('button', { name: '標準' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'standard');
    await closeSettings(page);
    await openWeek(page);

    const before = await heading.getAttribute('aria-label');
    await next.click();
    const running = await gridAnimations(page);
    expect(running).toHaveLength(1);
    expect(running[0].properties).toEqual(['opacity', 'translate']);

    // Rapid taps: each new period replaces the running slide; nothing queues,
    // focus stays on the control and no animation outlives the last tap.
    for (let index = 0; index < 5; index += 1) await next.click();
    await expect(next).toBeFocused();
    await expect.poll(async () => (await gridAnimations(page)).length, { timeout: 2_000 }).toBe(0);
    await expect(heading).not.toHaveAttribute('aria-label', before);
    const opacity = await page.locator('.schedule-week-preview-grid').evaluate(element => getComputedStyle(element).opacity);
    expect(opacity).toBe('1');
  });
}

test('the device reduced-motion setting caps standard and leaves fades only', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

  const settings = await openSettings(page);
  await expect(motionGroup(settings).getByRole('button', { name: '標準' })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByText('端末で動きを減らす設定が有効なため、控えめで表示しています。')).toBeVisible();
  await expect(settings.getByRole('checkbox', { name: 'イラストをゆっくり動かす' })).toBeDisabled();

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'standard');
  await expect(settings.getByText('端末で動きを減らす設定が有効なため、控えめで表示しています。')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await closeSettings(page);

  await openWeek(page);
  await page.getByRole('button', { name: '次の期間へ' }).click();
  const running = await gridAnimations(page);
  expect(running.map(animation => animation.properties)).toEqual([['opacity']]);
});

test('off removes sheet motion and closes without waiting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.addInitScript(() => localStorage.setItem('study-planner-motion', 'off'));
  await page.goto('/');
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
  await page.locator('.month-cell[aria-selected="true"]').click();
  const sheet = page.locator('.month-day-sheet');
  await expect(sheet).toBeVisible();
  const durations = await sheet.evaluate(element => [getComputedStyle(element).animationDuration,
    getComputedStyle(element.closest('.month-day-sheet-overlay')).animationDuration]);
  expect(durations).toEqual(['0s', '0s']);
  await sheet.getByRole('button', { name: '閉じる' }).click();
  // No exit wait: the sheet is gone on the next frame rather than after 220ms.
  await expect(sheet).toHaveCount(0, { timeout: 100 });
});

test('a plan dropped on another day arrives there, and no other card moves', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/week-plan-drag.html');
  const plan = page.getByRole('button', { name: /数学の復習.*タップで編集/ });
  await expect(plan).toBeVisible();
  const box = await plan.boundingBox();
  const column = await page.locator('.schedule-week-day-column').nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + column.width + 8, box.y + box.height / 2 + 70, { steps: 8 });
  await page.mouse.up();

  const moved = page.getByRole('button', { name: /数学の復習.*タップで編集/ });
  const animated = await page.locator('[data-motion-key]').evaluateAll(elements => elements
    .filter(element => element.getAnimations().length > 0)
    .map(element => ({ label: element.getAttribute('aria-label') ?? '', properties: element.getAnimations()
      .flatMap(animation => animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))
      .filter(key => ['scale', 'translate', 'opacity'].includes(key)) })));
  expect(animated).toHaveLength(1);
  expect(animated[0].label).toContain('数学の復習');
  // A card on another day is a new placement: it rises and fades into place.
  expect([...new Set(animated[0].properties)].sort()).toEqual(['opacity', 'scale', 'translate']);
  await expect(moved).toBeVisible();
});
