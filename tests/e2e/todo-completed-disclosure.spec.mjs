import { expect, test } from './support/startup-ready.mjs';

async function openTodo(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: 'Todo', exact: true }).click();
  await expect(page.locator('.todo-view')).toBeVisible();
}

async function seedTodos(page, completedCount) {
  await page.addInitScript((count) => {
    if (localStorage.getItem('todo-disclosure-seeded')) return;
    const now = '2026-10-08T00:00:00.000Z';
    const user = { id: 'todo-disclosure-user', email: 'todo-disclosure@example.com', username: 'Todo検証', avatar: '', createdAt: now };
    const makeTodo = (id, status, dueDate = null) => ({
      id, userId: user.id, title: id, subject: '数学', type: 'study',
      estimatedMinutes: 30, dueDate, dueTime: dueDate ? '18:00' : null,
      memo: '開閉しても保持するメモ', status, scheduledPlanId: null,
      createdAt: now, updatedAt: now,
    });
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('studyplanner.todos.v1', JSON.stringify([
      makeTodo('締切のある課題', 'open', '2026-10-10'),
      makeTodo('締切なしの課題', 'open'),
      ...Array.from({ length: count }, (_, index) => makeTodo(`完了した課題-${index + 1}`, 'done', '2026-10-09')),
    ]));
    localStorage.setItem('todo-disclosure-seeded', '1');
  }, completedCount);
}

for (const [name, viewport, touch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['mobile', { width: 390, height: 844 }, true],
]) {
  test.describe(`${name}: completed Todo disclosure`, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    for (const count of [0, 1, 7]) {
      test(`${count} completed items start closed and open accessibly without losing data`, async ({ page }, testInfo) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await seedTodos(page, count);
        await page.goto('/');
        await openTodo(page);

        const section = page.locator('.todo-status-section').filter({ has: page.locator('.todo-completed-disclosure') });
        const button = section.getByRole('button', { name: new RegExp(`完了\\s*${count}`) });
        const rows = section.locator('.todo-view-item');
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await expect(section.locator('.todo-section-count')).toHaveText(String(count));
        await expect(rows).toHaveCount(0);
        await expect(section.getByText('Todoはありません。')).toHaveCount(0);
        await expect(page.locator('.todo-view-item')).toHaveCount(2);
        const target = await button.getAttribute('aria-controls');
        expect(target).toBeTruthy();
        const panel = page.locator(`[id="${target}"]`);
        await expect(panel).toHaveAttribute('hidden', '');
        expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
        const savedBefore = await page.evaluate(() => localStorage.getItem('studyplanner.todos.v1'));

        if (count === 1) {
          await page.screenshot({ path: testInfo.outputPath(`todo-completed-closed-${name}.png`), fullPage: true });
        }
        if (touch) {
          await button.tap();
        } else {
          await button.focus();
          await button.press('Enter');
        }
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).not.toHaveAttribute('hidden');
        await expect(rows).toHaveCount(count);
        if (count === 0) {
          await expect(section.getByText('Todoはありません。')).toBeVisible();
        } else {
          await expect(rows.last()).toBeVisible();
          await expect(rows.first().getByRole('button', { name: '編集', exact: true })).toBeVisible();
          await expect(rows.first().getByRole('button', { name: '未完了に戻す', exact: true })).toBeVisible();
          await expect(rows.first().getByRole('button', { name: '削除', exact: true })).toBeVisible();
        }
        if (count === 1) {
          await page.screenshot({ path: testInfo.outputPath(`todo-completed-open-${name}.png`), fullPage: true });
        }

        if (touch) await button.tap();
        else await button.press('Space');
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await expect(rows).toHaveCount(0);
        if (!touch) await expect(button).toBeFocused();
        expect(await page.evaluate(() => localStorage.getItem('studyplanner.todos.v1'))).toBe(savedBefore);

        const active = page.locator('.todo-view-item').filter({ hasText: '締切のある課題' });
        await active.getByRole('button', { name: '完了', exact: true }).click();
        await expect(active).toHaveCount(0);
        await expect(section.locator('.todo-section-count')).toHaveText(String(count + 1));
        await expect(section.locator('.todo-completed-disclosure')).toHaveAttribute('aria-expanded', 'false');

        // The accessible name changes with the count, so use the stable disclosure locator now.
        const updatedButton = section.locator('.todo-completed-disclosure');
        if (touch) await updatedButton.tap();
        else await updatedButton.click();
        await expect(rows).toHaveCount(count + 1);
        const completedActive = rows.filter({ hasText: '締切のある課題' });
        await completedActive.getByRole('button', { name: '未完了に戻す', exact: true }).click();
        await expect(page.locator('.todo-status-section').first().getByText('締切のある課題', { exact: true })).toBeVisible();
        await expect(section.locator('.todo-section-count')).toHaveText(String(count));
        await expect.poll(() => page.evaluate(() => {
          const item = JSON.parse(localStorage.getItem('studyplanner.todos.v1')).find((todo) => todo.id === '締切のある課題');
          return { status: item.status, dueDate: item.dueDate, dueTime: item.dueTime, memo: item.memo };
        })).toEqual({ status: 'open', dueDate: '2026-10-10', dueTime: '18:00', memo: '開閉しても保持するメモ' });

        await page.reload();
        await openTodo(page);
        await expect(updatedButton).toHaveAttribute('aria-expanded', 'false');
        await expect(rows).toHaveCount(0);
        await expect(page.locator('.todo-view-item')).toHaveCount(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
      });
    }
  });
}
