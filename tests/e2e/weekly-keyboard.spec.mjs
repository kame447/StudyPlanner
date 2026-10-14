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

for (const width of [390, 1280]) {
  test.describe(`AI planning keyboard browser contracts at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('synthetic IME confirmation events leave editing untouched and never submit', async ({ page }) => {
      await page.goto(REAL_WEEKLY_URL);
      const input = await composer(page);
      await input.fill('来週の予定');

      const prevented = await input.evaluate((element) => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        const defaults = [{ keyCode: 13, isComposing: true }, { keyCode: 229, isComposing: false }]
          .map((ime) => {
            const event = new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...ime,
            });
            element.dispatchEvent(event);
            return event.defaultPrevented;
          });
        element.dispatchEvent(new CompositionEvent('compositionend', { data: '予定', bubbles: true }));
        return defaults;
      });

      expect(prevented).toEqual([false, false]);
      expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
      await expect(input).toHaveValue('来週の予定');
    });

    test('Enter and Shift+Enter preserve multiline text until the Send button is clicked', async ({ page }) => {
      await page.goto(REAL_WEEKLY_URL);
      const input = await composer(page);
      await input.fill('来週の予定');
      await input.press('Enter');
      await input.press('Shift+Enter');
      await input.pressSequentially('英語も復習する');

      expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
      const multiline = '来週の予定\n\n英語も復習する';
      await expect(input).toHaveValue(multiline);
      await expect(input).toBeEnabled();
      await page.getByRole('button', { name: '送信', exact: true }).click();
      await expect.poll(async () => (await events(page, 'real-runtime-complete')).length).toBe(1);
      const calls = await events(page, 'real-runtime-execute');
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.userText).toBe(multiline);
      await expect(input).toHaveValue('');
      await expect(input).toBeEnabled();
    });

    test('Ctrl+Enter and Cmd+Enter do not send a draft', async ({ page }) => {
      await page.goto(REAL_WEEKLY_URL);
      const input = await composer(page);
      await input.fill('送信ボタンを押すまで下書き');
      await input.press('Control+Enter');
      await input.press('Meta+Enter');
      expect(await events(page, 'real-runtime-execute')).toHaveLength(0);
      expect(await input.inputValue()).toContain('送信ボタンを押すまで下書き');
      await expect(input).toBeEnabled();
    });

    test('after cancellation the AI planning composer is available for continuation', async ({ page }) => {
      await page.goto(`${REAL_WEEKLY_URL}?gate=real-weekly`);
      let input = await composer(page);
      await input.fill('来週の予定');
      await page.getByRole('button', { name: '送信', exact: true }).click();
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
}
