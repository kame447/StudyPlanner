import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const NEXT_DAY = new Date(Date.parse(`${E2E_TODAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
async function readActuals(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'));
}

test('retains standalone edits through failed date move and plan link, then retries without losing the record', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ today, tomorrow }) => {
    const now = new Date().toISOString();
    const user = { id: 'actual-recovery-user', email: 'actual-recovery@example.com', username: 'actual-recovery', avatar: '', createdAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([{ id: 'recovery-plan', seriesId: 'recovery-plan', userId: user.id,
      title: '英語の予定', subject: '英語', date: tomorrow, startTime: '09:00', endTime: '09:30', repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], type: 'study', memo: '', createdAt: now, updatedAt: now }]));
    localStorage.setItem('studyplanner.actuals', JSON.stringify([{ id: 'recovery-actual', userId: user.id, planId: null,
      occurrenceDate: today, actualStartTime: '09:00', actualEndTime: '09:30', title: '編集する記録', subject: '英語', note: '', updatedAt: now }]));
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
  await page.locator('.timeline-actual-block').filter({ hasText: '編集する記録' }).click();
  const editor = page.locator('.standalone-actual-editor-card');
  await editor.getByLabel('タイトル', { exact: true }).fill('移動した記録');
  await editor.getByLabel('日付', { exact: true }).fill(NEXT_DAY);
  await editor.getByLabel('メモ', { exact: true }).fill('失敗しても残すメモ');
  await page.evaluate(() => { window.__actualWriteFailures = 1; });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('もう一度保存');
  await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('移動した記録');
  await expect(editor.getByLabel('日付', { exact: true })).toHaveValue(NEXT_DAY);
  await expect(editor.getByLabel('メモ', { exact: true })).toHaveValue('失敗しても残すメモ');
  await expect.poll(async () => (await readActuals(page))[0].occurrenceDate).toBe(E2E_TODAY);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await readActuals(page))[0].occurrenceDate).toBe(NEXT_DAY);

  await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
  await page.locator('.timeline-actual-block').filter({ hasText: '移動した記録' }).click();
  await editor.getByLabel('タイトル', { exact: true }).fill('予定に紐づけた記録');
  await page.evaluate(() => { window.__actualWriteFailures = 1; });
  await editor.getByRole('button', { name: 'この予定に紐づける', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('紐づけできません');
  await expect(editor.getByLabel('タイトル', { exact: true })).toHaveValue('予定に紐づけた記録');
  await expect.poll(async () => (await readActuals(page))[0].planId).toBeNull();
  await editor.getByRole('button', { name: 'この予定に紐づける', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await readActuals(page))[0].planId).toBe('recovery-plan');
  expect(await readActuals(page)).toEqual([expect.objectContaining({ id: 'recovery-actual', occurrenceDate: NEXT_DAY,
    title: '予定に紐づけた記録', note: '失敗しても残すメモ', planId: 'recovery-plan' })]);
});
