import { expect, test } from '@playwright/test';

/*
 * Issue #488 browser flow: pending question -> explanation -> recovery after a failed turn
 * -> the next short answer. The real controller/reducer/storage and AiPlanningView run; the
 * runtime result is scripted by the harness gateway stub, which also records the question
 * presentation freshness the real state had at the start of every turn.
 */
const URL = 'http://127.0.0.1:4174/real-weekly.html?interaction=1';
const QUESTION = '数学のワークは1問あたりどれくらい時間がかかりますか？';

test.describe.configure({ retries: 0 });

async function interactionTurns(page) {
  return page.evaluate(() => (window.__realWeeklyEvents ?? [])
    .filter((event) => event.type === 'real-interaction-turn')
    .map((event) => event.payload));
}

async function send(page, text) {
  const input = page.locator('.ai-planning-composer textarea');
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill(text);
  await input.press('Enter');
}

for (const device of [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]) {
  test.describe(`conversation interaction (${device.name})`, () => {
    test.use({ viewport: device.viewport });

    test('explains the pending question, recovers from a failed turn, and keeps the answer bound', async ({ page }) => {
      await page.goto(URL);

      await send(page, 'SETUP 数学のワーク');
      await expect(page.getByText(QUESTION, { exact: true })).toHaveCount(1);

      await send(page, 'EXPLAIN なんで時間が必要？');
      await expect(page.getByText(/この確認は、予定を無理なく配置するために必要です。/)).toHaveCount(1);

      await send(page, 'FAIL えっと');
      const recovery = page.getByText(/予定条件には反映していません。確認中の質問は変わりません。/);
      await expect(recovery).toHaveCount(1);
      await expect(recovery).toContainText(QUESTION);
      // The composer stays usable after the recovery turn (no dead turn).
      await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();

      await send(page, 'ANSWER 1問3分');
      await expect.poll(async () => (await interactionTurns(page)).length).toBe(4);

      // Every turn after the first saw the previously presented question as fresh, including
      // after the explanation and after the recovery message (rebound to its message).
      expect((await interactionTurns(page)).map((turn) => turn.freshness)).toEqual([
        'no_question', 'fresh', 'fresh', 'fresh',
      ]);

      // No horizontal overflow on either viewport.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('an aside keeps the old question but does not re-arm it for a later short reply', async ({ page }) => {
      await page.goto(URL);
      await send(page, 'SETUP 数学のワーク');
      await expect(page.getByText(QUESTION, { exact: true })).toHaveCount(1);

      await send(page, 'ASIDE ちょっと別の話');
      await expect(page.getByText(/ここまでの内容は変更していません/)).toHaveCount(1);
      await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();

      await send(page, 'ANSWER うん');
      await expect.poll(async () => (await interactionTurns(page)).length).toBe(3);
      // setup saw no question; the aside saw the fresh question; the reply after the aside
      // sees it exactly unbound, so a short reply cannot bind to it.
      expect((await interactionTurns(page)).map((turn) => turn.freshness)).toEqual([
        'no_question', 'fresh', 'unbound',
      ]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
