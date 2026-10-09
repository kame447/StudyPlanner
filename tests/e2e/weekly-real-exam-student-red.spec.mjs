import { expect, test } from '@playwright/test';
import { CORRECTION_PROMPT, MATH_DOWN_PROMPT, OVERLOAD_PROMPT } from './support/examStudentScenario.mjs';
import { checkBlocks, classifyTitle } from './support/examStudentOracle.mjs';
import {
  boot, bulkToPreview, capturePreview, installGuards, nav, openWeekly, promoteAndApprove, rendererDecisions, savedStudyBlocks, sendAndSettle,
} from './support/examStudentFlow.mjs';

// B1-B3 were RED product blockers found by the exam-student persona and are now regression tests with the
// original assertions (B3 strengthened to the typed shortfall). B4 stays RED. Synthetic isolated, scripted provider.
// Controls (green) in the same file prove the failing step differs only in the path under test.
const externalRequests = [];
test.beforeEach(async ({ page }) => { externalRequests.length = 0; await installGuards(page, externalRequests); });
test.afterEach(async () => { expect(externalRequests, 'no request may leave loopback').toEqual([]); });

const previewButton = page => page.getByRole('button', { name: '計画プレビューを確認' });

test.describe('control: the same final state is plannable when requested up front', () => {
  test('a fresh request with math 20 problems gets a clean preview on the identical seed', async ({ page }) => {
    await boot(page, 'full', '&math=20'); await openWeekly(page); await bulkToPreview(page);
    const preview = await capturePreview(page);
    const result = checkBlocks(preview, { quantities: { 'math-calculus': 20 } });
    expect(result.hard).toEqual([]);
    expect(preview.length).toBeGreaterThanOrEqual(20);
  });
});

test.describe('regression B1: reducing a workload on a retained preview', () => {
  for (const [label, prompt] of [['math 30 -> 20 alone', MATH_DOWN_PROMPT], ["the fixture's combined utterance (math 30 -> 20 and English to the weekend)", CORRECTION_PROMPT]]) {
    test(`${label} recomputes a preview instead of claiming insufficient capacity`, async ({ page }) => {
      await boot(page); await openWeekly(page); await bulkToPreview(page);
      await page.keyboard.press('Escape');
      await sendAndSettle(page, prompt);
      const decisions = await rendererDecisions(page);
      const last = decisions[decisions.length - 1];
      // Expected: preview_ready (less work than the plan that was just feasible). Actual: question insufficient_capacity, previewCount 0.
      expect({ actionKind: last.actionKind, questionCode: last.questionCode }, 'application decision after the reduction').toEqual({ actionKind: 'preview_ready', questionCode: null });
      await expect(previewButton(page)).toBeVisible();
      const preview = await capturePreview(page);
      expect(checkBlocks(preview, { quantities: { 'math-calculus': 20 } }).hard).toEqual([]);
    });
  }
});

test.describe('regression B2: MonthEvent-backed busy time is ignored by the planner', () => {
  test('life buffers seeded as MonthEvents are loaded by the app but the preview overlaps them', async ({ page }) => {
    await boot(page, 'monthBuffers');
    // Boundary: the app's own read side loads them (the month grid renders them), so the planner is the gap.
    await nav(page).getByRole('button', { name: '予定', exact: true }).click();
    await page.getByRole('tab', { name: '月', exact: true }).click();
    await expect(page.getByRole('grid', { name: '月間カレンダー' })).toContainText('夕食');
    await openWeekly(page); await bulkToPreview(page);
    const preview = await capturePreview(page);
    const result = checkBlocks(preview);
    const bufferCollisions = result.hard.filter(violation => violation.includes('collides with buffer'));
    // Expected: 0 buffer collisions (a Plan-backed buffer is honored: see the main spec). Actual: collisions with 夕食 / 塾への移動.
    expect(bufferCollisions, 'blocks overlapping MonthEvent-backed buffers').toEqual([]);
  });
});

test.describe('regression B3: an overload carries the unmet duration/quantity to the reply', () => {
  test('the typed decision names the required minutes and the unmet work, and the reply states them', async ({ page }) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    await page.keyboard.press('Escape');
    await sendAndSettle(page, OVERLOAD_PROMPT);
    const all = (await page.evaluate(() => window.__examHarness)).rendererRequests;
    const last = all[all.length - 1];
    expect(last.applicationDecision.questionCode, 'precondition: the product asked the capacity question').toBe('insufficient_capacity');
    // The typed shortfall rides in applicationDecision.communication (the only channel for the unmet amount).
    const shortfall = last.applicationDecision.communication.capacityShortfall;
    expect(shortfall, 'typed capacityShortfall').toBeTruthy();
    // Total need of the requested week: the original 1,088 min plus the +720 min overload is 1,808 min before the product's own rounding.
    expect(shortfall.requiredMinutes, 'required minutes cover at least the 1,808 minute minimum').toBeGreaterThanOrEqual(1808);
    expect(shortfall.unmetMinutes, 'unmet minutes').toBeGreaterThan(0);
    // The listed items may be a subset (moreCount counts the rest), but must be non-empty, positive and requested work.
    expect(shortfall.unmetWork.length, 'unmet work is listed').toBeGreaterThan(0);
    for (const item of shortfall.unmetWork) {
      expect(item.minutes, `unmet minutes of ${item.label}`).toBeGreaterThan(0);
      expect(classifyTitle(item.label), `${item.label} is a requested task`).not.toBeNull();
    }
    // The visible reply (app-owned sentence) states what did not fit and the required total.
    const reply = (await page.locator('.ai-planning-message-row').allTextContents()).at(-1);
    expect(reply, 'visible reply').toContain('入りきらなかった作業');
    expect(reply, 'visible reply states the required total').toContain(String(shortfall.requiredMinutes).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  });
});

test.describe('RED B4: the saved weekly plan exceeds the persona daily-load caps', () => {
  test('canonical daily caps (rules.maximumNewStudyMinutesPerDay) hold for the saved blocks', async ({ page }) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    await promoteAndApprove(page);
    await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);
    const saved = await savedStudyBlocks(page);
    expect(saved.length).toBeGreaterThanOrEqual(20);
    const result = checkBlocks(saved);
    expect(result.hard, 'hard constraints are covered by the main spec').toEqual([]);
    // Expected: 0 daily-capacity errors (the campaign oracle's check_candidates counts them as errors).
    // Actual: Sat 10/17 315/300 and Sun 10/18 325/240 (the reserve day is the heaviest). The product is not given these caps.
    expect(result.advisory, 'daily load above the persona caps').toEqual([]);
  });
});
