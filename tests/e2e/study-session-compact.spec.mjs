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
      await expect(ready.getByRole('button', { name: 'ポモドーロ', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(ready.locator('[data-pomodoro-phase]')).toHaveText('集中');
      await expect(ready.locator('[data-study-session-phase-remaining]')).toHaveText('25:00');
      await expect(ready.getByRole('button', { name: '集中と休憩の設定', exact: true }))
        .toHaveText(scenario === 'planned' ? '25分 / 5分 ・ 2セット（目安）' : '25分 / 5分 ・ 制限なし');
      await expect(ready.getByText('休憩を含めて記録', { exact: true })).toHaveCount(0);
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
  // The compact Pomodoro face now contains its phase and clock; the removed
  // explanatory badge is not a layout target. Keep checking the actual text
  // and neighboring settings action rather than merely deleting the old bound.
  const phase = ready.locator('[data-pomodoro-phase]');
  const settings = ready.getByRole('button', { name: '集中と休憩の設定', exact: true });
  await expect(phase).toHaveText('集中');
  await expect(clock).toHaveText('25:00');
  const [phaseBounds, clockBounds, settingsBounds] = await Promise.all([
    phase.boundingBox(), clock.boundingBox(), settings.boundingBox(),
  ]);
  for (const bounds of [phaseBounds, clockBounds, settingsBounds]) expect(bounds).not.toBeNull();
  expect(phaseBounds.y + phaseBounds.height).toBeLessThanOrEqual(clockBounds.y + 1);
  expect(clockBounds.y + clockBounds.height).toBeLessThanOrEqual(settingsBounds.y + 1);
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

// Tall desktop viewports use the circular face rather than the <=800px compact
// row. Keep rendered text-fragment bounds inside that face when users enlarge text; a
// fitting outer clock element alone does not prove its rendered text fits.
async function recordDesktopTimerGeometry(page, dialog, testInfo, name) {
  await page.evaluate(() => document.fonts.ready);
  const clock = dialog.locator('[data-study-session-elapsed]');
  await clock.scrollIntoViewIfNeeded();
  const geometry = await clock.evaluate(element => {
    const rect = node => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const range = document.createRange();
    range.selectNodeContents(element);
    const pane = element.closest('.study-session-page');
    const inner = element.closest('.study-session-timer-inner');
    const ring = element.closest('.study-session-timer-ring');
    const style = getComputedStyle(element);
    const ringStyle = getComputedStyle(ring);
    const badge = inner.querySelector('b');
    const badgeRange = document.createRange();
    if (badge) badgeRange.selectNodeContents(badge);
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      visualViewport: window.visualViewport ? {
        width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale,
      } : null,
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      appearance: document.documentElement.dataset.appearance,
      theme: document.documentElement.dataset.theme,
      mode: ring.dataset.studyMode,
      elapsed: element.textContent,
      font: { family: style.fontFamily, size: parseFloat(style.fontSize), weight: style.fontWeight,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        loaded: document.fonts.check(`${style.fontSize} ${style.fontFamily}`, element.textContent),
        pixelFaceLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'DotGothic16' && face.status === 'loaded') },
      ring: { ...rect(ring), padding: {
        left: parseFloat(ringStyle.paddingLeft), right: parseFloat(ringStyle.paddingRight),
        top: parseFloat(ringStyle.paddingTop), bottom: parseFloat(ringStyle.paddingBottom),
      } }, inner: rect(inner), clock: rect(element),
      badge: badge ? { ...rect(badge), text: badge.textContent,
        textRects: [...badgeRange.getClientRects()].map(({ left, right, top, bottom, width, height }) =>
          ({ left, right, top, bottom, width, height })) } : null,
      textRects: [...range.getClientRects()].map(({ left, right, top, bottom, width, height }) =>
        ({ left, right, top, bottom, width, height })),
      pane: { ...rect(pane), scrollWidth: pane.scrollWidth, clientWidth: pane.clientWidth,
        scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, overflowY: getComputedStyle(pane).overflowY },
    };
  });
  // Keep the failing geometry and pixels before assertions, including both
  // scales/states via soft geometry assertions below. These are local fixtures.
  await testInfo.attach(`${name}-geometry`, {
    body: JSON.stringify({ revision: process.env.GITHUB_SHA ?? null, project: testInfo.project.name, ...geometry }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach(`${name}-screen`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  return geometry;
}

function expectDesktopTimerContainment(geometry) {
  expect.soft(geometry.font.loaded).toBe(true);
  expect.soft(geometry.mode).toBe('normal');
  // This plain-text hh:mm:ss clock must stay on one line, not wrap to fit.
  expect.soft(geometry.textRects).toHaveLength(1);
  expect.soft(geometry.inner.width).toBeGreaterThan(0);
  // Growing the face must preserve the circle and its surrounding ring rather
  // than stretch the inner grid into an ellipse or through the ring padding.
  expect.soft(Math.abs(geometry.ring.width - geometry.ring.height)).toBeLessThanOrEqual(1);
  expect.soft(geometry.inner.left).toBeGreaterThanOrEqual(geometry.ring.left + geometry.ring.padding.left - 1);
  expect.soft(geometry.inner.right).toBeLessThanOrEqual(geometry.ring.right - geometry.ring.padding.right + 1);
  expect.soft(geometry.inner.top).toBeGreaterThanOrEqual(geometry.ring.top + geometry.ring.padding.top - 1);
  expect.soft(geometry.inner.bottom).toBeLessThanOrEqual(geometry.ring.bottom - geometry.ring.padding.bottom + 1);
  for (const text of geometry.textRects) {
    expect.soft(text.width).toBeGreaterThan(0);
    expect.soft(text.height).toBeGreaterThan(0);
    expect.soft(text.left).toBeGreaterThanOrEqual(geometry.inner.left - 1);
    expect.soft(text.right).toBeLessThanOrEqual(geometry.inner.right + 1);
    expect.soft(text.top).toBeGreaterThanOrEqual(geometry.inner.top - 1);
    expect.soft(text.bottom).toBeLessThanOrEqual(geometry.inner.bottom + 1);
  }
  if (geometry.badge) {
    expect.soft(geometry.badge.top).toBeGreaterThanOrEqual(geometry.clock.bottom - 1);
    expect.soft(geometry.badge.left).toBeGreaterThanOrEqual(geometry.inner.left - 1);
    expect.soft(geometry.badge.right).toBeLessThanOrEqual(geometry.inner.right + 1);
    expect.soft(geometry.badge.bottom).toBeLessThanOrEqual(geometry.inner.bottom + 1);
    for (const text of geometry.badge.textRects) {
      expect.soft(text.left).toBeGreaterThanOrEqual(geometry.badge.left - 1);
      expect.soft(text.right).toBeLessThanOrEqual(geometry.badge.right + 1);
      expect.soft(text.top).toBeGreaterThanOrEqual(geometry.badge.top - 1);
      expect.soft(text.bottom).toBeLessThanOrEqual(geometry.badge.bottom + 1);
    }
  }
  expect.soft(geometry.pane.scrollWidth).toBeLessThanOrEqual(geometry.pane.clientWidth + 1);
  // Enlarged text may scroll vertically. Clipping it to pass a one-screen
  // assertion would violate the existing keyboard/long-content contract.
  expect.soft(geometry.pane.overflowY).not.toMatch(/hidden|clip/);
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  for (const appearance of ['standard', 'pixel']) {
    test(`desktop ordinary timer text stays inside its face at ${viewport.width}x${viewport.height} (${appearance}, 200 percent)`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(value => {
        localStorage.setItem('study-planner-appearance', value);
        localStorage.setItem('study-planner-theme-mode', 'light');
      }, appearance);
      const ready = await openStart(page, 'unplanned');
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await ready.getByRole('button', { name: '通常タイマー', exact: true }).click();
      await expect(ready.getByRole('button', { name: '通常タイマー', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if (appearance === 'pixel') {
        await expect.poll(() => ready.locator('[data-study-session-elapsed]')
          .evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
      }
      await page.evaluate(() => document.fonts.ready);
      // Freeze after entry motion settles. Advance the real timer below rather
      // than injecting elapsed text or replacing its DOM with a layout mock.
      await page.clock.pauseAt(new Date(`${E2E_TODAY}T12:00:00+09:00`));
      for (const [state, elapsed] of [['ready', '00:00:00'], ['paused', '01:01:01']]) {
        const dialog = page.getByRole('dialog', { name: state === 'ready' ? '学習を開始' : '学習中', exact: true });
        await expect(dialog.locator('[data-study-session-elapsed]')).toHaveText(elapsed);
        let control;
        for (const textScale of [100, 200]) {
          await page.evaluate(scale => document.documentElement.style.setProperty('font-size', `${scale}%`, 'important'), textScale);
          const name = `ordinary-timer-${viewport.width}x${viewport.height}-${appearance}-${state}-${textScale}`;
          const geometry = await recordDesktopTimerGeometry(page, dialog, testInfo, name);
          expect.soft(geometry.viewport.width).toBe(viewport.width);
          expect.soft(geometry.viewport.height).toBe(viewport.height);
          expect.soft(geometry.elapsed).toBe(elapsed);
          if (appearance === 'pixel') {
            expect.soft(geometry.font.family).toContain('DotGothic16');
            expect.soft(geometry.font.pixelFaceLoaded).toBe(true);
          }
          if (textScale === 100) control = geometry;
          else {
            expect.soft(geometry.rootFontSize).toBeCloseTo(control.rootFontSize * 2, 1);
            // The current viewport-based clamp grows by1.83x at1280 and2x at
            // wider targets. Do not hide overflow by making enlarged text tiny.
            expect.soft(geometry.font.size).toBeGreaterThanOrEqual(control.font.size * 1.5);
          }
          expectDesktopTimerContainment(geometry);
        }
        if (state === 'ready') {
          const start = dialog.getByRole('button', { name: 'スタート', exact: true });
          await start.focus();
          await expect(start).toBeInViewport({ ratio: 1 });
          await page.keyboard.press('Enter');
          const running = page.getByRole('dialog', { name: '学習中', exact: true });
          await page.clock.fastForward(3_661_000);
          await expect(running.locator('[data-study-session-elapsed]')).toHaveText('01:01:01');
          await running.getByRole('button', { name: '一時停止', exact: true }).click();
          await expect(running.getByRole('button', { name: '再開', exact: true })).toBeVisible();
        } else {
          const finish = dialog.getByRole('button', { name: '終了する', exact: true });
          await finish.focus();
          await expect(finish).toBeInViewport({ ratio: 1 });
        }
      }
    });
  }
}


test('desktop planned ordinary timer keeps remaining badge separate at 1440x900 (pixel, 200 percent)', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('study-planner-appearance', 'pixel');
    localStorage.setItem('study-planner-theme-mode', 'light');
  });
  const ready = await openStart(page, 'planned');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'pixel');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await ready.getByRole('button', { name: '通常タイマー', exact: true }).click();
  await expect(ready.getByRole('button', { name: '通常タイマー', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date(`${E2E_TODAY}T12:00:00+09:00`));
  for (const [state, elapsed, remaining] of [
    ['ready', '00:00:00', null],
    ['remaining', '00:01:01', '残り 00:58:59'],
    ['overrun', '01:01:01', '残り 00:00:00'],
  ]) {
    const dialog = page.getByRole('dialog', { name: state === 'ready' ? '学習を開始' : '学習中', exact: true });
    await expect(dialog.locator('[data-study-session-elapsed]')).toHaveText(elapsed);
    let control;
    for (const textScale of [100, 200]) {
      await page.evaluate(scale => document.documentElement.style.setProperty('font-size', `${scale}%`, 'important'), textScale);
      const geometry = await recordDesktopTimerGeometry(page, dialog, testInfo, `planned-timer-1440x900-pixel-${state}-${textScale}`);
      expect.soft(geometry.viewport.width).toBe(1440);
      expect.soft(geometry.viewport.height).toBe(900);
      expect.soft(geometry.elapsed).toBe(elapsed);
      expect.soft(geometry.font.family).toContain('DotGothic16');
      expect.soft(geometry.font.pixelFaceLoaded).toBe(true);
      expect.soft(geometry.badge?.text ?? null).toBe(remaining);
      if (textScale === 100) control = geometry;
      else {
        expect.soft(geometry.rootFontSize).toBeCloseTo(control.rootFontSize * 2, 1);
        expect.soft(geometry.font.size).toBeGreaterThanOrEqual(control.font.size * 1.5);
      }
      expectDesktopTimerContainment(geometry);
    }
    if (state === 'overrun') {
      const finish = dialog.getByRole('button', { name: '終了する', exact: true });
      await finish.focus();
      await expect(finish).toBeInViewport({ ratio: 1 });
    } else {
      const action = dialog.getByRole('button', { name: state === 'ready' ? 'スタート' : '再開', exact: true });
      await action.focus();
      await expect(action).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Enter');
      const running = page.getByRole('dialog', { name: '学習中', exact: true });
      await page.clock.fastForward(state === 'ready' ? 61_000 : 3_600_000);
      await running.getByRole('button', { name: '一時停止', exact: true }).click();
      await expect(running.getByRole('button', { name: '再開', exact: true })).toBeVisible();
    }
  }
});
