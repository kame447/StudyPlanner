import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html';

test.describe.configure({ retries: 0 });

async function events(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function composer(page) {
  const input = page.locator('.ai-planning-composer textarea');
  await expect(input).toBeVisible();
  return input;
}

async function submitWeekly(page, text) {
  const input = await composer(page);
  await input.fill(text);
  await input.press('Enter');
}

async function createDraftReadyForApproval(page) {
  await submitWeekly(page, '保存失敗から回復する条件');
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(preview.getByRole('button', { name: 'この内容で保存' })).toBeVisible();
  return preview;
}

test.describe('real weekly failure recovery through AiPlanningView', () => {
  test('a runtime failure clears pending state and the next turn succeeds without a poisoned graph revision', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?runtimeFailure=1`);
    await submitWeekly(page, '失敗する条件');

    await expect.poll(async () => (await events(page, 'real-runtime-fail')).length).toBe(1);
    await expect(await composer(page)).toBeEnabled();
    expect(await events(page, 'real-runtime-complete')).toHaveLength(0);

    await page.evaluate(() => {
      window.history.replaceState(null, '', '/real-weekly.html');
    });
    await submitWeekly(page, '回復後の条件');

    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);
    const completion = (await events(page, 'real-runtime-complete'))[0];
    expect(completion.payload.graphRevision).toBe(1);
    expect(await events(page, 'real-runtime-execute')).toHaveLength(2);
    await expect(page.getByText('テスト応答: 回復後の条件', { exact: true })).toHaveCount(1);
  });

  test('a failed approval save keeps the draft retryable and a second approval can complete it', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?preview=1&approvalFailure=once`);
    const preview = await createDraftReadyForApproval(page);

    const approve = preview.getByRole('button', { name: 'この内容で保存' });
    await approve.click();

    await expect.poll(async () => (await events(page, 'real-fail-approved-plan')).length).toBe(1);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await expect(approve).toBeVisible();
    await expect(approve).toBeEnabled();

    await approve.click();

    await expect.poll(async () => (await events(page, 'real-save-approved-plan')).length).toBe(2);
    await expect.poll(async () => (await events(page, 'real-complete-approved-plan')).length).toBe(1);
    await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);
  });
});
