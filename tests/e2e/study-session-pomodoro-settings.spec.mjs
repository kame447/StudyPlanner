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

async function inspectSelectionSurface(container, modePicker = true) {
  return container.evaluate((element, modePicker) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const selected = element.querySelector('[aria-pressed="true"]');
    const other = element.querySelector('[aria-pressed="false"]');
    const track = getComputedStyle(modePicker ? element : other).backgroundColor;
    const face = getComputedStyle(modePicker ? element.querySelector('.study-session-mode-indicator') : selected).backgroundColor;
    const selectedText = getComputedStyle(selected.querySelector('strong') ?? selected).color;
    const otherText = getComputedStyle(other.querySelector('strong') ?? other).color;
    const pixel = (...colors) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = color => color.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05)
      / (Math.min(luminance(a), luminance(b)) + 0.05);
    // Both extreme backdrops cover the translucent theme surfaces beneath us.
    const samples = ['white', 'black'].map(backdrop => {
      const trackPixel = pixel(backdrop, track);
      const facePixel = pixel(backdrop, track, face);
      return {
        faceContrast: contrast(trackPixel, facePixel),
        selectedTextContrast: contrast(facePixel, pixel(backdrop, track, face, selectedText)),
        otherTextContrast: contrast(trackPixel, pixel(backdrop, track, otherText)),
      };
    });
    return { track, face, trackAlpha: pixel(track)[3] / 255, faceAlpha: pixel(face)[3] / 255, samples };
  }, modePicker);
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
    const picker = ready.getByRole('group', { name: '学習方式' });
    for (const mode of ['通常タイマー', 'ポモドーロ']) {
      await picker.getByRole('button', { name: mode, exact: true }).click();
      await expect.poll(() => picker.locator('.study-session-mode-indicator').evaluate(element => element.getAnimations().length)).toBe(0);
      const surface = await inspectSelectionSurface(picker);
      await testInfo.attach(`mode-surface-${mode}-${width}-${appearance}-${theme}`, {
        body: JSON.stringify(surface, null, 2), contentType: 'application/json',
      });
      // A gradient token inside color-mix computes to transparent; reject that.
      expect(surface.trackAlpha).toBeGreaterThan(0.9);
      expect(surface.faceAlpha).toBeGreaterThan(0.9);
      for (const sample of surface.samples) {
        // Visibility regression bound for the moving face, not a WCAG claim.
        expect(sample.faceContrast).toBeGreaterThan(1.4);
        expect(sample.selectedTextContrast).toBeGreaterThanOrEqual(4.5);
        expect(sample.otherTextContrast).toBeGreaterThanOrEqual(4.5);
      }
      await testInfo.attach(`mode-${mode}-${width}-${appearance}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
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
    const presetSurface = await inspectSelectionSurface(settings.getByRole('group', { name: '集中と休憩の時間' }), false);
    await testInfo.attach(`preset-surface-${width}-${appearance}-${theme}`, {
      body: JSON.stringify(presetSurface, null, 2), contentType: 'application/json',
    });
    for (const sample of presetSurface.samples) {
      expect(sample.selectedTextContrast).toBeGreaterThanOrEqual(4.5);
      expect(sample.otherTextContrast).toBeGreaterThanOrEqual(4.5);
    }
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

test('settings allow enlarged text to scroll without clipping controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const ready = await openStart(page, 'pixel');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await ready.getByRole('button', { name: '集中と休憩の設定' }).click();
  const settings = page.getByRole('dialog', { name: 'ポモドーロ設定', exact: true });
  const save = settings.getByRole('button', { name: '設定を保存' });
  await page.evaluate(() => document.fonts.ready);
  await save.focus();
  await expect(save).toBeFocused();
  await testInfo.attach('Enlarged settings focus geometry', {
    body: JSON.stringify(await save.evaluate(element => {
      const pane = element.closest('.study-session-page');
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, viewportHeight: innerHeight,
        scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight,
        scrollPaddingBottom: getComputedStyle(pane).scrollPaddingBottom };
    }), null, 2), contentType: 'application/json',
  });
  await expect(save).toBeInViewport({ ratio: 1 });
  expect(await settings.locator('.study-session-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(ready).toBeVisible();
});

for (const { preset, focus, rest, sets, width } of [
  { preset: '25分 / 5分', focus: 25, rest: 5, sets: 1, width: 390 },
  { preset: '50分 / 10分', focus: 50, rest: 10, sets: 2, width: 1280 },
]) {
  test(`${preset} completes ${sets} set(s) after the final break and records only on explicit Finish/Save`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const ready = await openStart(page);
    await ready.getByRole('textbox', { name: '勉強する内容' }).fill('有限セットの復習');
    await ready.getByRole('button', { name: '集中と休憩の設定' }).click();
    const settings = page.getByRole('dialog', { name: 'ポモドーロ設定', exact: true });
    await settings.getByRole('button', { name: preset }).click();
    await settings.getByRole('combobox', { name: 'セット数' }).selectOption(String(sets));
    await settings.getByRole('button', { name: '設定を保存' }).click();
    await page.clock.pauseAt(new Date(`${E2E_TODAY}T12:00:00+09:00`));
    await ready.getByRole('button', { name: 'スタート', exact: true }).click();
    const active = page.getByRole('dialog', { name: '学習中', exact: true });
    await page.clock.fastForward(focus * 60_000);
    await expect(active.locator('[data-pomodoro-phase]')).toHaveText('休憩');
    await expect(active.getByRole('status')).toHaveCount(0);
    await active.getByRole('button', { name: '一時停止', exact: true }).click();
    const pausedRemaining = await active.locator('[data-study-session-phase-remaining]').innerText();
    await page.clock.fastForward(10 * 60_000);
    await expect(active.locator('[data-study-session-phase-remaining]')).toHaveText(pausedRemaining);
    await active.getByRole('button', { name: '再開', exact: true }).click();
    await page.clock.fastForward(rest * 60_000);
    if (sets > 1) {
      await expect(active.locator('[data-pomodoro-phase]')).toHaveText('集中');
      await expect(active.getByRole('status')).toHaveCount(0);
      // A delayed/background tick must stop at the final cycle, not at its arrival.
      await page.clock.fastForward((focus + rest + 7) * 60_000);
    }
    await expect(active.getByRole('status')).toHaveText('全セット完了');
    await expect(active.getByRole('button', { name: '完了', exact: true })).toBeDisabled();
    await expect(active.locator('[data-study-session-phase-remaining]')).toHaveText('00:00');
    await expect(page.getByRole('dialog', { name: '学習を記録', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'))).toEqual([]);
    await testInfo.attach(`completed-${width}-${sets}-sets`, { body: await page.screenshot(), contentType: 'image/png' });
    // Keeping a completed timer open overnight must neither grow it nor create a false date warning.
    await page.clock.fastForward(24 * 60 * 60_000);
    await active.getByRole('button', { name: '終了する', exact: true }).click();
    const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await expect(record.getByRole('alert')).toHaveCount(0);
    await expect(record).toContainText(E2E_TODAY);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'))).toEqual([]);
    await record.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(active.getByRole('button', { name: '完了', exact: true })).toBeDisabled();
    await active.getByRole('button', { name: '終了する', exact: true }).click();
    await record.getByRole('button', { name: '記録を保存', exact: true }).click();
    await expect(record).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ planId: null, title: '有限セットの復習', occurrenceDate: E2E_TODAY,
      actualStartTime: '12:00', actualEndTime: sets === 1 ? '12:30' : '14:00' });
    await page.clock.resume();
    await page.getByRole('button', { name: '勉強を開始' }).click();
    await expect(ready.getByRole('button', { name: '通常タイマー', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await ready.getByRole('button', { name: 'ポモドーロ', exact: true }).click();
    await expect(ready.locator('[data-study-session-phase-remaining]')).toHaveText('25:00');
    await expect(ready.getByRole('button', { name: '集中と休憩の設定' })).toContainText('制限なし');
  });
}

test('a finite measurement crossing midnight still requires explicit date review before saving', async ({ page }) => {
  const ready = await openStart(page);
  await ready.getByRole('button', { name: '集中と休憩の設定' }).click();
  const settings = page.getByRole('dialog', { name: 'ポモドーロ設定', exact: true });
  await settings.getByRole('combobox', { name: 'セット数' }).selectOption('1');
  await settings.getByRole('button', { name: '設定を保存' }).click();
  await page.clock.pauseAt(new Date(`${E2E_TODAY}T23:45:00+09:00`));
  await ready.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.clock.fastForward(31 * 60_000);
  const active = page.getByRole('dialog', { name: '学習中', exact: true });
  await expect(active.getByRole('status')).toHaveText('全セット完了');
  await active.getByRole('button', { name: '終了する', exact: true }).click();
  const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
  await expect(record.getByRole('alert')).toContainText('日付をまたいだ計測');
  await record.getByRole('button', { name: '記録を保存', exact: true }).click();
  await expect(record).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'))).toEqual([]);
});

for (const width of [390, 1280]) {
  test(`custom pomodoro survives Home and reload and saves a reviewed subject at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ready = await openStart(page);
    await ready.getByRole('button', { name: '集中と休憩の設定' }).click();
    const settings = page.getByRole('dialog', { name: 'ポモドーロ設定', exact: true });
    await expect(settings.getByRole('button', { name: '25分 / 5分', exact: true })).toBeVisible();
    await expect(settings.getByRole('button', { name: '50分 / 10分', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'カスタム', exact: true }).click();
    await settings.getByRole('spinbutton', { name: '集中（分）', exact: true }).fill('17');
    await settings.getByRole('spinbutton', { name: '休憩（分）', exact: true }).fill('3');
    await settings.getByRole('combobox', { name: 'セット数' }).selectOption('1');
    await page.screenshot({ path: testInfo.outputPath(`custom-pomodoro-${width}.png`), animations: 'disabled' });
    await settings.getByRole('button', { name: '設定を保存' }).click();
    await page.clock.pauseAt(new Date(`${E2E_TODAY}T12:00:00+09:00`));
    await ready.getByRole('button', { name: 'スタート', exact: true }).click();
    const running = page.getByRole('dialog', { name: '学習中', exact: true });
    await running.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(running).toBeHidden();
    await page.clock.fastForward(10 * 60_000);
    await page.getByRole('button', { name: '計測中へ戻る', exact: true }).click();
    await expect(running.locator('[data-study-session-phase-remaining]')).toHaveText('07:00');
    await page.reload();
    await page.getByRole('button', { name: '計測中へ戻る', exact: true }).click();
    await expect(running.locator('[data-study-session-phase-remaining]')).toHaveText('07:00');
    await page.clock.fastForward(8 * 60_000);
    await expect(running.locator('[data-pomodoro-phase]')).toHaveText('休憩');
    await expect(running.locator('[data-study-session-phase-remaining]')).toHaveText('02:00');
    await running.getByRole('button', { name: '終了する', exact: true }).click();
    const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await record.getByLabel('科目を入力', { exact: true }).fill('復習');
    await record.getByText('記録時刻を調整', { exact: true }).click();
    const fields = record.locator('.study-session-time-adjust input[type="time"]');
    await expect(fields).toHaveCount(2);
    const [first, second] = await Promise.all([fields.nth(0).boundingBox(), fields.nth(1).boundingBox()]);
    expect(first.x + first.width <= second.x + 1 || first.y + first.height <= second.y + 1).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`restored-record-fields-${width}.png`), animations: 'disabled' });
    await record.getByRole('button', { name: '記録を保存', exact: true }).click();
    await expect(record).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'))).toEqual([
      expect.objectContaining({ planId: null, subject: '復習', occurrenceDate: E2E_TODAY, actualStartTime: '12:00', actualEndTime: '12:18' }),
    ]);
  });
}
