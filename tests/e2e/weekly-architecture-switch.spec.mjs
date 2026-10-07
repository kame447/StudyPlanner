import { expect, test } from '@playwright/test';

/*
 * Issue #488 comparison switch, browser flow. A second instance of the real-weekly harness
 * (port 4175) is built with VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1. The real
 * controller, reducer, storage, preference resolver, selector, evaluation strip and
 * measurement collector run; the runtime result - and therefore the provider dispatch counts -
 * is scripted by the gateway stub (see scriptDispatches there), so this spec proves the
 * switch/pinning/measurement PLUMBING and what the operator can read, not model behaviour.
 */
const URL = 'http://127.0.0.1:4175/real-weekly.html?interaction=1&settings=1';
const LEGACY = '旧Stable V5';
const INTERACTION = '新Interaction V1';

test.describe.configure({ retries: 0 });

async function send(page, text) {
  const input = page.locator('.ai-planning-composer textarea');
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill(text);
  await input.press('Enter');
}

function mode(page) {
  return page.getByTestId('architecture-eval-mode');
}

/** Runs `action` with the (harness stand-in for the) settings dialog open, then closes it. */
async function withSettings(page, action) {
  await page.getByTestId('harness-open-settings').click();
  const selector = page.getByTestId('weekly-planning-architecture-setting');
  await expect(selector).toBeVisible();
  await action(selector);
  await page.getByTestId('harness-close-settings').click();
}

async function latestMetrics(page) {
  const panel = page.getByTestId('architecture-eval-metrics');
  return {
    sequence: Number(await panel.getAttribute('data-sequence')),
    architecture: await panel.locator('[data-metric="mode"]').getAttribute('data-architecture'),
    elapsed: Number(await panel.locator('[data-metric="elapsed-ms"]').getAttribute('data-value')),
    dispatches: Number(await panel.locator('[data-metric="ai-dispatches"]').getAttribute('data-value')),
    outcome: await panel.locator('[data-metric="outcome"]').innerText(),
  };
}

async function waitForTurn(page, sequence) {
  await expect.poll(async () => Number(
    await page.getByTestId('architecture-eval-metrics').getAttribute('data-sequence'),
  )).toBe(sequence);
}

for (const device of [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]) {
  test.describe(`architecture switch (${device.name})`, () => {
    test.use({ viewport: device.viewport });

    test('selector applies to new conversations only; each conversation shows its pinned mode and metrics', async ({ page }) => {
      await page.goto(URL);

      // Selector: both modes, scoped to the NEXT new conversation; default is the new architecture.
      await withSettings(page, async (selector) => {
        await expect(selector.getByRole('radio', { name: LEGACY })).toBeVisible();
        await expect(selector.getByRole('radio', { name: INTERACTION })).toBeVisible();
        await expect(selector).toContainText('次の新規AI計画会話から適用');
        await expect(selector.getByRole('radio', { name: INTERACTION })).toHaveAttribute('aria-checked', 'true');
        await selector.getByRole('radio', { name: LEGACY }).click();
        await expect(selector.getByRole('radio', { name: LEGACY })).toHaveAttribute('aria-checked', 'true');
      });

      // Empty chat: nothing pinned yet; the strip says what the first send will pin.
      await expect(mode(page)).toContainText('未固定');
      await expect(mode(page)).toContainText(LEGACY);

      // First turn pins the legacy architecture; the strip proves it and shows the metrics.
      await send(page, 'SETUP 数学のワーク');
      await waitForTurn(page, 1);
      await expect(mode(page)).toHaveText(LEGACY);
      await expect(mode(page)).toHaveAttribute('data-architecture', 'legacy_v5');
      expect(await latestMetrics(page)).toMatchObject({ architecture: 'legacy_v5', dispatches: 2 });

      // Changing the preference must not touch the running conversation.
      await withSettings(page, (selector) => selector.getByRole('radio', { name: INTERACTION }).click());
      await expect(mode(page)).toHaveText(LEGACY);
      await send(page, 'EXPLAIN なんで時間が必要？');
      await waitForTurn(page, 2);
      // legacy explanation: the historical completeness retries (scripted 3 semantic + 1 renderer)
      expect(await latestMetrics(page)).toMatchObject({ architecture: 'legacy_v5', dispatches: 4 });
      await expect(mode(page)).toHaveText(LEGACY);

      // A new conversation captures the current preference (interaction) exactly once.
      await page.evaluate(() => window.__realWeeklyActions.resetSession());
      await expect(mode(page)).toContainText('未固定');
      await expect(mode(page)).toContainText(INTERACTION);
      await send(page, 'SETUP 数学のワーク');
      await waitForTurn(page, 3);
      await expect(mode(page)).toHaveText(INTERACTION);
      await expect(mode(page)).toHaveAttribute('data-architecture', 'interaction_v1');
      await send(page, 'EXPLAIN なんで時間が必要？');
      await waitForTurn(page, 4);
      const interactionExplain = await latestMetrics(page);
      expect(interactionExplain).toMatchObject({ architecture: 'interaction_v1', dispatches: 2 });
      expect(interactionExplain.outcome).toContain('explain_pending_question');
      expect(interactionExplain.elapsed).toBeGreaterThanOrEqual(0);

      // Reload keeps the pinned mode of the persisted conversation.
      await page.reload();
      await expect(mode(page)).toHaveText(INTERACTION);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    for (const architecture of [
      // Legacy keeps its pre-#488 fixed failure message (an unrelated generic question).
      {
        key: 'legacy_v5',
        label: LEGACY,
        check: (reply) => expect(reply).toContain('まず、いつの予定を作るか'),
      },
      // Interaction re-presents the pending question itself, without a system disclaimer.
      {
        key: 'interaction_v1',
        label: INTERACTION,
        check: (reply) => {
          expect(reply).toContain('1問あたりどれくらい時間がかかりますか？');
          expect(reply).not.toMatch(/予定条件|安全に整理|確認中の質問|いつの予定を作るか/u);
        },
      },
    ]) {
      test(`a failed turn is measured as a failure and presented per architecture (${architecture.key})`, async ({ page }) => {
        await page.goto(URL);
        await withSettings(page, (selector) => selector.getByRole('radio', { name: architecture.label }).click());
        await send(page, 'SETUP 数学のワーク');
        await waitForTurn(page, 1);
        await send(page, 'FAIL えっと');
        await waitForTurn(page, 2);
        const failed = await latestMetrics(page);
        expect(failed.outcome).toContain('失敗 stable_v5_normalization_rejected');
        expect(failed.architecture).toBe(architecture.key);
        const bubbles = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble:not(.ai-planning-typing)');
        await expect(bubbles).toHaveCount(2);
        architecture.check(await bubbles.nth(1).innerText());
        await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
      });
    }
  });
}
