import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ENGLISH_WEEKEND_PROMPT, LESSON_PROMPT, fixture } from './support/examStudentScenario.mjs';
import { checkBlocks } from './support/examStudentOracle.mjs';
import {
  boot, bulkToPreview, byDate, capturePreview, content, expectMonthMatches, installGuards, nav, openWeekly, previewDialog,
  promoteAndApprove, savedStudyBlocks, sendAndSettle, seededRows, weekViewEntries, studyOnly,
} from './support/examStudentFlow.mjs';

// Follow-up variants and save robustness for the exam-student persona (synthetic, isolated; scripted provider).
const externalRequests = [];
test.beforeEach(async ({ page }) => { externalRequests.length = 0; await installGuards(page, externalRequests); });
test.afterEach(async () => { expect(externalRequests, 'no request may leave loopback').toEqual([]); });

const CAPTURES = path.join(process.cwd(), 'artifacts/weekly-real-exam-student-captures');
function capture(testInfo, name, value) {
  fs.mkdirSync(CAPTURES, { recursive: true });
  fs.writeFileSync(path.join(CAPTURES, `${testInfo.project.name}-${name}.json`), JSON.stringify(value, null, 1));
}
const LESSON = [{ date: '2026-10-14', startTime: '17:30', endTime: '19:30', reason: '急な補講' }];

test.describe('exam student: approval robustness', () => {
  test('a double approval click and re-approval after reload create no duplicates', async ({ page }, testInfo) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    const preview = await capturePreview(page);
    await promoteAndApprove(page, { double: true });
    await expect(previewDialog(page)).toHaveCount(0);
    const saved = await savedStudyBlocks(page);
    capture(testInfo, 'double-approve-saved', saved);
    expect(saved.map(content)).toEqual(byDate(preview).map(content));
    expect(new Set(saved.map(row => row.id)).size).toBe(preview.length);
    await page.reload();
    await expect(nav(page)).toBeVisible();
    await openWeekly(page);
    await expect(page.getByRole('button', { name: 'この内容で保存' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'この内容で仮予定にする' })).toHaveCount(0);
    const again = await savedStudyBlocks(page);
    expect(again.map(row => row.id), 'same ids after reload').toEqual(saved.map(row => row.id));
    expect(await seededRows(page)).toHaveLength(fixture.existingEvents.length + fixture.lifeBuffers.length);
  });

  test('an interrupted save stays retryable: nothing lost, nothing duplicated, finally identical to the preview', async ({ page }, testInfo) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failures = 0;
      window.__injectedStorageFailures = () => failures;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === 'studyplanner.scheduleEvents.v1' && failures === 0 && String(value).includes('weekly-approval')) {
          failures += 1;
          throw new Error('Synthetic plan write failure');
        }
        return original.call(this, key, value);
      };
    });
    const preview = await capturePreview(page);
    await promoteAndApprove(page);
    await expect.poll(() => page.evaluate(() => window.__injectedStorageFailures())).toBe(1);
    const dialog = previewDialog(page);
    await expect(dialog.getByText('未保存分だけ再試行できます', { exact: false })).toBeVisible();
    const remaining = await dialog.locator('.ai-planning-draft-block').count();
    const partial = await savedStudyBlocks(page);
    capture(testInfo, 'interrupted-partial', { partial, remaining });
    expect(partial.length + remaining, 'every block is stored or still retryable').toBe(preview.length);
    expect(new Set(partial.map(row => row.id)).size).toBe(partial.length);
    await dialog.getByRole('button', { name: 'この内容で保存' }).click();
    await expect(previewDialog(page)).toHaveCount(0);
    const saved = await savedStudyBlocks(page);
    expect(saved.map(content), 'retry completes exactly the preview').toEqual(byDate(preview).map(content));
    expect(new Set(saved.map(row => row.id)).size).toBe(preview.length);
    await page.reload();
    await expect(nav(page)).toBeVisible();
    expect((await savedStudyBlocks(page)).map(row => row.id)).toEqual(saved.map(row => row.id));
  });
});

test.describe('exam student: follow-up variants on the retained preview', () => {
  test('a midweek lesson and then English reading to the weekend recompute the plan and preserve everything else', async ({ page }, testInfo) => {
    await boot(page); await openWeekly(page); await bulkToPreview(page);
    const base = await capturePreview(page);
    await page.keyboard.press('Escape');

    // 1) Wednesday 17:30-19:30 lesson: nothing may overlap it; every quantity and commitment stays.
    await sendAndSettle(page, LESSON_PROMPT);
    const afterLesson = await capturePreview(page);
    capture(testInfo, 'variant-lesson-preview', afterLesson);
    const lessonResult = checkBlocks(afterLesson, { extraBlocked: LESSON });
    capture(testInfo, 'variant-lesson-oracle', lessonResult);
    expect(lessonResult.hard, 'after the lesson').toEqual([]);
    expect(afterLesson.length, 'positive placements').toBeGreaterThanOrEqual(20);
    const moved = base.filter(row => !afterLesson.some(other => JSON.stringify(content(other)) === JSON.stringify(content(row))));
    testInfo.annotations.push({ type: 'observation', description: `blocks changed by the lesson: ${moved.length} of ${base.length}` });
    await page.keyboard.press('Escape');

    // 2) English reading only on the weekend; the other tasks keep their quantities and deadlines.
    await sendAndSettle(page, ENGLISH_WEEKEND_PROMPT);
    const afterEnglish = await capturePreview(page);
    capture(testInfo, 'variant-english-preview', afterEnglish);
    const englishResult = checkBlocks(afterEnglish, { extraBlocked: LESSON, mustBeOnOrAfter: { 'english-reading': '2026-10-17' } });
    capture(testInfo, 'variant-english-oracle', englishResult);
    expect(englishResult.hard, 'after English to the weekend').toEqual([]);

    await promoteAndApprove(page);
    await expect(previewDialog(page)).toHaveCount(0);
    const saved = await savedStudyBlocks(page);
    expect(saved.map(content), 'saved equals the last preview').toEqual(byDate(afterEnglish).map(content));
    expect(studyOnly(byDate(await weekViewEntries(page))).map(content)).toEqual(saved.map(content));
    await expectMonthMatches(page, saved);
    await page.reload();
    await expect(nav(page)).toBeVisible();
    expect((await savedStudyBlocks(page)).map(row => row.id)).toEqual(saved.map(row => row.id));
    expect(await seededRows(page)).toHaveLength(fixture.existingEvents.length + fixture.lifeBuffers.length);
  });
});
