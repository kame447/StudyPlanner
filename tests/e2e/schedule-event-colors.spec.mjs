import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const TITLE = '塾バイト';
async function seed(page, theme) {
  await page.addInitScript(({ date, theme, title }) => {
    if (localStorage.getItem('event-colors-seeded')) return;
    const owner = 'event-colors-owner';
    const now = new Date().toISOString();
    const base = { userId: owner, date, endDate: date, repeat: 'weekly', repeatUntil: null,
      excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: now, updatedAt: now };
    const entries = {
      'studyplanner.users': [{ id: owner, email: 'event-colors@example.test', username: '予定色', avatar: '', createdAt: now }],
      'studyplanner.monthEvents': [
        { ...base, id: 'shift-1', title, startTime: '17:00', endTime: '21:30' },
        { ...base, id: 'earlier-event', title: '先の予定', startTime: '15:00', endTime: '16:30' },
      ],
      'studyplanner.plans': [], 'studyplanner.actuals': [], 'studyplanner.todos.v1': [],
      'studyplanner.studySubjects.v1': [], 'studyplanner.studyMaterials.v1': [],
      'studyplanner.scheduleTemplates.v1': [], 'studyplanner.timetableTerms.v1': [],
    };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem('studyplanner.session', owner);
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('event-colors-seeded', 'true');
  }, { date: E2E_TODAY, theme, title: TITLE });
}

async function background(locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate(element => getComputedStyle(element).backgroundColor);
}
async function expectTint(locator, accent) {
  await expect(locator).toBeVisible();
  const paint = await locator.evaluate((element, color) => {
    const reference = document.createElement('span');
    reference.style.background = `color-mix(in srgb, ${color} 24%, var(--surface) 76%)`;
    element.append(reference);
    const expected = getComputedStyle(reference).backgroundColor;
    reference.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  }, accent);
  expect(paint.actual).toBe(paint.expected);
  expect(paint.actual).not.toBe('rgba(0, 0, 0, 0)');
}
const nav = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name, exact: true });

