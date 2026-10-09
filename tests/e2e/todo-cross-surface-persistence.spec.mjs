import { expect, test } from './support/startup-ready.mjs';

async function openTodo(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: 'Todo', exact: true }).click();
  await expect(page.locator('.todo-view')).toBeVisible();
}

async function expectCompactTodoHeader(page) {
  const sortBox = await page.locator('.todo-sort-control').boundingBox();
  const headingBox = await page.locator('.todo-status-section-head').first().boundingBox();
  expect(headingBox.y - (sortBox.y + sortBox.height)).toBeLessThanOrEqual(40);
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  test(`${name}: Todo edits and Undo survive cross-surface navigation and reload`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (localStorage.getItem('todo-navigation-seeded')) return;
      const now = '2026-10-03T00:00:00.000Z';
      const user = { id: 'todo-navigation-user', email: 'todo-navigation@example.com', username: 'Todo検証', avatar: '', createdAt: now };
      const todo = {
        id: 'navigation-todo', userId: user.id, title: '画面横断の課題', subject: '数学', type: 'study',
        estimatedMinutes: 30, dueDate: null, memo: '', status: 'open', scheduledPlanId: null,
        createdAt: now, updatedAt: now,
      };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) {
        localStorage.setItem(key, '[]');
      }
      localStorage.setItem('studyplanner.todos.v1', JSON.stringify([todo]));
      localStorage.setItem('todo-navigation-seeded', '1');
    });
    await page.goto('/');
    await openTodo(page);
    await expectCompactTodoHeader(page);
    await page.setViewportSize({ width: 1024, height: 1366 });
    await expectCompactTodoHeader(page);
    await page.setViewportSize(viewport);
    const row = page.locator('.todo-view-item').filter({ hasText: '画面横断の課題' });
    await row.getByRole('button', { name: '編集', exact: true }).click();
    await page.locator('.todo-edit-modal').getByLabel('タイトル', { exact: true }).fill('保存した画面横断の課題');
    await page.locator('.todo-edit-modal').getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.todo-edit-modal')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1'))[0].title))
      .toBe('保存した画面横断の課題');

    for (const [label, selector] of [
      ['ホーム', '.home-dashboard'], ['教材', '.bookshelf-view'],
      ['時間割', '.timetable-view'], ['AI計画', '.ai-planning-card'],
      ['予定', '.schedule-workspace-shell'],
    ]) {
      await page.locator('.primary-bottom-nav button').filter({ hasText: label }).click();
      await expect(page.locator(selector).first()).toBeVisible();
    }
    for (const label of ['月', '週', '日', 'Todo']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await expect(row).toBeVisible();
    await page.reload();
    await openTodo(page);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '削除', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expectCompactTodoHeader(page);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(row).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1')).length)).toBe(1);
    await page.reload();
    await openTodo(page);
    await expect(row).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: `artifacts/todo-cross-surface-${name}.png`, fullPage: true });
  });
}
