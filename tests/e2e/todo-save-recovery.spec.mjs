import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

async function readStored(page) {
  return page.evaluate(() => ({
    todos: JSON.parse(localStorage.getItem('studyplanner.todos.v1') ?? '[]'),
    events: JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'),
  }));
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`${viewport.width}px: Todo edit and scheduling retain failed input and persist a single retry`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      if (!localStorage.getItem('todo-recovery-seeded')) {
        const now = new Date().toISOString();
        const user = { id: 'todo-recovery-user', email: 'todo-recovery@example.com', username: 'Todo検証', avatar: '', createdAt: now };
        localStorage.setItem('studyplanner.users', JSON.stringify([user]));
        localStorage.setItem('studyplanner.session', user.id);
        for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents', 'studyplanner.studyMaterials.v1', 'studyplanner.studySubjects.v1']) {
          localStorage.setItem(key, '[]');
        }
        localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{ id: 'recovery-todo', userId: user.id,
          title: '入力を保持する課題', subject: '数学', type: 'study', estimatedMinutes: 30,
          dueDate: null, dueTime: null, memo: '', status: 'open', scheduledPlanId: null, createdAt: now, updatedAt: now }]));
        localStorage.setItem('todo-recovery-seeded', '1');
      }
      const setItem = Storage.prototype.setItem;
      window.__todoWriteFailures = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'studyplanner.todos.v1' && window.__todoWriteFailures > 0) {
          window.__todoWriteFailures -= 1;
          throw new DOMException('Fixture Todo storage failure', 'QuotaExceededError');
        }
        return setItem.call(this, key, value);
      };
    });
    await page.goto('/');
    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
    await page.getByRole('tab', { name: 'Todo', exact: true }).click();
    await page.locator('.todo-view-item').getByRole('button', { name: '編集', exact: true }).click();
    const editor = page.locator('.todo-edit-modal');
    await editor.getByLabel('タイトル', { exact: true }).fill('再送で保存した課題');
    const memo = editor.getByRole('textbox', { name: 'メモ', exact: true });
    await expect(memo).toHaveAccessibleName('メモ');
    await memo.fill('失敗しても残すメモ');
    await page.evaluate(() => { window.__todoWriteFailures = 1; });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor.getByRole('alert')).toHaveText('Fixture Todo storage failure');
    expect(await page.evaluate(() => window.__todoWriteFailures)).toBe(0);
    await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('再送で保存した課題');
    await expect(memo).toHaveValue('失敗しても残すメモ');
    await expect.poll(async () => (await readStored(page)).todos[0].title).toBe('入力を保持する課題');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await readStored(page)).todos[0])
      .toMatchObject({ title: '再送で保存した課題', memo: '失敗しても残すメモ' });

    await page.locator('.todo-view-item').getByRole('button', { name: '予定にする', exact: true }).click();
    await editor.getByLabel('日付', { exact: true }).fill(E2E_TODAY);
    await editor.getByLabel('開始時刻', { exact: true }).fill('18:45');
    await editor.getByRole('button', { name: '自由', exact: true }).click();
    await editor.getByLabel('自由入力（分）', { exact: true }).fill('75');
    await page.evaluate(() => { window.__todoWriteFailures = 1; });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor.getByRole('alert')).toHaveText('Fixture Todo storage failure');
    expect(await page.evaluate(() => window.__todoWriteFailures)).toBe(0);
    await expect(editor.getByLabel('開始時刻', { exact: true })).toHaveValue('18:45');
    await expect(editor.getByLabel('自由入力（分）', { exact: true })).toHaveValue('75');
    await expect.poll(async () => (await readStored(page)).todos[0].status).toBe('open');
    expect((await readStored(page)).events).toHaveLength(0);
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `artifacts/todo-save-recovery-${viewport.width}.png`, fullPage: true });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await readStored(page)).todos[0].status).toBe('scheduled');
    const saved = await readStored(page);
    expect(saved.todos).toHaveLength(1);
    expect(saved.events).toHaveLength(1);
    expect(saved.events[0]).toMatchObject({ title: '再送で保存した課題', memo: '失敗しても残すメモ', date: E2E_TODAY, startTime: '18:45', endTime: '20:00' });
    await page.reload();
    expect(await readStored(page)).toEqual(saved);
  });
}
