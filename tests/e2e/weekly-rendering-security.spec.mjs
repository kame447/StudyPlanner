import { expect, test } from '@playwright/test';

const REAL_WEEKLY_URL = 'http://127.0.0.1:4174/real-weekly.html';

async function realEvents(page, type) {
  return page.evaluate((eventType) => (
    (window.__realWeeklyEvents ?? []).filter((event) => event.type === eventType)
  ), type);
}

async function realComposer(page) {
  const input = page.locator('.ai-planning-composer textarea');
  await expect(input).toBeVisible();
  return input;
}

test.describe('weekly conversation rendering browser contracts', () => {
  test('production chat renders HTML-like user and assistant messages as literal text', async ({ page }) => {
    const pageErrors = [];
    const dialogs = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto(REAL_WEEKLY_URL);

    const payload = '<img src="x" onerror="window.__weeklyXssExecuted=true"><script>window.__weeklyXssExecuted=true</script>';
    const input = await realComposer(page);
    await input.fill(payload);
    await page.getByRole('button', { name: '送信', exact: true }).click();

    await expect.poll(async () => (await realEvents(page, 'real-runtime-complete')).length).toBe(1);
    const messages = page.locator('.ai-planning-conversation');
    const userMessage = messages.locator('.ai-planning-message-row.user .ai-planning-bubble');
    const assistantMessage = messages.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
    await expect(userMessage).toHaveText(payload);
    await expect(userMessage).toBeVisible();
    await expect(assistantMessage).toHaveText(`テスト応答: ${payload}`);
    await expect(assistantMessage).toBeVisible();
    await expect(messages.locator('img[src="x"], script')).toHaveCount(0);
    expect(await page.evaluate(() => window.__weeklyXssExecuted)).toBeUndefined();
    expect(pageErrors).toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('AI planning composer maximum length agrees with the real controlled-turn boundary', async ({ page }) => {
    await page.goto(REAL_WEEKLY_URL);
    const input = await realComposer(page);

    const declaredMaxLength = Number(await input.getAttribute('maxlength'));
    expect(Number.isInteger(declaredMaxLength)).toBe(true);
    expect(declaredMaxLength).toBeGreaterThan(0);

    await input.focus();
    await page.keyboard.insertText('あ'.repeat(declaredMaxLength + 1));
    await expect(input).toHaveValue('あ'.repeat(declaredMaxLength));

    await page.getByRole('button', { name: '送信', exact: true }).click();

    await expect.poll(async () => (await realEvents(page, 'real-runtime-execute')).length).toBe(1);
    expect((await realEvents(page, 'real-runtime-execute'))[0].payload.userText).toHaveLength(declaredMaxLength);
  });
});
