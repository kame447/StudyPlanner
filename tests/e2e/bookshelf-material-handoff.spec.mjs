import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

async function seed(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('bookshelf-handoff-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'bookshelf-handoff-user', email: 'bookshelf-handoff@example.com', username: '教材確認', avatar: '', createdAt: now };
    const material = {
      id: 'bookshelf-handoff-a', userId: user.id, name: '独自教材 A', subjectId: 'bookshelf-subject',
      subjectName: '情報科学', color: '#2f6fc2', status: 'active', paceEnabled: false,
      progressUnit: 'page', totalUnits: 100, currentUnit: 0, targetDate: null, createdAt: now, updatedAt: now,
    };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1']) localStorage.setItem(key, '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([
      material, { ...material, id: 'bookshelf-handoff-b', name: '独自教材 B', subjectName: '数学' },
    ]));
    localStorage.setItem('bookshelf-handoff-seeded', '1');
  });
}
async function openBookshelf(page) {
  await page.locator('.primary-bottom-nav').getByRole('button', { name: '教材', exact: true }).click();
  await expect(page.getByRole('heading', { name: '教材', exact: true })).toBeVisible();
}
async function openMaterial(page, name) {
  await page.getByRole('button', { name: `${name}を開く`, exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '教材の詳細', exact: true })).toBeVisible();
}
async function readPlanEvents(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') || '[]')
    .filter(event => event.userId === 'bookshelf-handoff-user' && event.plan));
}

for (const [device, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  test(`${device}: Bookshelf material actions preserve selection through save and full-App reload`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await seed(page);
    await page.goto('/');
    await openBookshelf(page);
    await openMaterial(page, '独自教材 A');
    await page.getByRole('button', { name: 'この教材を予定に追加', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '予定・記録の追加', exact: true });
    await expect(dialog.getByRole('tab', { name: '予定', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByLabel('日付', { exact: true })).toHaveValue(E2E_TODAY);
    await expect(dialog.getByPlaceholder('例: 英語課題 / 面接準備')).toHaveValue('独自教材 A');
    await expect(dialog.getByRole('combobox', { name: '教材', exact: true })).toHaveValue('bookshelf-handoff-a');
    await expect(dialog.getByLabel('教科', { exact: true })).toHaveValue('情報科学');
    await testInfo.attach(`bookshelf-prefilled-${device}`, { body: await page.screenshot(), contentType: 'image/png' });
    // Editing the title to another registered material must not replace the explicit choice.
    await dialog.getByPlaceholder('例: 英語課題 / 面接準備').fill('独自教材 B');
    await expect(dialog.getByRole('combobox', { name: '教材', exact: true })).toHaveValue('bookshelf-handoff-a');
    await dialog.getByRole('button', { name: '30分', exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await readPlanEvents(page)).length).toBe(1);
    const [saved] = await readPlanEvents(page);
    expect(saved).toMatchObject({ userId: 'bookshelf-handoff-user', title: '独自教材 B',
      date: E2E_TODAY, startTime: '19:00', endTime: '19:30',
      plan: { subject: '情報科学', materialId: 'bookshelf-handoff-a', materialName: '独自教材 A' } });
    expect(saved.id).toBeTruthy();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1')))).toEqual([]);
    await page.reload();
    await openBookshelf(page);
    await openMaterial(page, '独自教材 A');
    await page.locator('.bookshelf-detail-tabs').getByRole('button', { name: '予定', exact: true }).click();
    await expect(page.getByRole('region', { name: '独自教材 Aの詳細', exact: true }).getByText('独自教材 B', { exact: true })).toBeVisible();
    expect((await readPlanEvents(page))[0]).toEqual(saved);
    await testInfo.attach(`bookshelf-saved-reloaded-${device}`, { body: await page.screenshot(), contentType: 'image/png' });

    // Closing A and reopening B uses B's current context, including the menu path.
    await page.getByRole('button', { name: 'この教材を予定に追加', exact: true }).click();
    await dialog.getByPlaceholder('例: 英語課題 / 面接準備').fill('保存しない A');
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: '教材一覧へ戻る', exact: true }).click();
    await openMaterial(page, '独自教材 B');
    await page.getByRole('button', { name: '教材メニューを開く', exact: true }).click();
    await page.getByRole('button', { name: '予定に追加', exact: true }).click();
    await expect(dialog.getByPlaceholder('例: 英語課題 / 面接準備')).toHaveValue('独自教材 B');
    await expect(dialog.getByRole('combobox', { name: '教材', exact: true })).toHaveValue('bookshelf-handoff-b');
    await expect(dialog.getByLabel('教科', { exact: true })).toHaveValue('数学');
    await dialog.getByRole('button', { name: '45分', exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await readPlanEvents(page)).length).toBe(2);
    expect((await readPlanEvents(page)).find(plan => plan.id !== saved.id)).toMatchObject({
      plan: { materialId: 'bookshelf-handoff-b', materialName: '独自教材 B', subject: '数学' }, endTime: '19:45',
    });

    // The generic action remains a blank Todo rather than retaining either material.
    await page.locator('.primary-bottom-nav').getByRole('button', { name: '予定', exact: true }).click();
    await page.getByRole('button', { name: 'クイック追加メニューを開く', exact: true }).click();
    await page.getByRole('menuitem', { name: '学習を追加', exact: true }).click();
    await expect(dialog.getByPlaceholder('例: 英語課題 / 面接準備')).toHaveValue('');
    await expect(dialog.getByLabel('締切日', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('日付', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    expect(errors).toEqual([]);
  });
}
