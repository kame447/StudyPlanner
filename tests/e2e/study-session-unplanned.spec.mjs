import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

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
  test(`unplanned study without any setup saves one Actual at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await seed(page);
    await page.goto('/');
    await page.getByRole('button', { name: /勉強を開始/ }).click();
    const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
    await ready.getByRole('textbox', { name: '勉強する内容' }).fill('今から復習');
    await expect(ready.getByRole('combobox', { name: '教材', exact: true })).toHaveValue('');
    await testInfo.attach(`unplanned-study-ready-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await ready.getByRole('button', { name: 'スタート', exact: true }).dblclick();
    await page.clock.fastForward(125_000);
    await page.getByRole('button', { name: '終了する', exact: true }).click();
    const record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await expect(record).toContainText(E2E_TODAY);
    const overflow = await record.evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
    await testInfo.attach(`unplanned-study-record-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
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
