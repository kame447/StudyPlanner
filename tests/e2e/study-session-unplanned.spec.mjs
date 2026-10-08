import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

async function attachScreen(page, testInfo, name) {
  const path = testInfo.outputPath('attachments', `${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
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

async function seed(page, { kind = 'empty', material = false } = {}) {
  await page.addInitScript(({ kind, material, date }) => {
    const user = { id: 'unplanned-user', email: 'unplanned@example.test', username: 'Study', avatar: '', createdAt: new Date().toISOString() };
    const plan = { id: 'next-plan', seriesId: 'next-plan', userId: user.id, title: kind === 'class' ? '数学の授業' : '予定の学習', subject: '数学', type: 'study', date, startTime: '11:00', endTime: '12:00', memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], sourceType: kind === 'class' ? 'timetable' : 'manual', createdAt: user.createdAt, updatedAt: user.createdAt };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify(kind === 'empty' ? [] : [plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(material ? [{ id: 'book', userId: user.id, name: '数学の本', subjectId: 'math', subjectName: '数学', status: 'active', paceEnabled: true, progressUnit: 'page', currentUnit: 10, totalUnits: 100, createdAt: user.createdAt, updatedAt: user.createdAt }] : []));
  }, { kind, material, date: E2E_TODAY });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const reducedMotion of ['no-preference', 'reduce']) test(`unplanned study without any setup saves one Actual at ${viewport.width}px (${reducedMotion})`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion });
    await seed(page);
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reducedMotion === 'reduce');
    await page.getByRole('button', { name: /勉強を開始/ }).click();
    const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
    await ready.getByRole('textbox', { name: '勉強する内容' }).fill('今から復習');
    await expect(ready.getByRole('combobox', { name: '教材', exact: true })).toHaveValue('');
    await expect.poll(() => ready.locator('.study-session-page').evaluate(element => element.getAnimations().length)).toBe(0);
    if (reducedMotion === 'reduce') await expect(ready.locator('.study-session-page')).toHaveCSS('animation-name', 'none');
    await attachScreen(page, testInfo, `unplanned-study-ready-${viewport.width}`);
    await ready.getByRole('button', { name: 'スタート', exact: true }).dblclick();
    await page.clock.fastForward(125_000);
    await page.getByRole('button', { name: '終了する', exact: true }).click();
    const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await expect(record).toContainText(E2E_TODAY);
    const overflow = await record.evaluate(element => element.scrollWidth > element.clientWidth + 1);
    const initialLayout = await inspectRecordLayout(record);
    console.log('Unplanned record initial layout:', JSON.stringify(initialLayout));
    await attachScreen(page, testInfo, `unplanned-study-record-${viewport.width}`);
    expect(overflow).toBe(false);
    expect(initialLayout.pane.scrollWidth).toBeLessThanOrEqual(initialLayout.pane.clientWidth + 1);
    expect(initialLayout.overflowing).toEqual([]);
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
