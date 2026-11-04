import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply, VNEXT_READING_SCHEMA, RENDERER_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { openScheduleDay } from '../support/schedule-plan-cleanup.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { SAVE_ACTUAL_RECORDS_BUTTON_LABEL, formatActualRecordRow, formatActualRecordsTotal } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';
import { vnextActualRecordId } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords.ts';

// Real Pages, durable Worker and Auth/Firestore emulators; the interpretation and renderer are synthetic.
// The native schema accepts delta + studyRecords in one reading (weeklyPlanningVNextProviderSchema.ts:99-111).
// The mixed branch applies records and continues through plan projection (ExperimentalSession.ts:445-465,675-685).
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const COLLECTIONS = ['plans', 'schedule_events', 'actuals', 'weekly_planning_approval_operations', 'weekly_planning_approval_items'];
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
const composer = page => page.locator('.ai-planning-composer textarea');

test.afterEach(async ({ request }) => {
  const response = await request.post(`${SYNTHETIC}/__synthetic/reset`);
  expect(response.ok(), 'synthetic provider reset').toBe(true);
});

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  const tab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(nav.or(tab).first()).toBeVisible();
  if (await tab.isVisible()) {
    await tab.click();
    await page.getByLabel('メールアドレス').fill(test.info().project.metadata.email);
    await page.getByLabel('パスワード', { exact: true }).fill(process.env.STUDYPLANNER_LIVE_PASSWORD);
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(nav).toBeVisible();
}
async function checkpoint(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => !key.includes('.anonymous'));
    const index = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
    const active = index ? JSON.parse(localStorage.getItem(index)).activeChatId : null;
    const cores = active ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(`.${active}.core`)) : [];
    if (cores.length > 1) throw new Error(`Ambiguous active checkpoints: ${cores.length}`);
    return cores.length ? JSON.parse(localStorage.getItem(cores[0])) : null;
  });
}
// A complete server query with no limit, scoped to the current test owner.
async function ownerDocuments(request, owner, collection) {
  const response = await request.post(`${FIRESTORE}:runQuery`, { headers: { Authorization: 'Bearer owner' }, data: {
    structuredQuery: { from: [{ collectionId: collection, allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: owner } } } },
  } });
  expect(response.ok(), `owner query ${collection}`).toBe(true);
  const rows = await response.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.every(row => !row.error), `complete query ${collection}`).toBe(true);
  return rows.flatMap(row => row.document ? [row.document] : []).sort((a, b) => a.name.localeCompare(b.name));
}
async function snapshot(request, owner) {
  return Object.fromEntries(await Promise.all(COLLECTIONS.map(async collection => [collection, await ownerDocuments(request, owner, collection)])));
}
async function openPreview(page) {
  await page.getByRole('button', { name: '計画プレビューを確認', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function expectPlanOnly(dialog, planSubject, actualSubject) {
  const blocks = dialog.locator('.ai-planning-draft-block');
  await expect(blocks).toHaveCount(1);
  await expect(blocks.first()).toContainText(planSubject);
  await expect(blocks.first()).not.toContainText(actualSubject);
}

// One utterance supplies one record and one future plan. A unique title isolates
// this run's deterministic record ID without deleting another test's documents.
test('a mixed utterance keeps past actual and future plan separate across save and reload', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const posts = [];
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns' && outgoing.method() === 'POST') posts.push(outgoing);
  });
  const { yesterday, nextMonday } = await page.evaluate(() => {
    const jst = new Date(Date.now() + 9 * 3_600_000);
    const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
    const mondayOffset = (jst.getUTCDay() + 6) % 7;
    return { yesterday: new Date(today - 86_400_000).toISOString().slice(0, 10),
      nextMonday: new Date(today + (7 - mondayOffset) * 86_400_000).toISOString().slice(0, 10) };
  });
  await openScheduleDay(page, nextMonday);
  await openAiPlanning(page);
  const suffix = String(Date.now());
  const actualSubject = `数学${suffix}`;
  const planSubject = `英語${suffix}`;
  const recordId = vnextActualRecordId(owner, yesterday, actualSubject);
  const baseline = await snapshot(request, owner);
  expect(baseline.actuals.some(doc => doc.name.endsWith(`/actuals/${recordId}`))).toBe(false);

  const text = `昨日は${actualSubject}を60分やりました。来週の月曜日に${planSubject}を30分予定にしてください。`;
  const beforeMessages = await bubbles(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  const reading = await nextCall(request);
  expect(reading.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, reading, {
    planningIntent: 'create_plan', conversationActs: [], answer: null,
    delta: { add: [
      { kind: 'task', localId: 'english', category: 'study', title: planSubject },
      { kind: 'workload', localId: 'english-minutes', taskRef: { localId: 'english' }, componentRef: null,
        quantityRole: 'remaining', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
      { kind: 'task_date_rule', localId: 'english-day', taskRef: { localId: 'english' }, targetRef: { localId: 'english' },
        ruleKind: 'allowed_date', dateExpression: nextMonday, constraintLevel: 'hard' },
    ], patch: [], remove: [], relate: [], defer: [] },
    studyRecords: [{ dateExpression: yesterday, subject: actualSubject, minutes: 60 }], studyRecordQuestion: null, studyRestDays: [],
  });
  const render = await nextCall(request);
  expect(render.schema).toBe(RENDERER_SCHEMA);
  await answer(request, render, rendererReply(render));
  await expect(bubbles(page)).toHaveCount(beforeMessages + 1);
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator('.ai-planning-conversation').getByText(text, { exact: true })).toHaveCount(1);
  expect(posts).toHaveLength(1);

  const beforeSave = await checkpoint(page);
  expect(beforeSave.ownerId).toBe(owner);
  expect(beforeSave.vnext.actualRecords).toEqual([{ id: recordId, occurrenceDate: yesterday, subject: actualSubject, minutes: 60, status: 'pending' }]);
  expect(beforeSave.vnext.preview).not.toBeNull();
  expect(beforeSave.vnext.preview.blocks.length).toBeGreaterThan(0);
  expect(beforeSave.vnext.preview.blocks.every(block => block.date === nextMonday && block.title.includes(planSubject)
    && !block.title.includes(actualSubject) && !block.subject.includes(actualSubject))).toBe(true);
  const clockMinutes = value => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
  expect(beforeSave.vnext.preview.blocks.reduce((sum, block) => sum
    + (clockMinutes(block.endTime) - clockMinutes(block.startTime) + 1440) % 1440, 0)).toBe(30);
  expect(await snapshot(request, owner)).toEqual(baseline);
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  const dialog = await openPreview(page);
  await expectPlanOnly(dialog, planSubject, actualSubject);
  const records = dialog.locator('.ai-planning-actual-records-list li');
  await expect(records).toHaveCount(1);
  await expect(records.first()).toHaveText(formatActualRecordRow({ occurrenceDate: yesterday, subject: actualSubject, minutes: 60 }));
  await expect(records.first()).not.toContainText(planSubject);
  await expect(dialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(60)}`);
  await expect(dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true })).toBeVisible();
  expect(await snapshot(request, owner)).toEqual(baseline);

  // This click authorizes the actual only; the plan's promote/save controls are untouched.
  await writes.during('save-actuals', async () => {
    await dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true }).click();
    await expect(dialog.locator('.ai-planning-actual-records-save')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect.poll(() => writes.commitsIn('save-actuals').length).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await ownerDocuments(request, owner, 'actuals')).length).toBe(baseline.actuals.length + 1);
  });
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 1)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  await expectPlanOnly(dialog, planSubject, actualSubject);
  const afterSave = await snapshot(request, owner);
  for (const collection of COLLECTIONS.filter(name => name !== 'actuals')) expect(afterSave[collection]).toEqual(baseline[collection]);
  const saved = afterSave.actuals.filter(doc => doc.name.endsWith(`/actuals/${recordId}`));
  expect(saved).toHaveLength(1);
  expect(saved[0].fields.userId.stringValue).toBe(owner);
  expect(saved[0].fields.occurrenceDate.stringValue).toBe(yesterday);
  expect(saved[0].fields.subject.stringValue).toBe(actualSubject);
  expect(Number(saved[0].fields.actualDurationMinutes.integerValue)).toBe(60);
  expect(saved[0].fields.planId === undefined || saved[0].fields.planId.nullValue === null).toBe(true);
  expect(saved[0].fields.actualStartTime).toBeUndefined();
  expect(saved[0].fields.actualEndTime).toBeUndefined();
  expect(afterSave.actuals.filter(doc => !doc.name.endsWith(`/actuals/${recordId}`))).toEqual(baseline.actuals);

  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await openScheduleDay(page, nextMonday);
  await openAiPlanning(page);
  const restored = await checkpoint(page);
  expect(restored.conversationId).toBe(beforeSave.conversationId);
  expect(restored.vnext.preview).toEqual(beforeSave.vnext.preview);
  expect(restored.vnext.actualRecords).toEqual([{ ...beforeSave.vnext.actualRecords[0], status: 'saved' }]);
  expect(await snapshot(request, owner)).toEqual(afterSave);
  await expect(page.locator('.ai-planning-actual-card')).toHaveCount(0);
  const restoredDialog = await openPreview(page);
  await expectPlanOnly(restoredDialog, planSubject, actualSubject);
  await expect(restoredDialog.locator('.ai-planning-actual-records-list li')).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(writes.violations()).toEqual([]);
});
