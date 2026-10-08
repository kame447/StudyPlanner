import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

async function attachScreen(page, testInfo, name) {
  const path = testInfo.outputPath('attachments', `${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function expectScreenStartsBelowHeader(dialog) {
  await expect.poll(() => dialog.locator('.study-session-page').evaluate(element => element.scrollTop)).toBe(0);
  const bounds = await dialog.evaluate(element => {
    const header = element.querySelector('.study-session-header');
    const summary = element.querySelector('.study-session-content > section');
    const style = getComputedStyle(header);
    const title = summary.querySelector('h2').getBoundingClientRect();
    return { headerBottom: header.getBoundingClientRect().bottom, summaryTop: summary.getBoundingClientRect().top,
      titleTop: title.top, titleBottom: title.bottom, viewportHeight: window.innerHeight,
      backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
  });
  console.log('Study screen navigation bounds:', JSON.stringify(bounds));
  expect(bounds.summaryTop).toBeGreaterThanOrEqual(bounds.headerBottom - 1);
  expect(bounds.titleTop).toBeGreaterThanOrEqual(bounds.headerBottom - 1);
  expect(bounds.titleBottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.backgroundImage !== 'none' || bounds.backgroundColor !== 'rgba(0, 0, 0, 0)').toBe(true);
}

async function inspectRecordLayout(record) {
  return record.evaluate(element => {
    const measure = node => {
      const scrollWidth = node.scrollWidth;
      const clientWidth = node.clientWidth;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { tag: node.tagName, className: node.className, scrollWidth, clientWidth,
        left: rect.left, right: rect.right, width: rect.width,
        transform: style.transform, translate: style.translate,
        animation: style.animation, minWidth: style.minWidth, overflowX: style.overflowX };
    };
    const root = measure(element);
    const pane = element.querySelector('.study-session-page');
    const overflowing = [...element.querySelectorAll('*')].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.right > root.right + 1 || rect.left < root.left - 1 || node.scrollWidth > node.clientWidth + 1);
    }).map(measure);
    return { root, pane: measure(pane), overflowing, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animations: pane.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime })) };
  });
}

async function seed(page, { kind = 'empty', material = false, dark = false } = {}) {
  await page.addInitScript(({ kind, material, date, dark }) => {
    localStorage.setItem('study-planner-theme-mode', dark ? 'dark' : 'light');
    const user = { id: 'unplanned-user', email: 'unplanned@example.test', username: 'Study', avatar: '', createdAt: new Date().toISOString() };
    const plan = { id: 'next-plan', seriesId: 'next-plan', userId: user.id, title: kind === 'class' ? '数学の授業' : '予定の学習', subject: '数学', type: 'study', date, startTime: '11:00', endTime: '12:00', memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], sourceType: kind === 'class' ? 'timetable' : 'manual', createdAt: user.createdAt, updatedAt: user.createdAt };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(kind === 'empty' ? [] : [plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(material ? [{ id: 'book', userId: user.id, name: '数学の本', subjectId: 'math', subjectName: '数学', status: 'active', paceEnabled: true, progressUnit: 'page', currentUnit: 10, totalUnits: 100, createdAt: user.createdAt, updatedAt: user.createdAt }] : []));
  }, { kind, material, date: E2E_TODAY, dark });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const { reducedMotion, dark } of ['no-preference', 'reduce'].flatMap(reducedMotion => [false, true].map(dark => ({ reducedMotion, dark })))) test(`unplanned study without any setup saves one Actual at ${viewport.width}px (${reducedMotion}, ${dark ? 'dark' : 'light'})`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion });
    await seed(page, { dark });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reducedMotion === 'reduce');
    await page.getByRole('button', { name: /勉強を開始/ }).click();
    const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
    await ready.getByRole('textbox', { name: '勉強する内容' }).fill('今から復習');
    await expect(ready.getByRole('combobox', { name: '教材', exact: true })).toHaveValue('');
    await expect.poll(() => ready.locator('.study-session-page').evaluate(element => element.getAnimations().length)).toBe(0);
    if (reducedMotion === 'reduce') await expect(ready.locator('.study-session-page')).toHaveCSS('animation-name', 'none');
    await attachScreen(page, testInfo, `unplanned-study-ready-${viewport.width}`);
    // Phase/focus checks require a running timer; the separate rapid-start case covers dblclick.
    await ready.getByRole('button', { name: 'スタート', exact: true }).click();
    const running = page.getByRole('dialog', { name: '学習中', exact: true });
    const pause = running.getByRole('button', { name: '一時停止', exact: true });
    await expect(pause).toBeVisible();
    await running.locator('.study-session-page').evaluate(element => { element.scrollTop = 120; });
    await pause.focus();
    const readerScroll = await running.locator('.study-session-page').evaluate(element => element.scrollTop);
    expect(readerScroll).toBeGreaterThan(0);
    await page.clock.fastForward(125_000);
    await expect(pause).toBeFocused();
    expect(await running.locator('.study-session-page').evaluate(element => element.scrollTop)).toBe(readerScroll);
    await pause.click();
    await running.getByRole('button', { name: '再開', exact: true }).click();
    expect(await running.locator('.study-session-page').evaluate(element => element.scrollTop)).toBe(readerScroll);
    await running.getByRole('button', { name: '終了する', exact: true }).click();
    const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await expect(record).toContainText(E2E_TODAY);
    await expectScreenStartsBelowHeader(record);
    const overflow = await record.evaluate(element => element.scrollWidth > element.clientWidth + 1);
    const initialLayout = await inspectRecordLayout(record);
    console.log('Unplanned record initial layout:', JSON.stringify(initialLayout));
    await attachScreen(page, testInfo, `unplanned-study-record-${viewport.width}`);
    expect(overflow).toBe(false);
    expect(initialLayout.pane.scrollWidth).toBeLessThanOrEqual(initialLayout.pane.clientWidth + 1);
    expect(initialLayout.overflowing).toEqual([]);
    const note = record.getByRole('textbox', { name: 'メモ・気づき' });
    // A real click and first key may reveal an offscreen textarea in WebKit.
    // Establish that visible editing position before testing application rerenders.
    const needsReveal = await note.evaluate(element => element.getBoundingClientRect().bottom > window.innerHeight);
    await note.click();
    await note.fill('画面を戻っても保持するメモ');
    await note.press('End');
    await expect(note).toHaveValue('画面を戻っても保持するメモ');
    await expect(note).toBeFocused();
    await expect(note).toBeInViewport({ ratio: 1 });
    const editing = await note.evaluate(element => {
      const pane = element.closest('.study-session-page');
      const rect = element.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const header = pane.querySelector('.study-session-header').getBoundingClientRect();
      return { pageScroll: pane.scrollTop, top: rect.top, bottom: rect.bottom,
        left: rect.left, right: rect.right, paneLeft: paneRect.left, paneRight: paneRect.right,
        headerBottom: header.bottom, viewportHeight: window.innerHeight,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        caretStart: element.selectionStart, caretEnd: element.selectionEnd, length: element.value.length };
    });
    console.log('Study note visible editing baseline:', JSON.stringify({ needsReveal, ...editing }));
    if (needsReveal) expect(editing.pageScroll).toBeGreaterThan(0);
    expect(editing.top).toBeGreaterThanOrEqual(editing.headerBottom - 1);
    expect(editing.bottom).toBeLessThanOrEqual(editing.viewportHeight);
    expect(editing.left).toBeGreaterThanOrEqual(editing.paneLeft - 1);
    expect(editing.right).toBeLessThanOrEqual(editing.paneRight + 1);
    expect(editing.scrollWidth).toBeLessThanOrEqual(editing.clientWidth + 1);
    expect(editing.scrollHeight).toBeLessThanOrEqual(editing.clientHeight + 1);
    expect(editing.caretStart).toBe(editing.length);
    expect(editing.caretEnd).toBe(editing.length);
    await note.press('!');
    await expect(note).toHaveValue('画面を戻っても保持するメモ!');
    await expect(note).toBeFocused();
    await expect(note).toBeInViewport({ ratio: 1 });
    expect(await record.locator('.study-session-page').evaluate(element => element.scrollTop)).toBe(editing.pageScroll);
    await page.clock.fastForward(1_000);
    await expect(note).toBeFocused();
    await expect(note).toHaveValue('画面を戻っても保持するメモ!');
    expect(await record.locator('.study-session-page').evaluate(element => element.scrollTop)).toBe(editing.pageScroll);
    for (let roundTrip = 0; roundTrip < 2; roundTrip++) {
      await record.locator('.study-session-page').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => record.locator('.study-session-page').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await record.getByRole('button', { name: '戻る', exact: true }).click();
      const timer = page.getByRole('dialog', { name: '学習中', exact: true });
      await expectScreenStartsBelowHeader(timer);
      await timer.getByRole('button', { name: '終了する', exact: true }).click();
      await expectScreenStartsBelowHeader(record);
      await expect(note).toHaveValue('画面を戻っても保持するメモ!');
    }
    await record.locator('summary').click();
    await expect(record.getByLabel('開始', { exact: true })).toBeVisible();
    await expect(record.getByLabel('終了', { exact: true })).toBeVisible();
    const adjustedLayout = await inspectRecordLayout(record);
    console.log('Unplanned record time-adjust layout:', JSON.stringify(adjustedLayout));
    expect(adjustedLayout.root.scrollWidth).toBeLessThanOrEqual(adjustedLayout.root.clientWidth + 1);
    expect(adjustedLayout.pane.scrollWidth).toBeLessThanOrEqual(adjustedLayout.pane.clientWidth + 1);
    expect(adjustedLayout.overflowing).toEqual([]);
    await record.getByRole('button', { name: '記録を保存', exact: true }).dblclick();
    await expect(record).toHaveCount(0);
    const saved = await page.evaluate(() => ({ actuals: JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'), plans: JSON.parse(localStorage.getItem('studyplanner.plans') ?? '[]') }));
    expect(saved.plans).toEqual([]);
    expect(saved.actuals).toHaveLength(1);
    expect(saved.actuals[0]).toMatchObject({ planId: null, title: '今から復習', occurrenceDate: E2E_TODAY, isAlignedToPlan: false });
  });
}

// Preserve the original two-width, two-motion rapid-start/save coverage independently
// of the phase-navigation precondition. The second click reaches the new pause control.
for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const reducedMotion of ['no-preference', 'reduce']) test(`rapid unplanned start resumes its paused timer and saves once at ${viewport.width}px (${reducedMotion})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion });
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: /勉強を開始/ }).click();
    const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
    await ready.getByRole('textbox', { name: '勉強する内容' }).fill('連続開始の復習');
    await ready.getByRole('button', { name: 'スタート', exact: true }).dblclick();
    const running = page.getByRole('dialog', { name: '学習中', exact: true });
    await expect(page.locator('.study-session-page')).toHaveCount(1);
    const resume = running.getByRole('button', { name: '再開', exact: true });
    await expect(resume).toBeVisible();
    console.log('Rapid unplanned start state:', { viewport: viewport.width, reducedMotion, control: await resume.innerText() });
    const elapsed = running.locator('[data-study-session-elapsed]');
    const pausedElapsed = await elapsed.innerText();
    await page.clock.fastForward(5_000);
    await expect(elapsed).toHaveText(pausedElapsed);
    await resume.click();
    await expect(running.getByRole('button', { name: '一時停止', exact: true })).toBeVisible();
    await page.clock.fastForward(125_000);
    await expect(elapsed).not.toHaveText(pausedElapsed);
    await running.getByRole('button', { name: '終了する', exact: true }).click();
    const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await expectScreenStartsBelowHeader(record);
    await record.getByRole('button', { name: '記録を保存', exact: true }).dblclick();
    await expect(record).toHaveCount(0);
    const saved = await page.evaluate(() => ({ actuals: JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'), plans: JSON.parse(localStorage.getItem('studyplanner.plans') ?? '[]') }));
    expect(saved.plans).toEqual([]);
    expect(saved.actuals).toHaveLength(1);
    expect(saved.actuals[0]).toMatchObject({ planId: null, title: '連続開始の復習', occurrenceDate: E2E_TODAY, isAlignedToPlan: false });
  });
}

