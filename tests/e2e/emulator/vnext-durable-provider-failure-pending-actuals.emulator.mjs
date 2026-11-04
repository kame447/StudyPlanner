import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply, VNEXT_READING_SCHEMA, RENDERER_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, formatActualRecordRow, formatActualRecordsTotal } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';
import { interpretationFailureReply } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextExperimentalSession.ts';

const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const composer = page => page.locator('.ai-planning-composer textarea');
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
const providerCount = async request => (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;

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
async function send(page, text) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
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
async function actualDocument(request, id) {
  const response = await request.get(`${FIRESTORE}/actuals/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status() === 404) return null;
  expect(response.ok(), `emulator read ${id}: ${response.status()}`).toBe(true);
  return response.json();
}
async function readTurn(request, reading, renderer = true) {
  const call = await nextCall(request);
  expect(call.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, call, reading);
  if (!renderer) return;
  const render = await nextCall(request);
  expect(render.schema).toBe(RENDERER_SCHEMA);
  await answer(request, render, rendererReply(render));
}
async function sentTurn(page, request, text, reading, renderer = true) {
  const count = await bubbles(page).count();
  await send(page, text);
  await readTurn(request, reading, renderer);
  await expect(bubbles(page)).toHaveCount(count + 1);
  await expect(composer(page)).toBeEnabled();
}

// Real Pages, durable Worker and Firestore/Auth emulators; only the AI provider is synthetic.
test('provider 500 keeps pending actuals and the preview, then the user corrects and saves the record', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const posts = [];
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns' && outgoing.method() === 'POST') posts.push(outgoing);
  });
  await openAiPlanning(page);
  await goToTargetPlannerWeek(page);

  await sentTurn(page, request, '数学を60分', { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
    ...EMPTY, add: [
      { kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'math-minutes', taskRef: { localId: 'math' }, componentRef: null,
        quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ],
  } });
  await sentTurn(page, request, 'この条件で予定を作って', { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: EMPTY });
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();

  // A unique subject isolates this test's deterministic actual ID from other emulator runs.
  const subject = `理科${Date.now()}`;
  const date = await page.evaluate(() => new Date(Date.now() + 9 * 3_600_000 - 86_400_000).toISOString().slice(0, 10));
  const recordText = `昨日は${subject}を35分勉強しました。`;
  const readingFor = minutes => ({ planningIntent: 'discuss', conversationActs: [], answer: null, delta: EMPTY,
    studyRecords: [{ dateExpression: date, subject, minutes }], studyRecordQuestion: null, studyRestDays: [] });
  await sentTurn(page, request, recordText, readingFor(35), false);
  await expect(page.locator('.ai-planning-conversation').getByText(recordText, { exact: true })).toHaveCount(1);
  const before = await checkpoint(page);
  expect(before.ownerId).toBe(owner);
  expect(before.vnext.preview).not.toBeNull();
  expect(before.vnext.actualRecords).toHaveLength(1);
  expect(before.vnext.actualRecords[0]).toMatchObject({ occurrenceDate: date, subject, minutes: 35, status: 'pending' });
  const id = before.vnext.actualRecords[0].id;
  expect(await actualDocument(request, id)).toBeNull();
  await expect(page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL })).toBeVisible();
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  const failedText = 'その実績を40分に訂正してください。';
  const beforeMessages = await bubbles(page).count();
  const beforePosts = posts.length;
  const beforeProvider = await providerCount(request);
  await send(page, failedText);
  const failure = await nextCall(request);
  expect(failure.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, failure, null, 500);
  await expect(bubbles(page)).toHaveCount(beforeMessages + 1);
  await expect(bubbles(page).last()).toHaveText(interpretationFailureReply(
    { reason: 'provider_error', consecutiveCount: 1 }, before.vnext.preview, true,
  ));
  await expect(page.locator('.ai-planning-conversation').getByText(failedText, { exact: true })).toHaveCount(1);
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
  const afterFailure = await checkpoint(page);
  expect(afterFailure.conversationId).toBe(before.conversationId);
  expect(afterFailure.vnext.state.graph).toEqual(before.vnext.state.graph);
  expect(afterFailure.vnext.preview).toEqual(before.vnext.preview);
  expect(afterFailure.vnext.actualRecords).toEqual(before.vnext.actualRecords);
  expect(afterFailure.vnext.presentedQuestion).toEqual(before.vnext.presentedQuestion);
  expect(afterFailure.vnext.failureRecovery).toMatchObject({ reason: 'provider_error', consecutiveCount: 1 });
  expect(posts).toHaveLength(beforePosts + 1);
  expect(await providerCount(request)).toBe(beforeProvider + 1);
  expect(await actualDocument(request, id)).toBeNull();
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  await page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL }).click();
  const retainedDialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(retainedDialog.getByText(formatActualRecordRow({ occurrenceDate: date, subject, minutes: 35 }), { exact: true })).toBeVisible();
  await expect(retainedDialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(35)}`);
  await retainedDialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(retainedDialog).toBeHidden();

  const nextText = `昨日の${subject}の実績は40分でした。`;
  await sentTurn(page, request, nextText, readingFor(40), false);
  await expect(page.locator('.ai-planning-conversation').getByText(nextText, { exact: true })).toHaveCount(1);
  const corrected = await checkpoint(page);
  expect(corrected.conversationId).toBe(before.conversationId);
  expect(corrected.vnext.preview).toEqual(before.vnext.preview);
  expect(corrected.vnext.actualRecords).toEqual([{ ...before.vnext.actualRecords[0], minutes: 40 }]);
  expect(corrected.vnext.failureRecovery).toBeUndefined();
  expect(posts).toHaveLength(beforePosts + 2);
  expect(await providerCount(request)).toBe(beforeProvider + 2);
  expect(await actualDocument(request, id)).toBeNull();
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  await page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL }).click();
  // With an existing plan, the actual-record section is inside the plan preview dialog.
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(formatActualRecordRow({ occurrenceDate: date, subject, minutes: 40 }), { exact: true })).toBeVisible();
  await expect(dialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(40)}`);
  await expect(dialog.locator('.ai-planning-actual-records-list li')).toHaveCount(1);
  expect(await actualDocument(request, id)).toBeNull();
  await writes.during('save-actuals', async () => {
    await dialog.locator('button.ai-planning-actual-records-save').click();
    await expect(dialog.locator('.ai-planning-actual-records-save')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect.poll(() => writes.commitsIn('save-actuals').length).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await actualDocument(request, id)) !== null).toBe(true);
  });
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 1)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  const saved = await actualDocument(request, id);
  expect(saved.name.endsWith(`/actuals/${id}`)).toBe(true);
  expect(saved.fields.userId.stringValue).toBe(owner);
  expect(saved.fields.occurrenceDate.stringValue).toBe(date);
  expect(saved.fields.subject.stringValue).toBe(subject);
  expect(Number(saved.fields.actualDurationMinutes.integerValue)).toBe(40);
  expect(saved.fields.actualStartTime).toBeUndefined();
  expect(saved.fields.actualEndTime).toBeUndefined();
});
