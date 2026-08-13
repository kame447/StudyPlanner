import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html';

test.describe.configure({ retries: 0 });

async function events(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function enterWeeklyMode(page) {
  const input = page.getByLabel('週間計画にしたいこと');
  if (await input.isVisible().catch(() => false)) return input;

  const aiInput = page.getByRole('button', { name: 'AI入力', exact: true });
  if (await aiInput.count() && await aiInput.isVisible()) await aiInput.click();

  const weeklyMode = page.getByRole('button', { name: '週間計画', exact: true });
  if (await weeklyMode.count() && await weeklyMode.isVisible()) await weeklyMode.click();

  await expect(input).toBeVisible();
  return input;
}

async function submitWeekly(page, text) {
  const input = await enterWeeklyMode(page);
  await input.fill(text);
  await input.press('Control+Enter');
}

async function createDraftReadyForApproval(page) {
  await submitWeekly(page, '保存失敗から回復する条件');
  await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  await page.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
}

test.describe('real weekly failure recovery', () => {
  test('a runtime failure clears pending state and the next turn succeeds without a poisoned graph revision', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?runtimeFailure=1`);
    await submitWeekly(page, '失敗する条件');

    await expect.poll(async () => (await events(page, 'real-runtime-fail')).length).toBe(1);
    await expect(page.getByLabel('週間計画にしたいこと')).toBeVisible();
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
    await createDraftReadyForApproval(page);

    const approve = page.getByRole('button', { name: '一括承認して保存' });
    await approve.click();

    await expect.poll(async () => (await events(page, 'real-fail-approved-plan')).length).toBe(1);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await expect(approve).toBeVisible();
    await expect(approve).toBeEnabled();

    await approve.click();

    await expect.poll(async () => (await events(page, 'real-save-approved-plan')).length).toBe(2);
    await expect.poll(async () => (await events(page, 'real-complete-approved-plan')).length).toBe(1);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
  });
});
