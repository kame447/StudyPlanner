import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const cases = [
  { width: 320, height: 568, theme: 'light', appearance: 'standard' },
  { width: 390, height: 844, theme: 'light', appearance: 'standard' },
  { width: 430, height: 932, theme: 'dark', appearance: 'standard' },
  { width: 768, height: 1024, theme: 'light', appearance: 'standard' },
  { width: 1280, height: 800, theme: 'dark', appearance: 'standard' },
  { width: 390, height: 844, theme: 'dark', appearance: 'pixel' },
  { width: 320, height: 568, theme: 'light', appearance: 'standard', enlarged: true },
];

async function seed(page, scenario) {
  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  await page.addInitScript(({ today, theme, appearance, enlarged }) => {
    const now = new Date().toISOString();
    const user = { id: 'compact-forms', email: 'forms@example.test', username: 'Forms', avatar: '', createdAt: now };
    const title = enlarged ? '長い予定名と入力内容を省略せず確認するための記録'.repeat(3) : '塾バイト';
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([{
      id: 'compact-plan', seriesId: 'compact-plan', userId: user.id, title, subject: '主要予定', type: 'other',
      date: today, startTime: '17:00', endTime: '21:30', memo: '', repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now,
    }]));
    localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{
      id: 'compact-todo', userId: user.id, title: '研究室に進捗共有', subject: '研究', type: 'study',
      estimatedMinutes: 15, dueDate: today, dueTime: '23:00', memo: '今日進めた内容を共有',
      status: 'open', scheduledPlanId: null, createdAt: now, updatedAt: now,
    }]));
    for (const key of ['studyplanner.actuals', 'studyplanner.monthEvents', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('study-planner-appearance', appearance);
  }, { ...scenario, today: E2E_TODAY });
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
}

async function expectReadableControls(form) {
  // Measure settled geometry, including delayed entry animations on controls.
  // Do not weaken the 44px target contract or disable product motion.
  await expect.poll(() => form.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running'
      && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
  const metrics = await form.evaluate(element => ({
    overflow: element.scrollWidth - element.clientWidth,
    buttons: [...element.querySelectorAll('button, summary')].filter(control => control.getClientRects().length > 0).map(control => ({
      width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height,
    })),
    controls: [...element.querySelectorAll('input, select, textarea')].map(control => ({
      height: control.getBoundingClientRect().height,
      font: parseFloat(getComputedStyle(control).fontSize),
      width: control.getBoundingClientRect().width,
      parentWidth: control.parentElement.getBoundingClientRect().width,
    })),
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(1);
  for (const button of metrics.buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  for (const control of metrics.controls) {
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.font).toBeGreaterThanOrEqual(16);
    expect(control.width).toBeLessThanOrEqual(control.parentWidth + 1);
  }
}

async function expectSameRow(first, second) {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x);
}

async function expectResponsivePair(first, second) {
  const fit = await first.evaluate(element => {
    const pair = element.parentElement.parentElement;
    const gap = parseFloat(getComputedStyle(pair).columnGap);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return pair.clientWidth >= 14 * rem + gap;
  });
  if (fit) await expectSameRow(first, second);
  else {
    const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  }
}

for (const scenario of cases) {
  test(`compact record and Todo forms: ${scenario.width}px ${scenario.theme} ${scenario.appearance}${scenario.enlarged ? ' 200% text' : ''}`, async ({ page }, testInfo) => {
    await seed(page, scenario);
    await page.getByRole('tab', { name: '日', exact: true }).click();
    await page.locator('.timeline-plan-block').click();
    await page.getByRole('button', { name: '記録を保存', exact: true }).click();
    const record = page.locator('.schedule-record-sheet');
    await expect(record).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', scenario.appearance);
    if (scenario.appearance === 'pixel') {
      await expect.poll(() => record.evaluate(element => getComputedStyle(element).fontFamily)).toContain('DotGothic16');
      await page.evaluate(() => document.fonts.ready);
    }
    if (scenario.enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectReadableControls(record);
    await expect(record.locator('.actual-editor-head strong')).toHaveCount(1);
    await expect(record.locator('.actual-editor-summary-card')).toHaveCount(0);
    await expect(record.getByRole('button', { name: '記録保存', exact: true })).toHaveCount(1);
    await expectResponsivePair(record.getByLabel('開始', { exact: true }), record.getByLabel('終了', { exact: true }));
    if (!scenario.enlarged) {
      expect((await record.locator('.actual-editor-head').boundingBox()).height).toBeLessThanOrEqual(136);
    }
    await expect(record.getByRole('button', { name: '予定通り', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await testInfo.attach('Compact actual record form', { body: await page.screenshot(), contentType: 'image/png' });
    await record.getByRole('button', { name: '違う内容', exact: true }).click();
    await record.getByLabel('実際にやった内容', { exact: true }).fill('変更した内容');
    await record.getByLabel('ズレの理由・メモ', { exact: true }).fill('保持する記録メモ');
    await record.getByRole('button', { name: '記録保存', exact: true }).click();
    await expect(record).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]')[0]))
      .toMatchObject({ title: '変更した内容', note: '保持する記録メモ', isAlignedToPlan: false });

    await page.getByRole('tab', { name: 'Todo', exact: true }).click();
    const row = page.locator('.todo-view-item').filter({ hasText: '研究室に進捗共有' });
    await row.getByRole('button', { name: '編集', exact: true }).click();
    const todo = page.locator('.todo-edit-modal:not(.todo-schedule-modal)');
    await expectReadableControls(todo);
    const background = await todo.evaluate(element => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { actual: style.backgroundImage, expected: getComputedStyle(document.documentElement).backgroundImage,
        colorAlpha: context.getImageData(0, 0, 1, 1).data[3] };
    });
    if (scenario.appearance === 'pixel') expect(background.colorAlpha).toBe(255);
    else {
      expect(background.actual).toBe(background.expected);
      expect(background.actual).toContain('linear-gradient');
    }
    const type = todo.getByRole('combobox', { name: '種別', exact: true });
    await expect(type).toHaveAccessibleName('種別');
    await expect(type).toHaveValue('study');
    await expectResponsivePair(type, todo.getByRole('spinbutton', { name: '所要時間（分）', exact: true }));
    if (!scenario.enlarged) {
      if (scenario.width >= 390) await expectSameRow(todo.getByLabel('締切日', { exact: true }), todo.getByLabel('締切時刻', { exact: true }));
    }
    await testInfo.attach('Compact Todo editor', { body: await page.screenshot(), contentType: 'image/png' });
    await todo.getByLabel('タイトル', { exact: true }).fill('取消する変更');
    await todo.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(todo).toHaveCount(0);
    await expect(row).toContainText('研究室に進捗共有');
    await row.getByRole('button', { name: '編集', exact: true }).click();
    await todo.getByLabel('所要時間（分）', { exact: true }).fill('30');
    await todo.getByLabel('メモ', { exact: true }).fill('保持するTodoメモ');
    await todo.getByRole('button', { name: '保存', exact: true }).click();
    await expect(todo).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1') ?? '[]')[0]))
      .toMatchObject({ title: '研究室に進捗共有', estimatedMinutes: 30, memo: '保持するTodoメモ', dueDate: E2E_TODAY, dueTime: '23:00' });
  });
}
