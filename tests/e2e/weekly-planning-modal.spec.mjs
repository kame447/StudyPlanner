import { expect, test } from '@playwright/test';

const WEEKLY_HARNESS_URL = 'http://127.0.0.1:4174/?weekly=1';

async function events(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function release(page, type) {
  const released = await page.evaluate((gateType) => window.__quickEntryHarness.release(gateType), type);
  expect(released).toBe(true);
}

async function openWeeklyHarness(page, gated = false) {
  await page.goto(`${WEEKLY_HARNESS_URL}${gated ? '&gate=weekly' : ''}`);
  await expect(page.getByLabel('週間計画にしたいこと')).toBeVisible();
}

async function expectNoSecondSubmitAction(page) {
  const send = page.getByRole('button', { name: '送信', exact: true });
  if ((await send.count()) === 0) return;
  if (!(await send.isVisible())) return;
  await expect(send).toBeDisabled();
}

test.describe('QuickEntryModal weekly UI harness contracts', () => {
  test('an existing weekly session opens directly in a usable weekly planning mode', async ({ page }) => {
    await openWeeklyHarness(page);
    await expect(page.getByLabel('週間計画にしたいこと')).toBeVisible();
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeVisible();
  });

  test('plain Enter keeps editing while Ctrl+Enter submits one user turn', async ({ page }) => {
    await openWeeklyHarness(page);

    const input = page.getByLabel('週間計画にしたいこと');
    await input.fill('来週の予定を立てたい');
    await input.press('Enter');

    expect(await events(page, 'submit-weekly-turn')).toHaveLength(0);
    await expect(input).toHaveValue('来週の予定を立てたい\n');

    await input.press('Control+Enter');
    await expect.poll(async () => (await events(page, 'submit-weekly-turn')).length).toBe(1);
    expect((await events(page, 'submit-weekly-turn'))[0].payload.text).toBe('来週の予定を立てたい');
  });

  test('a pending turn exposes cancellation and no actionable second submit', async ({ page }) => {
    await openWeeklyHarness(page, true);

    const input = page.getByLabel('週間計画にしたいこと');
    await input.fill('来週の予定を立てたい');
    await input.press('Control+Enter');

    await expect(page.getByRole('button', { name: '処理をキャンセル' })).toBeVisible();
    await expect(page.getByText('来週の予定を立てたい', { exact: true })).toHaveCount(1);
    await expectNoSecondSubmitAction(page);
    expect(await events(page, 'submit-weekly-turn')).toHaveLength(1);

    await release(page, 'weekly');
  });
});