async function openSelectionEditor(page, reducedMotion) {
  await page.emulateMedia({ reducedMotion });
  await seed(page, 'light');
  await page.goto('/');
  // Observe real CSS animations as React inserts each selected title. Pause
  // those animations for deterministic sampling; never replace their timing,
  // keyframes, or CSS, and never depend on catching a 300 ms wall-clock window.
  await page.evaluate(() => {
    window.__selectionMotionProbe = [];
    const seen = new WeakSet();
    const observer = new MutationObserver(() => {
      for (const element of document.querySelectorAll('.month-event-title-selected .month-event-title-field input')) {
        if (seen.has(element)) continue;
        seen.add(element);
        const animation = element.getAnimations().find(item => item.animationName === 'month-event-title-selection');
        const startedAs = animation?.playState ?? null;
        if (animation) {
          animation.pause();
          animation.currentTime = 0;
        }
        window.__selectionMotionProbe.push({ element, animation, startedAs });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await nav(page, '予定').click();
  await page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]').click();
  await page.locator('.month-day-sheet-event').filter({ hasText: TITLE }).click();
  const editor = page.locator('.month-event-modal');
  await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue(TITLE);
  return editor;
}

async function sampleTitleMotion(title, selectionCount) {
  await expect.poll(() => title.evaluate(() => window.__selectionMotionProbe.length)).toBe(selectionCount);
  const result = await title.evaluate(async element => {
    const probe = window.__selectionMotionProbe.at(-1);
    const animation = probe.animation;
    if (!animation) return { missingAnimation: true };
    await animation.ready;
    const timing = animation.effect.getTiming();
    const frames = [0, 150, 300].map(time => {
      animation.currentTime = time;
      const style = getComputedStyle(element);
      return { time, y: new DOMMatrix(style.transform).m42, background: style.backgroundColor };
    });
    // Keep the native animation midway through its cue while the next user
    // action runs, so typing must preserve both the node and animation state.
    animation.currentTime = 150;
    return {
      sameElement: probe.element === element, startedAs: probe.startedAs,
      name: animation.animationName, duration: timing.duration,
      easing: getComputedStyle(element).animationTimingFunction, iterations: timing.iterations, frames,
    };
  });
  expect(result).toMatchObject({ sameElement: true, startedAs: 'running',
    name: 'month-event-title-selection', duration: 300, easing: 'ease-out', iterations: 1 });
  expect(result.frames[0].y).toBeCloseTo(3, 5);
  expect(result.frames[1].y).toBeGreaterThan(0);
  expect(result.frames[1].y).toBeLessThan(3);
  expect(result.frames[2].y).toBeCloseTo(0, 5);
  expect(result.frames[0].background).not.toBe(result.frames[2].background);
  expect(result.frames[1].background).not.toBe(result.frames[0].background);
  expect(result.frames[1].background).not.toBe(result.frames[2].background);
  return result;
}

for (const width of [390, 1280]) {
  test.describe(`selected event title motion ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test('animates each event switch and reselection without restarting while typing', async ({ page }, testInfo) => {
      const editor = await openSelectionEditor(page, 'no-preference');
      const title = editor.getByLabel('タイトル', { exact: true });
      const row = name => editor.locator('.month-event-timeline-item').filter({ hasText: name });
      const samples = [await sampleTitleMotion(title, 1)];
      await expect(row(TITLE)).toHaveAttribute('aria-pressed', 'true');
      await title.fill('入力途中の予定');
      await expect(title).toBeFocused();
      expect(await title.evaluate(element => {
        const probe = window.__selectionMotionProbe.at(-1);
        return { count: window.__selectionMotionProbe.length, sameElement: probe.element === element,
          sameAnimation: element.getAnimations().includes(probe.animation), time: probe.animation.currentTime };
      })).toEqual({ count: 1, sameElement: true, sameAnimation: true, time: 150 });
      for (const [name, count] of [['先の予定', 2], [TITLE, 3]]) {
        await row(name).click();
        await expect(title).toHaveValue(name);
        await expect(row(name)).toHaveAttribute('aria-pressed', 'true');
        samples.push(await sampleTitleMotion(title, count));
      }
      const settled = await title.evaluate(element => {
        const animation = window.__selectionMotionProbe.at(-1).animation;
        animation.finish();
        const style = getComputedStyle(element);
        return { state: animation.playState, y: new DOMMatrix(style.transform).m42,
          active: element.getAnimations().filter(item => item.animationName === 'month-event-title-selection').length };
      });
      expect(settled).toEqual({ state: 'finished', y: 0, active: 0 });
      await editor.getByRole('button', { name: '追加', exact: true }).click();
      await expect(title).toHaveValue('');
      await expect(title).toHaveCSS('animation-name', 'none');
      await expect(editor.locator('.month-event-timeline-item[aria-pressed="true"]')).toHaveCount(0);
      expect(await title.evaluate(element => ({ active: element.getAnimations().length,
        selectedMounts: window.__selectionMotionProbe.length }))).toEqual({ active: 0, selectedMounts: 3 });
      await testInfo.attach('selected-title-motion-computed-frames', {
        contentType: 'application/json', body: JSON.stringify({ width, reducedMotion: 'no-preference', samples, settled }),
      });
    });

    test('keeps selection visible with no title animation when reduced motion is requested', async ({ page }, testInfo) => {
      const editor = await openSelectionEditor(page, 'reduce');
      const title = editor.getByLabel('タイトル', { exact: true });
      const samples = [];
      for (const name of [TITLE, '先の予定', TITLE]) {
        const row = editor.locator('.month-event-timeline-item').filter({ hasText: name });
        await row.click();
        await expect(title).toHaveValue(name);
        await expect(row).toHaveAttribute('aria-pressed', 'true');
        const sample = await title.evaluate(element => {
          const style = getComputedStyle(element);
          return { animation: style.animationName, y: new DOMMatrix(style.transform).m42,
            active: element.getAnimations().length,
            hasSelectionCue: element.closest('.month-event-title-selected') !== null };
        });
        expect(sample).toEqual({ animation: 'none', y: 0, active: 0, hasSelectionCue: true });
        samples.push(sample);
      }
      await title.fill('動きを減らして入力');
      await expect(title).toBeFocused();
      await expect(title).toHaveValue('動きを減らして入力');
      expect(await title.evaluate(() => window.__selectionMotionProbe.every(probe => !probe.animation))).toBe(true);
      await editor.getByRole('button', { name: '追加', exact: true }).click();
      await expect(title).toHaveValue('');
      await expect(title).toHaveCSS('animation-name', 'none');
      await testInfo.attach('selected-title-reduced-motion', {
        contentType: 'application/json', body: JSON.stringify({ width, reducedMotion: 'reduce', samples }),
      });
    });
  });
}

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test.describe(`saved event color ${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
      test('paints the same event hue across all six surfaces and after reload', async ({ page }, testInfo) => {
        await seed(page, theme);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await nav(page, '予定').click();
        const cell = page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]');
        const pill = cell.locator('.month-major-event-pill').filter({ hasText: TITLE });
        await expect(pill).toBeVisible();
        await cell.click();
        const sheetEntry = page.locator('.month-day-sheet-event').filter({ hasText: TITLE });
        const accent = await background(sheetEntry.locator('.month-day-sheet-bar'));
        expect(accent).not.toBe('rgba(0, 0, 0, 0)');
        await sheetEntry.click();
        const editor = page.locator('.month-event-modal');
        const editorBar = editor.locator('.month-event-timeline-item').filter({ hasText: TITLE }).locator('.month-event-timeline-bar');
        expect(await background(editorBar)).toBe(accent);
        const trigger = editor.locator('.month-event-color-trigger');
        expect(await background(trigger.locator('.month-event-color-dot'))).toBe(accent);
        await page.screenshot({ path: testInfo.outputPath('editor-colors.png'), animations: 'disabled' });
        await trigger.click();
        const picker = page.getByRole('dialog', { name: 'ラベルを選択' });
        await expect(picker).toHaveCSS('background-color', theme === 'dark' ? 'rgb(24, 31, 35)' : 'rgb(255, 255, 255)');
        await expect(picker.getByRole('radio', { name: '自動', exact: true })).toBeChecked();
        await expect(picker.getByRole('radio', { name: '自動', exact: true })).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath('editor-color-label-list.png'), animations: 'disabled' });
        await page.keyboard.press('ArrowDown');
        await expect(picker.getByRole('radio', { name: '緑', exact: true })).toBeChecked();
        await page.keyboard.press('Escape');
        await expect(picker).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await editor.getByRole('button', { name: '閉じる', exact: true }).click();
        await expectTint(pill, accent);
        await page.screenshot({ path: testInfo.outputPath('month-colors.png'), animations: 'disabled' });
        await page.getByRole('tab', { name: '週', exact: true }).click();
        const weekBlock = page.locator('.schedule-week-block').filter({ hasText: TITLE });
        await expectTint(weekBlock, accent);
        await page.screenshot({ path: testInfo.outputPath('week-colors.png'), animations: 'disabled' });
        await page.getByRole('tab', { name: '日', exact: true }).click();
        const dayBlock = page.locator('.timeline-plan-block').filter({ hasText: TITLE });
        await dayBlock.scrollIntoViewIfNeeded();
        await expectTint(dayBlock, accent);
        await page.screenshot({ path: testInfo.outputPath('day-colors.png'), animations: 'disabled' });
        await nav(page, 'ホーム').click();
        const homeDot = page.locator('.home-schedule-row').filter({ hasText: TITLE }).locator('.home-time-dot');
        await expectTint(homeDot, accent);
        await page.reload();
        await expectTint(homeDot, accent);
        await page.screenshot({ path: testInfo.outputPath('home-colors.png'), animations: 'disabled' });
      });
    });
  }
}

