import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fixture } from './support/examStudentScenario.mjs';
import { checkBlocks, requestedQuantity } from './support/examStudentOracle.mjs';
import {
  boot, bulkToPreview, byDate, capturePreview, content, dayViewEntries, expectMonthMatches, installGuards, nav, openWeekly,
  promoteAndApprove, savedStudyBlocks, seededRows, studyOnly, weekViewEntries,
} from './support/examStudentFlow.mjs';

// Synthetic isolated exam-student persona E2E (Issue #488). NOT Firestore, NOT online, NOT a real provider.
// REAL: production App, turn runtime/controller/reducer, scheduler, preview, approval and the production
// local repository over this profile's localStorage. SUBSTITUTED: the provider wire (a scripted semantic
// document: a DECLARED LIMITATION, this tests the application and not model understanding) and the store.
const externalRequests = [];
test.beforeEach(async ({ page }) => { externalRequests.length = 0; await installGuards(page, externalRequests); });
test.afterEach(async () => { expect(externalRequests, 'no request may leave loopback').toEqual([]); });

const CAPTURES = path.join(process.cwd(), 'artifacts/weekly-real-exam-student/captures');
function capture(testInfo, name, value) {
  fs.mkdirSync(CAPTURES, { recursive: true });
  fs.writeFileSync(path.join(CAPTURES, `${testInfo.project.name}-${name}.json`), JSON.stringify(value, null, 1));
}
function expectClean(result, label) {
  expect(result.hard, `${label}: hard violations`).toEqual([]);
}

test.describe('exam student: seeded commitments and the bulk weekly request', () => {
  test('15 events and 14 buffers load through the product read side and survive a reload', async ({ page }) => {
    await boot(page);
    const before = await seededRows(page);
    expect(before).toHaveLength(fixture.existingEvents.length + fixture.lifeBuffers.length);
    const week = await weekViewEntries(page);
    expect(byDate(week).map(content)).toEqual(byDate([...fixture.existingEvents, ...fixture.lifeBuffers.map(buffer => ({ ...buffer, title: buffer.reason }))]).map(content));
    await page.reload();
    await expect(nav(page)).toBeVisible();
    expect(await seededRows(page), 'identical rows after reload').toEqual(before);
    expect(await savedStudyBlocks(page), 'no weekly plan exists before approval').toEqual([]);
  });

  test('bulk request: validated preview, independent oracle, approval, saved plans, week/day views, reload', async ({ page }, testInfo) => {
    await boot(page);
    await openWeekly(page);
    await bulkToPreview(page);
    expect(await savedStudyBlocks(page), 'nothing durable before approval').toEqual([]);

    const preview = await capturePreview(page);
    capture(testInfo, 'bulk-preview', preview);
    const previewResult = checkBlocks(preview);
    capture(testInfo, 'bulk-preview-oracle', previewResult);
    expectClean(previewResult, 'preview');
    expect(preview.length, 'positive placements').toBeGreaterThanOrEqual(20);
    testInfo.annotations.push({ type: 'observation', description: `preview ${preview.length} blocks / ${previewResult.totals.minutes} min; advisory: ${previewResult.advisory.join('; ') || 'none'}; earliest start ${preview.map(b => b.startTime).sort()[0]}, latest end ${preview.map(b => b.endTime).sort().at(-1)}; last math ${preview.filter(b => b.title.startsWith('数学')).map(b => b.date).sort().at(-1)}` });
    for (const [id, entry] of Object.entries(previewResult.perTask)) {
      const task = fixture.workloads.find(item => item.id === id);
      expect(entry.quantity, `${id} quantity`).toBe(requestedQuantity(task).quantity);
    }

    await promoteAndApprove(page);
    await expect(page.getByRole('dialog', { name: '計画プレビュー' })).toHaveCount(0);
    const saved = await savedStudyBlocks(page);
    capture(testInfo, 'bulk-saved', saved);
    expect(saved.map(content), 'saved equals previewed').toEqual(byDate(preview).map(content));
    expect(new Set(saved.map(row => row.id)).size, 'distinct record ids').toBe(saved.length);
    expectClean(checkBlocks(saved), 'saved');

    const week = studyOnly(await weekViewEntries(page));
    expect(byDate(week).map(content), 'week view equals saved').toEqual(saved.map(content));
    const day = studyOnly(await dayViewEntries(page));
    expect(byDate(day).map(content), 'day views equal saved').toEqual(saved.map(content));
    await expectMonthMatches(page, saved);

    await page.reload();
    await expect(nav(page)).toBeVisible();
    const afterReload = await savedStudyBlocks(page);
    expect(afterReload.map(row => row.id), 'identical ids after reload').toEqual(saved.map(row => row.id));
    expect(afterReload.map(content), 'identical times/titles after reload').toEqual(saved.map(content));
    expect(studyOnly(byDate(await weekViewEntries(page))).map(content)).toEqual(saved.map(content));
    await expectMonthMatches(page, saved);
    expect((await seededRows(page)).length, 'seeded commitments untouched').toBe(fixture.existingEvents.length + fixture.lifeBuffers.length);
  });
});
