import { expect, test } from '@playwright/test';
const URL = 'http://127.0.0.1:4174/real-weekly.html';
const image = { name: 'synthetic.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==', 'base64') };
const runtimeCalls = (page) => page.evaluate(() => window.__realWeeklyEvents.filter((entry) => entry.type === 'real-runtime-execute').length);
async function openDrawer(page) { await page.getByRole('button', { name: 'チャット一覧を開く' }).click(); }
async function submitImage(page, name = 'synthetic.png') {
  await page.locator('.ai-planning-attachment-input').setInputFiles({ ...image, name });
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(1);
}
test.describe.configure({ retries: 0 });
for (const width of [390, 1280]) {
  test(`image reading locks chat actions and preserves current chat at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 }); await page.goto(URL);
    await submitImage(page); await openDrawer(page);
    const create = page.getByRole('button', { name: '新しいチャット', exact: true });
    await expect(create).toBeDisabled();
    const chatActions = page.locator('.ai-chat-row button');
    await expect(chatActions).toHaveCount(2);
    for (const action of await chatActions.all()) await expect(action).toBeDisabled();
    expect(await runtimeCalls(page)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`image-chat-lock-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => window.__realWeeklyImageRead.release())).toBe(true);
    await expect.poll(() => runtimeCalls(page)).toBe(1);
    await expect(create).toBeEnabled(); await expect(page.locator('.ai-chat-row')).toHaveCount(1);
    await create.click(); await openDrawer(page);
    await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  });
  test(`closing the view discards old image completion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await page.goto(URL);
    await submitImage(page, 'obsolete.png');
    await page.getByRole('button', { name: 'テスト用にAI計画を閉じる' }).click();
    expect(await page.evaluate(() => window.__realWeeklyImageRead.release())).toBe(true);
    await page.getByRole('button', { name: 'AI計画を再度開く' }).click();
    await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
    expect(await runtimeCalls(page)).toBe(0);
    await page.locator('.ai-planning-composer textarea').fill('新しい画像から計画を作って');
    await submitImage(page, 'current.png');
    expect(await page.evaluate(() => window.__realWeeklyImageRead.release())).toBe(true);
    await expect.poll(() => runtimeCalls(page)).toBe(1);
    const calls = await page.evaluate(() => window.__realWeeklyEvents.filter((entry) => entry.type === 'real-runtime-execute'));
    expect(calls[0].payload.userText).toBe('新しい画像から計画を作って');
    await openDrawer(page); await expect(page.getByRole('button', { name: '新しいチャット', exact: true })).toBeEnabled();
    await expect(page.locator('.ai-chat-row')).toHaveCount(1);
  });
}
