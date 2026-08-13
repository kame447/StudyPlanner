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

async function tabUntilFocused(page, locator, maxSteps = 20) {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await locator.evaluate((element) => document.activeElement === element)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(locator).toBeFocused();
}

test.describe('weekly planning keyboard browser contracts', () => {
  test('a synthetic IME-composition Enter event does not submit even with Ctrl held', async ({ page }) => {
    await page.goto(WEEKLY_HARNESS_URL);
    const input = page.getByLabel('週間計画にしたいこと');
    await input.fill('来週の予定');

    await input.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(await events(page, 'submit-weekly-turn')).toHaveLength(0);
    await expect(input).toHaveValue('来週の予定');
  });

  test('Meta+Enter follows the same submit contract as Ctrl+Enter', async ({ page }) => {
    await page.goto(WEEKLY_HARNESS_URL);
    const input = page.getByLabel('週間計画にしたいこと');
    await input.fill('来週の予定');
    await input.press('Meta+Enter');

    await expect.poll(async () => (await events(page, 'submit-weekly-turn')).length).toBe(1);
    expect((await events(page, 'submit-weekly-turn'))[0].payload.text).toBe('来週の予定');
  });

  test('after cancellation the weekly composer is keyboard-reachable for continuation', async ({ page }) => {
    await page.goto(`${WEEKLY_HARNESS_URL}&gate=weekly`);
    let input = page.getByLabel('週間計画にしたいこと');
    await input.fill('来週の予定');
    await input.press('Control+Enter');
    await page.getByRole('button', { name: '処理をキャンセル' }).click();

    await release(page, 'weekly');
    await expect.poll(async () => (await events(page, 'ignore-weekly-turn')).length).toBe(1);

    input = page.getByLabel('週間計画にしたいこと');
    await expect(input).toBeVisible();
    await page.getByRole('button', { name: 'この週の相談をリセット' }).focus();
    await tabUntilFocused(page, input);
  });
});
