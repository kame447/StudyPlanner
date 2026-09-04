import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html';

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

async function releaseRuntime(page) {
  const released = await page.evaluate(() => window.__realWeeklyRuntime.release());
  expect(released).toBe(true);
}

test.describe('AI planning keyboard browser contracts', () => {
  test('a synthetic IME-composition Enter event does not submit', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const input = await composer(page);
    await input.fill('来週の予定');

    await input.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
    await expect(input).toHaveValue('来週の予定');
  });

  test('Shift+Enter keeps multiline text without submitting', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const input = await composer(page);
    await input.fill('来週の予定');
    await input.press('Shift+Enter');

    expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
    await expect(input).toHaveValue('来週の予定\n');
  });

  test('after cancellation the AI planning composer is available for continuation', async ({ page }) => {
    await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
    let input = await composer(page);
    await input.fill('来週の予定');
    await input.press('Enter');
    await expect.poll(
      () => page.evaluate(() => window.__realWeeklyRuntime.pending()),
    ).toBe(1);

    await page.getByRole('button', { name: '処理をキャンセル' }).click();
    await releaseRuntime(page);
    await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);

    input = await composer(page);
    await expect(input).toBeEnabled();
    await input.focus();
    await expect(input).toBeFocused();
  });
});