test('class title remains keyboard-operable while Home starts unrelated study', async ({ page }) => {
  await seed(page, { kind: 'class', material: true });
  await page.goto('/');
  const inspect = page.getByRole('button', { name: '授業を確認する: 数学の授業', exact: true });
  await inspect.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '学習を開始', exact: true })).toHaveCount(0);
  await expect(page.locator('.home-next-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'ホーム', exact: true }).click();
  await page.getByRole('button', { name: /勉強を開始/ }).click();
  await expect(page.getByRole('combobox', { name: '学習内容', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '教材', exact: true }).selectOption('book');
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.clock.fastForward(65_000);
  await page.getByRole('button', { name: '終了する', exact: true }).click();
  await page.getByLabel('進捗', { exact: true }).fill('5');
  await page.getByRole('button', { name: '記録を保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '学習を記録', exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => ({ actuals: JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'), materials: JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1') ?? '[]') }));
  expect(saved.actuals[0]).toMatchObject({ planId: null, materialId: 'book' });
  expect(saved.materials[0].currentUnit).toBe(15);
});

test('a next study offers a visible choice before recording unrelated learning', async ({ page }) => {
  await seed(page, { kind: 'study' });
  await page.goto('/');
  await page.getByRole('button', { name: /勉強を開始/ }).click();
  const choice = page.getByRole('combobox', { name: '学習内容', exact: true });
  await expect(choice).toHaveValue('planned');
  await expect(page.getByRole('dialog', { name: '学習を開始', exact: true })).toContainText(E2E_TODAY);
  await expect(choice.locator('option:checked')).toHaveText('この予定で学習: 予定の学習');
  await choice.selectOption('unplanned');
  await page.getByRole('textbox', { name: '勉強する内容' }).fill('別の学習');
  await page.getByRole('button', { name: 'スタート', exact: true }).click();
  await page.clock.fastForward(65_000);
  await page.getByRole('button', { name: '終了する', exact: true }).click();
  await page.getByRole('button', { name: '記録を保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '学習を記録', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'))).toEqual([expect.objectContaining({ planId: null, title: '別の学習' })]);
});
