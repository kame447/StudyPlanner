import { expect, test } from '@playwright/test';
import { CORRECTION_PROMPT, MATH_DOWN_PROMPT, OVERLOAD_PROMPT } from './support/examStudentScenario.mjs';
import { checkBlocks } from './support/examStudentOracle.mjs';
import {
  boot, bulkToPreview, capturePreview, installGuards, nav, openWeekly, promoteAndApprove, rendererDecisions, savedStudyBlocks, sendAndSettle,
} from './support/examStudentFlow.mjs';

// RED tests: reproducible product blockers found by the exam-student persona (Issue #488, synthetic isolated,
// scripted provider). Each failure names the exact step. Assertions are the product contract; they are NOT weakened.
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

test.describe('RED B1: reducing a workload on a retained preview', () => {
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

test.describe('RED B2: MonthEvent-backed busy time is ignored by the planner', () => {
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

test.describe('RED B3: an overload does not carry the unmet duration/quantity to the reply', () => {
  test('the renderer input for insufficient_capacity names the requested overload, not only a generic question code', async ({ page }) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    await page.keyboard.press('Escape');
    await sendAndSettle(page, OVERLOAD_PROMPT);
    const all = await (await page.evaluate(() => window.__examHarness)).rendererRequests;
    const last = all[all.length - 1];
    expect(last.applicationDecision.questionCode, 'precondition: the product asked the capacity question').toBe('insufficient_capacity');
    // The user asked for +120 problems (+720 minutes, 1,808 minimum). The typed decision handed to the reply
    // writer is the only channel for the unmet amount; expected: at least one of those figures. Actual: none.
    const decisionText = JSON.stringify(last.applicationDecision);
    expect(['120', '720', '1808'].some(figure => decisionText.includes(figure)), `decision carried no unmet figure: ${decisionText.slice(0, 200)}`).toBe(true);
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
