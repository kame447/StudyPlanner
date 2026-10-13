import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

async function seed(page, planned = false, longText = false) {
  await page.addInitScript(({ planned, date, longText }) => {
    const user = { id: 'compact-study', email: 'compact@example.test', username: 'Study', avatar: '', createdAt: new Date().toISOString() };
    const material = { id: 'compact-book', userId: user.id, name: '数学の本', subjectId: 'math', subjectName: '数学', status: 'active', paceEnabled: true, progressUnit: 'page', currentUnit: 10, totalUnits: 100, createdAt: user.createdAt, updatedAt: user.createdAt };
    const plan = { id: 'compact-plan', seriesId: 'compact-plan', userId: user.id, title: '数学の復習', subject: '数学', type: 'study', date, startTime: '11:00', endTime: '12:00', memo: longText ? '大切な学習メモ。'.repeat(100) : '前回の続き', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], sourceType: 'manual', materialId: material.id, materialName: material.name, createdAt: user.createdAt, updatedAt: user.createdAt };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(planned ? [plan] : []));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  }, { planned, date: E2E_TODAY, longText });
}

async function openStart(page, scenario = 'planned', longText = false) {
  await seed(page, scenario !== 'unplanned', longText);
  await page.goto('/');
  await page.getByRole('button', { name: /勉強を開始/ }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
  if (scenario === 'switched') await ready.getByRole('combobox', { name: '学習内容', exact: true }).selectOption('unplanned');
  await expect.poll(() => ready.locator('.study-session-page').evaluate(element => element.getAnimations().length)).toBe(0);
  return ready;
}

async function expectInitialFit(ready) {
  const bounds = await ready.evaluate(element => {
    const pane = element.querySelector('.study-session-page');
    const header = element.querySelector('.study-session-header').getBoundingClientRect();
    const controls = [...element.querySelectorAll('button, input, select')].map(control => {
      const rect = control.getBoundingClientRect();
      return { label: control.getAttribute('aria-label') || control.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
    });
    return { scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, scrollWidth: pane.scrollWidth, clientWidth: pane.clientWidth, viewportHeight: innerHeight, viewportWidth: innerWidth, headerBottom: header.bottom, controls };
  });
  expect(bounds.scrollTop).toBe(0);
  expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.clientHeight + 1);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  for (const control of bounds.controls) {
    expect(control.top, control.label).toBeGreaterThanOrEqual(0);
    expect(control.bottom, control.label).toBeLessThanOrEqual(bounds.viewportHeight);
    expect(control.left, control.label).toBeGreaterThanOrEqual(0);
    expect(control.right, control.label).toBeLessThanOrEqual(bounds.viewportWidth);
    // Back remains the existing 42px icon; primary/mode/input targets stay >=44px.
    expect(control.height, control.label).toBeGreaterThanOrEqual(control.label === '戻る' ? 42 : 44);
  }
  await expect(ready.getByRole('button', { name: 'スタート', exact: true })).toBeInViewport({ ratio: 1 });
}

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 360, height: 800 }, // Android/Galaxy-size viewport, not a real-device claim.
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

for (const viewport of viewports) {
  for (const scenario of ['planned', 'unplanned', 'switched']) {
    test(`study start fits ${viewport.width}x${viewport.height} (${scenario}, both modes)`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const ready = await openStart(page, scenario);
      await expectInitialFit(ready);
      await expect(ready.locator('[data-study-session-elapsed]')).toHaveText('00:00:00');
      await ready.getByRole('button', { name: /ポモドーロ/ }).click();
      await expectInitialFit(ready);
      await expect(ready.getByText('休憩を含めて記録', { exact: true })).toBeVisible();
      if (scenario === 'switched' && [320, 390, 1280].includes(viewport.width)) {
        const screenshot = testInfo.outputPath(`start-${viewport.width}-pomodoro.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach('Compact start screen', { path: screenshot, contentType: 'image/png' });
      }
    });
  }
}

test('expanded details keep the entire memo reachable and preserve keyboard operation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const ready = await openStart(page, 'planned', true);
  const details = ready.locator('.study-session-details');
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details).toContainText('大切な学習メモ。'.repeat(100));
  await ready.getByRole('button', { name: 'スタート', exact: true }).focus();
  await expect(ready.getByRole('button', { name: 'スタート', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await ready.locator('.study-session-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '学習中', exact: true })).toBeVisible();
});

for (const viewport of [{ width: 667, height: 320 }, { width: 390, height: 320 }]) {
  test(`short viewport keeps controls reachable without clipping ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ready = await openStart(page, 'switched');
    await page.setViewportSize(viewport); // Keyboard-sized viewport, not actual software-keyboard emulation.
    const input = ready.getByRole('textbox', { name: '勉強する内容' });
    await input.fill('短い画面でも保持する内容');
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport({ ratio: 1 });
    const start = ready.getByRole('button', { name: 'スタート', exact: true });
    await start.focus();
    await expect(start).toBeInViewport({ ratio: 1 });
    expect(await ready.locator('.study-session-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '学習中', exact: true })).toContainText('短い画面でも保持する内容');
  });
}

async function expectLargeTextReachability(page, ready) {
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await ready.getByRole('button', { name: /ポモドーロ/ }).click();
  const start = ready.getByRole('button', { name: 'スタート', exact: true });
  await start.focus();
  await expect(start).toBeInViewport({ ratio: 1 });
  const clock = ready.locator('[data-study-session-phase-remaining]');
  const badge = ready.locator('.study-session-timer-inner > b');
  const clockBounds = await clock.boundingBox();
  const badgeBounds = await badge.boundingBox();
  expect(clockBounds).not.toBeNull();
  expect(badgeBounds).not.toBeNull();
  expect(clockBounds.y + clockBounds.height <= badgeBounds.y + 1 || clockBounds.x + clockBounds.width <= badgeBounds.x + 1).toBe(true);
  const dimensions = await ready.evaluate(element => {
    const pane = element.querySelector('.study-session-page');
    const clippedControls = [...element.querySelectorAll('button, input, select')].filter(control => control.scrollHeight > control.clientHeight + 1 && getComputedStyle(control).overflowY === 'hidden').map(control => control.textContent);
    return { scrollWidth: pane.scrollWidth, clientWidth: pane.clientWidth, clippedControls };
  });
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(dimensions.clippedControls).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '学習中', exact: true })).toBeVisible();
}

test('200 percent text keeps controls readable and reachable with vertical scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const ready = await openStart(page, 'switched');
  await expectLargeTextReachability(page, ready);
});

for (const { viewport, theme } of [
  { viewport: { width: 320, height: 568 }, theme: 'light' },
  { viewport: { width: 390, height: 844 }, theme: 'dark' },
]) {
  test(`pixel study start fits ${viewport.width}x${viewport.height} (${theme}, both modes and enlarged text)`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(theme => {
      localStorage.setItem('study-planner-appearance', 'pixel');
      localStorage.setItem('study-planner-theme-mode', theme);
    }, theme);
    const ready = await openStart(page, 'switched');
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => ready.locator('.study-session-page').evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px DotGothic16'))).toBe(true);
    await expectInitialFit(ready);
    await ready.getByRole('button', { name: /ポモドーロ/ }).click();
    await expectInitialFit(ready);
    await testInfo.attach(`Pixel start ${viewport.width}px ${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    await expectLargeTextReachability(page, ready);
  });
}
