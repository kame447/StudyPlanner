import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

async function readActuals(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'));
}

for (const width of [390, 1280]) for (const kind of ['linked-new', 'linked-existing', 'standalone']) {
  test(`${kind} study record rejects blank date and saves the corrected draft at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(({ today, kind }) => {
      if (localStorage.getItem('actual-date-validation-seeded')) return;
      const now = new Date().toISOString();
      const user = { id: 'date-validation-user', email: 'date-validation@example.test', username: '日付検証', avatar: '', createdAt: now };
      const plan = { id: 'date-validation-plan', seriesId: 'date-validation-plan', userId: user.id,
        title: '日付を検証する予定', subject: '英語', date: today, startTime: '09:00', endTime: '09:30', repeat: 'none', repeatUntil: null,
        excludedDates: [], recurrenceRules: [], type: 'study', memo: '', createdAt: now, updatedAt: now };
      const actual = { id: 'date-validation-actual', userId: user.id, planId: kind === 'standalone' ? null : plan.id,
        occurrenceDate: today, actualStartTime: '09:00', actualEndTime: '09:30', title: '日付を検証する記録', subject: '英語', note: '', updatedAt: now };
      localStorage.setItem('studyplanner.users', JSON.stringify([user]));
      localStorage.setItem('studyplanner.session', user.id);
      localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
      localStorage.setItem('studyplanner.actuals', JSON.stringify(kind === 'linked-new' ? [] : [actual]));
      for (const key of ['studyplanner.monthEvents', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
      localStorage.setItem('actual-date-validation-seeded', '1');
    }, { today: E2E_TODAY, kind });
    await page.goto('/');
    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
    await page.getByRole('tab', { name: '日', exact: true }).click();
    if (kind === 'standalone') {
      await page.locator('.timeline-actual-block').filter({ hasText: '日付を検証する記録' }).click();
    } else {
      await page.locator('.timeline-plan-block').filter({ hasText: '日付を検証する予定' }).click();
      await page.getByRole('button', { name: kind === 'linked-new' ? '記録を保存' : '記録を編集', exact: true }).click();
    }
    const editor = page.locator(kind === 'standalone' ? '.standalone-actual-editor-card' : '.linked-actual-editor-card');
    const memo = editor.getByRole('textbox', { name: kind === 'standalone' ? 'メモ' : 'メモ・気づき', exact: true });
    await memo.fill('日付を直しても残すメモ');
    const savedBefore = await readActuals(page);
    await editor.getByLabel('日付', { exact: true }).fill('');
    await editor.getByRole('button', { name: kind === 'standalone' ? '保存' : '記録保存', exact: true }).click();
    await testInfo.attach('after-invalid-save.json', { body: JSON.stringify(await readActuals(page)), contentType: 'application/json' });
    await expect(editor.getByRole('alert')).toContainText('有効な日付');
    await expect(editor.getByLabel('日付', { exact: true })).toHaveValue('');
    await expect(memo).toHaveValue('日付を直しても残すメモ');
    expect(await readActuals(page)).toEqual(savedBefore);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-${width}-invalid-date.png`) });
    await editor.getByLabel('日付', { exact: true }).fill(E2E_TODAY);
    await editor.getByRole('button', { name: kind === 'standalone' ? '保存' : '記録保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await readActuals(page)).length).toBe(1);
    expect((await readActuals(page))[0]).toMatchObject({ occurrenceDate: E2E_TODAY, note: '日付を直しても残すメモ',
      planId: kind === 'standalone' ? null : 'date-validation-plan' });
    await page.reload();
    expect((await readActuals(page))[0]).toMatchObject({ occurrenceDate: E2E_TODAY, note: '日付を直しても残すメモ' });
    await page.screenshot({ path: testInfo.outputPath(`${kind}-${width}-saved.png`) });
  });
}
