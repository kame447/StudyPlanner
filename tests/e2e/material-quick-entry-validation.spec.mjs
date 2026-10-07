import { expect, test, E2E_TODAY } from './support/fixed-clock.mjs';

for (const width of [390, 1280]) for (const kind of ['予定', '記録']) {
  test(`Material ${kind} requires date and time before saving at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      if (localStorage.getItem('material-validation-seeded')) return;
      const now = new Date().toISOString();
      const user = { id: 'material-validation-user', email: 'material-validation@example.test', username: '入力検証', avatar: '', createdAt: now };
      const subject = { id: 'math', userId: user.id, name: '数学', color: '#2f6fc2', createdAt: now, updatedAt: now };
      const material = { id: 'math-book', userId: user.id, name: '日付検証問題集', subjectId: subject.id, subjectName: subject.name, status: 'active', createdAt: now, updatedAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
      localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
      for (const key of ['studyplanner.plans', 'studyplanner.actuals', 'studyplanner.monthEvents.v1', 'studyplanner.todos.v1']) localStorage.setItem(key, '[]');
      localStorage.setItem('material-validation-seeded', '1');
    });
    await page.goto('/');
    async function openDay() {
      await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
      await page.getByRole('tab', { name: '日', exact: true }).click();
    }
    await openDay();
    await page.locator('.daily-material-card').filter({ hasText: '日付検証問題集' }).click();
    const editor = page.locator('.material-quick-modal');
    await editor.getByRole('tab', { name: kind, exact: true }).click();
    const date = editor.getByLabel('日付', { exact: true });
    const time = editor.getByLabel('開始時間', { exact: true });
    const submit = editor.getByRole('button', { name: '登録する', exact: true });
    const counts = () => page.evaluate(() => ['studyplanner.plans', 'studyplanner.actuals'].map(key => JSON.parse(localStorage.getItem(key) || '[]').length));
    await date.fill('');
    await expect(submit).toBeDisabled();
    await date.press('Enter');
    await expect(editor).toBeVisible();
    expect(await counts()).toEqual([0, 0]);
    await date.fill(E2E_TODAY);
    await time.fill('');
    await expect(submit).toBeDisabled();
    await time.press('Enter');
    expect(await counts()).toEqual([0, 0]);
    await time.fill('19:00');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(editor).toHaveCount(0);
    await expect.poll(counts).toEqual(kind === '予定' ? [1, 0] : [0, 1]);
    const record = await page.evaluate(kind => JSON.parse(localStorage.getItem(kind === '予定' ? 'studyplanner.plans' : 'studyplanner.actuals'))[0], kind);
    expect(kind === '予定' ? record.date : record.occurrenceDate).toBe(E2E_TODAY);
    await page.reload();
    await openDay();
    await expect(page.locator('.timeline-canvas')).toContainText('日付検証問題集');
    expect(await counts()).toEqual(kind === '予定' ? [1, 0] : [0, 1]);
  });
}
