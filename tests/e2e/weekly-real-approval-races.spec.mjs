import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html?preview=1&gate=approval-save';

test.describe.configure({ retries: 0 });

async function events(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function createDraftReadyForApproval(page) {
  const input = page.locator('.ai-planning-composer textarea');
  await expect(input).toBeVisible();
  await input.fill('承認raceを検査する条件');
  await input.press('Enter');

  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await expect(preview.getByRole('button', { name: 'この内容で保存' })).toBeVisible();
  return preview;
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

test.describe('real weekly approval race lifecycle through AiPlanningView', () => {
  test('pending approval exposes no actionable duplicate save', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const preview = await createDraftReadyForApproval(page);

    await preview.getByRole('button', { name: 'この内容で保存' }).click({ noWaitAfter: true });
    await waitForApprovalSavePending(page);

    await expectNotActionable(preview.getByRole('button', { name: /保存中|この内容で保存/ }));
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);

    await releaseApprovalSave(page);
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);
  });

  test('two save activations in the same browser task invoke external persistence once', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const preview = await createDraftReadyForApproval(page);

    const approve = preview.getByRole('button', { name: 'この内容で保存' });
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
    await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);
  });

  test('closing and reopening the AI planning surface during approval preserves the pending operation and completes it once', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const preview = await createDraftReadyForApproval(page);

    await preview.getByRole('button', { name: 'この内容で保存' }).click({ noWaitAfter: true });
    await waitForApprovalSavePending(page);

    await page.evaluate(() => window.__realWeeklySurface.close());
    await expect(page.getByRole('button', { name: 'AI計画を再度開く' })).toBeVisible();
    await page.evaluate(() => window.__realWeeklySurface.open());
    await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();

    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
    await releaseApprovalSave(page);
    await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();
    expect(await events(page, 'real-save-approved-plan')).toHaveLength(1);
  });
});
