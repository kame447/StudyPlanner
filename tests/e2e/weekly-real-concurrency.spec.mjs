import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html?gate=real-weekly';

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

test('two Ctrl+Enter events in the same browser task start only one real controlled turn', async ({ page }) => {
  await page.goto(REAL_WEEKLY_URL);
  const input = await enterWeeklyMode(page);
  await input.fill('二重送信しない条件');

  await input.evaluate((element) => {
    const dispatch = () => element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    dispatch();
    dispatch();
  });

  await expect.poll(
    () => page.evaluate(() => window.__realWeeklyRuntime.pending()),
  ).toBe(1);
  expect(await events(page, 'real-runtime-execute')).toHaveLength(1);
  await expect(page.getByText('二重送信しない条件', { exact: true })).toHaveCount(1);

  const released = await page.evaluate(() => window.__realWeeklyRuntime.release());
  expect(released).toBe(true);
  await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

  expect(await events(page, 'real-runtime-execute')).toHaveLength(1);
  await expect(page.getByText('テスト応答: 二重送信しない条件', { exact: true })).toHaveCount(1);
});
