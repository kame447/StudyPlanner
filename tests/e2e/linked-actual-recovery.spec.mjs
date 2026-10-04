import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const NEXT_DAY = new Date(Date.parse(`${E2E_TODAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
async function readActuals(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'));
}

test('retains planned-record input after initial save and date-move failures, then persists the retry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ today, tomorrow }) => {
    const now = new Date().toISOString();
    const user = { id: 'actual-recovery-user', email: 'actual-recovery@example.com', username: 'actual-recovery', avatar: '', createdAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([{ id: 'recovery-plan', seriesId: 'recovery-plan', userId: user.id,
      title: '英語の予定', subject: '英語', date: today, startTime: '09:00', endTime: '09:30', repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], type: 'study', memo: '', createdAt: now, updatedAt: now }]));
    localStorage.setItem('studyplanner.actuals', '[]');
    for (const key of ['studyplanner.monthEvents', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) localStorage.setItem(key, '[]');
    const setItem = Storage.prototype.setItem;
    window.__actualWriteFailures = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'studyplanner.actuals' && window.__actualWriteFailures > 0) {
        window.__actualWriteFailures -= 1;
        throw new DOMException('Fixture storage failure', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  }, { today: E2E_TODAY, tomorrow: NEXT_DAY });
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '英語の予定' });
  await plan.click();
  await page.getByRole('button', { name: '記録を保存 実際の内容を保存' }).click();
  const editor = page.locator('.actual-editor-card');
  await editor.getByRole('textbox', { name: 'メモ・気づき', exact: true }).fill('失敗しても残すメモ');
  await page.evaluate(() => { window.__actualWriteFailures = 1; });
  await editor.getByRole('button', { name: '記録保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('もう一度保存');
  await expect(editor.getByRole('textbox', { name: 'メモ・気づき', exact: true })).toHaveValue('失敗しても残すメモ');
  expect(await readActuals(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('linked-record-failure-retained.png') });
  await editor.getByRole('button', { name: '記録保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await readActuals(page)).length).toBe(1);
  const saved = (await readActuals(page))[0];
  expect(saved).toMatchObject({ planId: 'recovery-plan', occurrenceDate: E2E_TODAY, note: '失敗しても残すメモ' });

  await plan.click();
  await page.getByRole('button', { name: '記録を編集 実際の内容を保存' }).click();
  await editor.getByLabel('日付', { exact: true }).fill(NEXT_DAY);
  await editor.getByRole('textbox', { name: 'メモ・気づき', exact: true }).fill('翌日に移した記録');
  await page.evaluate(() => { window.__actualWriteFailures = 1; });
  await editor.getByRole('button', { name: '記録保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('もう一度保存');
  await expect(editor.getByLabel('日付', { exact: true })).toHaveValue(NEXT_DAY);
  await expect(editor.getByRole('textbox', { name: 'メモ・気づき', exact: true })).toHaveValue('翌日に移した記録');
  expect(await readActuals(page)).toEqual([saved]);
  await editor.getByRole('button', { name: '記録保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await readActuals(page))[0].occurrenceDate).toBe(NEXT_DAY);
  expect(await readActuals(page)).toEqual([expect.objectContaining({ id: saved.id, planId: null, occurrenceDate: NEXT_DAY, note: '翌日に移した記録' })]);
});
