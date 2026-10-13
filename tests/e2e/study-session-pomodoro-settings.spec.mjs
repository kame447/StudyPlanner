import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

async function openStart(page, appearance = 'standard', theme = 'light') {
  await page.addInitScript(({ appearance, theme, date }) => {
    const user = { id: 'pomodoro-settings', email: 'pomodoro@example.test', username: 'Study', avatar: '', createdAt: `${date}T00:00:00Z` };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
    localStorage.setItem('study-planner-appearance', appearance);
    localStorage.setItem('study-planner-theme-mode', theme);
  }, { appearance, theme, date: E2E_TODAY });
  await page.goto('/');
  await page.getByRole('button', { name: '勉強を開始' }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
  await ready.getByRole('button', { name: 'ポモドーロ', exact: true }).click();
  await expect.poll(() => ready.locator('.study-session-page').evaluate(element => element.getAnimations().length)).toBe(0);
  return ready;
}

for (const { width, height, appearance, theme } of [
  { width: 320, height: 568, appearance: 'standard', theme: 'light' },
  { width: 320, height: 568, appearance: 'pixel', theme: 'light' },
  { width: 390, height: 844, appearance: 'pixel', theme: 'dark' },
  { width: 1280, height: 800, appearance: 'standard', theme: 'dark' },
]) {
  test(`settings stay separate, preserve inputs and remain accessible at ${width}px ${appearance} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const ready = await openStart(page, appearance, theme);
    await page.evaluate(() => document.fonts.ready);
    await ready.getByRole('textbox', { name: '勉強する内容' }).fill('集中して読み進める');
    const settingsButton = ready.getByRole('button', { name: '集中と休憩の設定' });
    await expect(ready.getByRole('button', { name: 'スタート', exact: true })).toBeInViewport({ ratio: 1 });
    await settingsButton.click();
    const settings = page.getByRole('dialog', { name: 'ポモドーロ設定', exact: true });
    await expect(settings.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(settings.getByRole('textbox', { name: '勉強する内容' })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'スタート', exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: '50分 / 10分' }).click();
    await settings.getByRole('combobox', { name: 'セット数' }).selectOption('3');
    // Settings may scroll vertically; only the Study Start screen must fit at once.
    const saveSettings = settings.getByRole('button', { name: '設定を保存' });
    await saveSettings.scrollIntoViewIfNeeded();
    await expect(saveSettings).toBeInViewport({ ratio: 1 });
    expect(await settings.locator('.study-session-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await testInfo.attach(`settings-${width}-${appearance}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    await settings.getByRole('button', { name: '設定を保存' }).click();
    await expect(settingsButton).toBeFocused();
    await expect(settingsButton).toContainText('50分 / 10分 ・ 3セット');
    await expect(ready.locator('[data-study-session-phase-remaining]')).toHaveText('50:00');
    await expect(ready.getByRole('textbox', { name: '勉強する内容' })).toHaveValue('集中して読み進める');
    await settingsButton.click();
    await settings.getByRole('button', { name: '25分 / 5分' }).click();
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(settingsButton).toBeFocused();
    await expect(ready.locator('[data-study-session-phase-remaining]')).toHaveText('50:00');
    await ready.getByRole('button', { name: 'スタート', exact: true }).click();
    const active = page.getByRole('dialog', { name: '学習中', exact: true });
    await expect(active.getByRole('button', { name: '集中と休憩の設定' })).toHaveCount(0);
    await expect(active.getByRole('button', { name: 'ポモドーロ', exact: true })).toBeDisabled();
  });
}

test('mode indicator moves continuously sideways, accepts swipe and honors reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const ready = await openStart(page);
  const normal = ready.getByRole('button', { name: '通常タイマー', exact: true });
  const pomodoro = ready.getByRole('button', { name: 'ポモドーロ', exact: true });
  await normal.click();
  const indicator = ready.locator('.study-session-mode-indicator');
  await expect.poll(() => indicator.evaluate(element => element.getAnimations().length)).toBe(0);
  await pomodoro.evaluate(element => element.click());
  await expect.poll(() => indicator.evaluate(element => {
    const animation = element.getAnimations()[0];
    if (!animation) return false;
    animation.pause();
    window.__modeAnimation = animation;
    return true;
  })).toBe(true);
  const positions = await indicator.evaluate(element => [0, 120, 240].map(time => {
    window.__modeAnimation.currentTime = time;
    return new DOMMatrix(getComputedStyle(element).transform).m41;
  }));
  expect(positions[0]).toBe(0);
  expect(positions[1]).toBeGreaterThan(positions[0]);
  expect(positions[1]).toBeLessThan(positions[2]);
  await indicator.evaluate(() => window.__modeAnimation.finish());
  const bounds = await pomodoro.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(normal).toHaveAttribute('aria-pressed', 'true');
  await expect(ready).toBeVisible();
  await normal.focus(); await page.keyboard.press('ArrowRight');
  await expect(pomodoro).toBeFocused();
  await expect(pomodoro).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await normal.click();
  expect(await indicator.evaluate(element => ({ duration: getComputedStyle(element).transitionDuration, animations: element.getAnimations().length }))).toEqual({ duration: '0s', animations: 0 });
});

test('settings allow enlarged text to scroll without clipping controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const ready = await openStart(page, 'pixel');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await ready.getByRole('button', { name: '集中と休憩の設定' }).click();
  const settings = page.getByRole('dialog', { name: 'ポモドーロ設定', exact: true });
  const save = settings.getByRole('button', { name: '設定を保存' });
  await save.focus();
  await expect(save).toBeInViewport({ ratio: 1 });
  expect(await settings.locator('.study-session-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(ready).toBeVisible();
});