for (const width of [390, 1280]) {
  test.describe(`event editor controls ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
    test('persists explicit color and automatic reset and keeps addon fields', async ({ page }, testInfo) => {
      await seed(page, 'light');
      await page.addInitScript(() => {
        if (localStorage.getItem('editor-controls-single')) return;
        const events = JSON.parse(localStorage.getItem('studyplanner.monthEvents'));
        events.forEach(event => { event.repeat = 'none'; });
        localStorage.setItem('studyplanner.monthEvents', JSON.stringify(events));
        localStorage.setItem('editor-controls-single', 'true');
      });
      const editor = page.locator('.month-event-modal');
      const open = async () => {
        await nav(page, '予定').click();
        await page.getByRole('tab', { name: '月', exact: true }).click();
        await page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]').click();
        await page.locator('.month-day-sheet-event').filter({ hasText: TITLE }).click();
        await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue(TITLE);
      };
      await page.goto('/'); await open();
      await expect(editor.getByRole('button', { name: '追加', exact: true })).toBeVisible();
      const trigger = editor.locator('.month-event-color-trigger');
      const picker = page.getByRole('dialog', { name: 'ラベルを選択' });
      await expect(trigger).toHaveText('ラベル自動');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(picker).toHaveCount(0);
      const placement = await trigger.evaluate(element => {
        const row = element.getBoundingClientRect();
        const timeSection = element.closest('section').previousElementSibling.getBoundingClientRect();
        return { rowTop: row.top, rowBottom: row.bottom, rowHeight: row.height, timeBottom: timeSection.bottom,
          fontSize: parseFloat(getComputedStyle(element).fontSize) };
      });
      expect(placement.rowTop).toBeGreaterThanOrEqual(placement.timeBottom);
      expect(placement.rowTop - placement.timeBottom).toBeLessThan(10);
      expect(placement.rowHeight).toBeGreaterThanOrEqual(44);
      expect(placement.fontSize).toBeGreaterThanOrEqual(16);
      await trigger.click();
      await expect(picker.getByRole('radio', { name: '自動', exact: true })).toBeChecked();
      await picker.getByRole('radio', { name: '青', exact: true }).check();
      await expect(picker.getByRole('radio', { name: '青', exact: true })).toBeChecked();
      await expect(picker.getByRole('radio', { name: '自動', exact: true })).not.toBeChecked();
      const pickerBounds = await picker.boundingBox();
      expect(pickerBounds.x).toBeGreaterThanOrEqual(0);
      expect(pickerBounds.x + pickerBounds.width).toBeLessThanOrEqual(width);
      expect(pickerBounds.y).toBeGreaterThanOrEqual(0);
      expect(pickerBounds.y + pickerBounds.height).toBeLessThanOrEqual(900);
      for (const option of await picker.locator('.month-event-color-option').all()) {
        expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      await picker.getByRole('button', { name: '完了', exact: true }).click();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveText('ラベル青');
      await editor.getByRole('button', { name: /メモ/ }).click();
      await editor.getByLabel('メモ', { exact: true }).fill('色を確認');
      await editor.getByRole('button', { name: /メモ/ }).click();
      await page.screenshot({ path: testInfo.outputPath(`event-editor-controls-${width}.png`), animations: 'disabled' });
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.reload(); await open();
      await expect(trigger).toHaveText('ラベル青');
      await expect(editor.getByLabel('メモ', { exact: true })).toHaveValue('色を確認');
      await trigger.click();
      await expect(picker.getByRole('radio', { name: '青', exact: true })).toBeChecked();
      await picker.getByRole('radio', { name: '自動', exact: true }).check();
      await picker.getByRole('button', { name: '完了', exact: true }).click();
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.reload(); await open();
      await expect(trigger).toHaveText('ラベル自動');
      await trigger.click();
      await expect(picker.getByRole('radio', { name: '自動', exact: true })).toBeChecked();
    });
  });
}

test.describe('color sheet gesture isolation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, contextOptions: { reducedMotion: 'reduce' } });
  test('keeps the parent draft open when the label sheet header is dragged on a short screen', async ({ page, browserName }, testInfo) => {
    await seed(page, 'light');
    await page.goto('/');
    await nav(page, '予定').click();
    await page.getByRole('grid', { name: '月間カレンダー' }).locator('[aria-selected="true"]').click();
    await page.locator('.month-day-sheet-event').filter({ hasText: TITLE }).click();
    const editor = page.locator('.month-event-modal');
    const trigger = editor.locator('.month-event-color-trigger');
    await editor.getByLabel('タイトル', { exact: true }).fill('未保存の予定');
    await trigger.tap();
    await page.setViewportSize({ width: 320, height: 320 });
    const picker = page.getByRole('dialog', { name: 'ラベルを選択' });
    expect(await picker.evaluate(element => element.parentElement === document.body)).toBe(true);
    expect(await picker.evaluate(element => element.closest('.month-event-modal'))).toBeNull();
    await page.screenshot({ path: testInfo.outputPath('editor-color-label-list-320-top.png'), animations: 'disabled' });
    const header = await picker.locator('.month-event-color-picker-header strong').boundingBox();
    await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2 + 120, { steps: 5 });
    await page.mouse.up();
    // Chromium exposes native touch swipes through CDP. WebKit still exercises
    // the touchscreen opener and Done actions without synthetic swipe claims.
    if (browserName === 'chromium') {
      await picker.evaluate(element => {
        element.colorPickerTouchEvents = [];
        for (const type of ['touchstart', 'touchmove', 'touchend']) {
          element.addEventListener(type, event => element.colorPickerTouchEvents.push({ type, trusted: event.isTrusted }), { passive: true });
        }
      });
      const session = await page.context().newCDPSession(page);
      const x = header.x + header.width / 2;
      const y = header.y + header.height / 2;
      try {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
        for (const dy of [30, 60, 90, 120]) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const events = await picker.evaluate(element => element.colorPickerTouchEvents);
        expect(events.some(event => event.type === 'touchstart' && event.trusted)).toBe(true);
        expect(events.some(event => event.type === 'touchmove' && event.trusted)).toBe(true);
        await testInfo.attach('color-picker-native-touch-events', { contentType: 'application/json', body: JSON.stringify(events) });
      } finally { await session.detach(); }
    }
    await expect(picker).toBeVisible();
    await expect(editor).toHaveCount(1);
    await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('未保存の予定');
    const lastChoice = picker.getByRole('radio', { name: 'ピンク', exact: true });
    await lastChoice.scrollIntoViewIfNeeded();
    await expect(lastChoice).toBeInViewport();
    await lastChoice.tap();
    await expect(lastChoice).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('editor-color-label-list-320-bottom.png'), animations: 'disabled' });
    await picker.getByRole('button', { name: '完了', exact: true }).tap();
    await expect(trigger).toBeFocused();
    await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('未保存の予定');
    await trigger.tap();
    await expect(lastChoice).toBeChecked();
    await expect(lastChoice).toBeFocused();
    await expect(lastChoice).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('editor-color-label-list-320-reopened-pink.png'), animations: 'disabled' });
    await picker.getByRole('button', { name: '完了', exact: true }).tap();
    await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('未保存の予定');
  });
});

test.describe('calendar swipe navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, contextOptions: { reducedMotion: 'reduce' } });
  test('changes month and week horizontally while ignoring vertical and cancelled gestures', async ({ page }, testInfo) => {
    await seed(page, 'light'); await page.goto('/'); await nav(page, '予定').click();
    const period = page.locator('.schedule-period-picker-trigger');
    const swipe = async (surface, dx, dy, cancel = false) => surface.evaluate((element, { dx, dy, cancel }) => {
      const fire = (type, x, y) => {
        // WebKit does not expose a constructible Touch. Match the existing day-swipe harness.
        const touch = { identifier: 1, target: element, clientX: x, clientY: y };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: type === 'touchstart' || type === 'touchmove' ? [touch] : [] });
        Object.defineProperty(event, 'changedTouches', { value: [touch] });
        element.dispatchEvent(event);
      };
      fire('touchstart', 190, 250); fire('touchmove', 190 + dx, 250 + dy); fire(cancel ? 'touchcancel' : 'touchend', 190 + dx, 250 + dy);
    }, { dx, dy, cancel });
    for (const [tab, selector] of [['月', '.schedule-month-view'], ['週', '.schedule-week-view']]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const surface = page.locator(selector); const original = await period.innerText();
      await swipe(surface, 10, 120); await expect(period).toHaveText(original);
      await swipe(surface, -120, 0, true); await expect(period).toHaveText(original);
      await swipe(surface, -120, 0); await expect(period).not.toHaveText(original);
      await page.screenshot({ path: testInfo.outputPath(`calendar-swipe-${tab === '月' ? 'month' : 'week'}.png`), animations: 'disabled' });
      await swipe(surface, 120, 0); await expect(period).toHaveText(original);
    }
  });
});
