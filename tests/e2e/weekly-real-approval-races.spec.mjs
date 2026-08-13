import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html?preview=1&gate=approval-save';

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

async function createDraftReadyForApproval(page) {
  const input = await enterWeeklyMode(page);
  await input.fill('承認raceを検査する条件');
  await input.press('Control+Enter');
  await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toBeVisible();
  await page.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(page.getByRole('button', { name: '一括承認して保存' })).toBeVisible();
}

async function waitForApprovalSavePending(page) {
  await expect.poll(
    () => page.evaluate(() => window.__realWeeklyApproval.pending()),
  ).toBe(1);
  expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
}

async function releaseApprovalSave(page) {
  const released = await page.evaluate(() => window.__realWeeklyApproval.release());
  expect(released).toBe(true);
  await expect.poll(async () => (await events(page, 'real-complete-approved-plan')).length).toBe(1);
}

async function expectNotActionable(locator) {
  if ((await locator.count()) === 0) return;
  if (!(await locator.isVisible())) return;
  await expect(locator).toBeDisabled();
}

test.describe('real weekly approval race lifecycle', () => {
  test('pending approval exposes no actionable duplicate approval or destructive draft mutation', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    await createDraftReadyForApproval(page);

    await page.getByRole('button', { name: '一括承認して保存' }).click({ noWaitAfter: true });
    await waitForApprovalSavePending(page);

    await expectNotActionable(page.getByRole('button', { name: /保存中|一括承認して保存/ }));
    await expectNotActionable(page.getByRole('button', { name: '一括破棄' }));

    const dateButton = page.getByRole('button', { name: /8\/18/ }).first();
    if (await dateButton.count() && await dateButton.isVisible() && await dateButton.isEnabled()) {
      await dateButton.click();
      await expectNotActionable(page.getByRole('button', { name: '数学のワークを削除' }));
    }

    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await releaseApprovalSave(page);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
  });

  test('two approval activations in the same browser task invoke external persistence once', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    await createDraftReadyForApproval(page);

    const approve = page.getByRole('button', { name: '一括承認して保存' });
    await approve.evaluate((button) => {
      button.click();
      button.click();
    });

    await expect.poll(async () => (await events(page, 'real-save-approved-plan')).length).toBeGreaterThanOrEqual(1);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await expect.poll(
      () => page.evaluate(() => window.__realWeeklyApproval.pending()),
    ).toBe(1);

    await releaseApprovalSave(page);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
  });

  test('closing and reopening during approval preserves the pending operation and completes it once', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    await createDraftReadyForApproval(page);

    await page.getByRole('button', { name: '一括承認して保存' }).click({ noWaitAfter: true });
    await waitForApprovalSavePending(page);

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('button', { name: 'モーダルを再度開く' })).toBeVisible();
    await page.getByRole('button', { name: 'モーダルを再度開く' }).click();

    await expectNotActionable(page.getByRole('button', { name: /保存中|一括承認して保存/ }));
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);

    await releaseApprovalSave(page);
    await expect(page.getByRole('button', { name: '一括承認して保存' })).toHaveCount(0);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
  });
});
