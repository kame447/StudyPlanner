import { expect, test } from '@playwright/test';

const WEEKLY_HARNESS_URL = 'http://127.0.0.1:4174/?weekly=1';
const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html';

async function harnessEvents(page, type) {
  return page.evaluate((eventType) => (
    window.__quickEntryEvents.filter((event) => event.type === eventType)
  ), type);
}

async function realEvents(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function enterRealWeeklyMode(page) {
  const input = page.getByLabel('週間計画にしたいこと');
  if (await input.isVisible().catch(() => false)) return input;

  const aiInput = page.getByRole('button', { name: 'AI入力', exact: true });
  if (await aiInput.count() && await aiInput.isVisible()) await aiInput.click();
  const weeklyMode = page.getByRole('button', { name: '週間計画', exact: true });
  if (await weeklyMode.count() && await weeklyMode.isVisible()) await weeklyMode.click();

  await expect(input).toBeVisible();
  return input;
}

test.describe('weekly conversation rendering browser contracts', () => {
  test('HTML-like user and assistant content is rendered as text rather than executable markup', async ({ page }) => {
    await page.goto(WEEKLY_HARNESS_URL);
    await page.evaluate(() => {
      window.__weeklyXssExecuted = false;
    });

    const payload = '<img src=x onerror="window.__weeklyXssExecuted=true">';
    const input = page.getByLabel('週間計画にしたいこと');
    await input.fill(payload);
    await input.press('Control+Enter');

    await expect.poll(async () => (await harnessEvents(page, 'complete-weekly-turn')).length).toBe(1);
    await expect(page.getByText(payload, { exact: true })).toHaveCount(1);
    await expect(page.getByLabel('週間計画の会話履歴').locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__weeklyXssExecuted)).toBe(false);
  });

  test('weekly composer maximum length agrees with the real controlled-turn boundary', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const input = await enterRealWeeklyMode(page);

    const declaredMaxLength = Number(await input.getAttribute('maxlength'));
    expect(Number.isInteger(declaredMaxLength)).toBe(true);
    expect(declaredMaxLength).toBeGreaterThan(0);

    await input.focus();
    await page.keyboard.insertText('あ'.repeat(declaredMaxLength + 1));
    await expect(input).toHaveValue('あ'.repeat(declaredMaxLength));

    await input.press('Control+Enter');

    await expect.poll(async () => (await realEvents(page, 'real-runtime-execute')).length).toBe(1);
    expect((await realEvents(page, 'real-runtime-execute'))[0].payload.userText).toHaveLength(declaredMaxLength);
  });
});
