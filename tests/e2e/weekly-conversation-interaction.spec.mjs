import { expect, test } from '@playwright/test';

/*
 * Issue #488 browser flow: pending question -> explanation -> recovery after a failed turn
 * -> the next short answer. The real controller/reducer/storage and AiPlanningView run; the
 * runtime result is scripted by the harness gateway stub, which also records the question
 * presentation freshness the real state had at the start of every turn.
 */
const URL = 'http://127.0.0.1:4174/real-weekly.html?interaction=1';
const QUESTION = '数学のワークは1問あたりどれくらい時間がかかりますか？';
/** Internal system/process vocabulary that must never reach an assistant reply. */
const INTERNAL_PROCESS_WORDING = /予定条件|安全に整理|反映していません|確認中の質問|保留中|構造化|正規化|処理/u;

/** Assistant message bubbles (the typing indicator excluded), waiting for the expected count. */
async function assistantReply(page, count) {
  const bubbles = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble:not(.ai-planning-typing)');
  await expect(bubbles).toHaveCount(count);
  return bubbles.nth(count - 1).innerText();
}

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
      // The explanation keeps the question it explains and talks about no app internals.
      const explanation = await assistantReply(page, 2);
      expect(explanation).toContain(QUESTION);
      expect(explanation).not.toMatch(INTERNAL_PROCESS_WORDING);

      await send(page, 'FAIL えっと');
      // The recovery re-presents the same question without a system disclaimer.
      const recovery = await assistantReply(page, 3);
      expect(recovery).toContain(QUESTION);
      expect(recovery).not.toMatch(INTERNAL_PROCESS_WORDING);
      expect(recovery).not.toContain('いつの予定を作るか');
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
      // The aside is acknowledged without asking the held question or describing held state.
      const aside = await assistantReply(page, 2);
      expect(aside).not.toContain(QUESTION);
      expect(aside).not.toMatch(INTERNAL_PROCESS_WORDING);
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
