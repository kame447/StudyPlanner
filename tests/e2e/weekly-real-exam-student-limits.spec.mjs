import { expect, test } from '@playwright/test';
import { AMBIGUOUS_PROMPT, OVERLOAD_FOLLOWUP, OVERLOAD_PROMPT, fixture } from './support/examStudentScenario.mjs';
import { checkBlocks } from './support/examStudentOracle.mjs';
import {
  boot, bulkToPreview, capturePreview, content, installGuards, openWeekly, rendererDecisions, savedStudyBlocks, sendAndSettle,
  weekViewEntries,
} from './support/examStudentFlow.mjs';

// Overload, ambiguity and source variations for the exam-student persona (synthetic, isolated; scripted provider).
const externalRequests = [];
test.beforeEach(async ({ page }) => { externalRequests.length = 0; await installGuards(page, externalRequests); });
test.afterEach(async () => { expect(externalRequests, 'no request may leave loopback').toEqual([]); });

const previewButton = page => page.getByRole('button', { name: '計画プレビューを確認' });
const lastDecision = async page => { const all = await rendererDecisions(page); return all[all.length - 1]; };

test.describe('exam student: overload (+720 min, 1,808 min minimum)', () => {
  test('an overload is neither silently dropped nor saved, and withdrawing it restores a clean plan', async ({ page }) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    await page.keyboard.press('Escape');
    await sendAndSettle(page, OVERLOAD_PROMPT);
    const decision = await lastDecision(page);
    expect({ actionKind: decision.actionKind, questionCode: decision.questionCode, previewCount: decision.previewCount }, 'explicit capacity question, no partial preview')
      .toEqual({ actionKind: 'question', questionCode: 'insufficient_capacity', previewCount: 0 });
    await expect(previewButton(page), 'the earlier preview (without the extra 120 problems) is not offered as if it were the plan').toHaveCount(0);
    expect(await savedStudyBlocks(page), 'nothing is saved').toEqual([]);

    // Safe replanning path: the user withdraws the extra work; the original 9 items come back exactly.
    await sendAndSettle(page, OVERLOAD_FOLLOWUP);
    await expect(previewButton(page)).toBeVisible({ timeout: 30_000 });
    const preview = await capturePreview(page);
    expect(checkBlocks(preview).hard).toEqual([]);
    expect(preview.length).toBeGreaterThanOrEqual(20);
    expect(await savedStudyBlocks(page), 'still nothing saved before approval').toEqual([]);
  });
});

test.describe('exam student: clarification and busy-source variations', () => {
  test('an under-specified request asks first: no preview, nothing saved', async ({ page }) => {
    await boot(page); await openWeekly(page);
    await sendAndSettle(page, AMBIGUOUS_PROMPT);
    const decision = await lastDecision(page);
    expect(decision.actionKind).toBe('question');
    expect(decision.previewCount).toBe(0);
    await expect(previewButton(page)).toHaveCount(0);
    expect(await savedStudyBlocks(page)).toEqual([]);
  });

  test('another owner\'s calendar rows never become this student\'s busy time or appear in the UI', async ({ page }) => {
    await boot(page, 'foreign'); await openWeekly(page);
    expect(await weekViewEntries(page), 'no foreign event is shown').toEqual([]);
    await openWeekly(page);
    await bulkToPreview(page);
    const preview = await capturePreview(page);
    const result = checkBlocks(preview, { noBusy: true });
    expect(result.hard).toEqual([]);
    expect(preview.some(block => block.startTime < '15:40' && block.date <= '2026-10-16'), 'weekday school hours of the other owner are usable').toBe(true);
    expect(await savedStudyBlocks(page)).toEqual([]);
  });

  test('with no busy rows at all the plan is still complete and valid', async ({ page }) => {
    await boot(page, 'noBusy'); await openWeekly(page); await bulkToPreview(page);
    const preview = await capturePreview(page);
    expect(checkBlocks(preview, { noBusy: true }).hard).toEqual([]);
    expect(preview.length).toBeGreaterThanOrEqual(20);
    expect(fixture.existingEvents.length).toBe(15);
  });
});
