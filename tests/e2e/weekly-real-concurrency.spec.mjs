import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html?gate=real-weekly';

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

test('two Enter events in the same browser task start only one real controlled turn', async ({ page }) => {
  await page.goto(REAL_WEEKLY_URL);
  const input = await composer(page);
  await input.fill('二重送信しない条件');

  await input.evaluate((element) => {
    const dispatch = () => element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
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
