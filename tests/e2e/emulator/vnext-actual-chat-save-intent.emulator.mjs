import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply, VNEXT_READING_SCHEMA, RENDERER_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { WEEK_RECORDS } from '../support/vnext-actual-readings.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { vnextActualRecordId } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords.ts';
import { REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, SAVE_ACTUAL_RECORDS_BUTTON_LABEL, ACTUAL_SAVE_RETRY_SAVED_REPLY, ALREADY_SAVED_ACTUAL_RECORDS_PREFIX, formatActualRecordRow,
  formatActualRecordsTotal, formatActualSaveReadbackReply } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';

// Durable Worker, real Pages and Firestore/Auth emulators; both interpretation and renderer are synthetic.
// Whether the replies guide the user to the button or use the exact PR #974 confirmation wording is
// observed in attachments only, pending the 0071 characterization; it is not an assertion here.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const composer = page => page.locator('.ai-planning-composer textarea');
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble:not(.ai-planning-typing)');

test.afterEach(async ({ request }) => {
  const reset = await request.post(`${SYNTHETIC}/__synthetic/reset`);
  expect(reset.ok(), 'synthetic provider reset').toBe(true);
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
async function previousWeekOf(page) {
  return page.evaluate(() => {
    const jst = new Date(Date.now() + 9 * 3_600_000);
    const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
    const mondayOffset = (jst.getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, day) => new Date(today + (day - mondayOffset - 7) * 86_400_000).toISOString().slice(0, 10));
  });
}
async function openPreviousWeek(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  for (let day = 0; day < 7; day++) await page.getByRole('button', { name: '前の期間へ' }).click();
  await openAiPlanning(page);
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
// A server query without a limit reads every result for this owner, not just the first list page.
async function actualDocuments(request, owner) {
  const response = await request.post(`${FIRESTORE}:runQuery`, { headers: { Authorization: 'Bearer owner' }, data: {
    structuredQuery: { from: [{ collectionId: 'actuals' }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: owner } } } },
  } });
  expect(response.ok(), 'owner actuals query').toBe(true);
  const rows = await response.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.every(row => !row.error), 'the complete actuals query has no embedded error').toBe(true);
  return rows.flatMap(row => row.document ? [row.document] : []).sort((a, b) => a.name.localeCompare(b.name));
}
function reading(studyRecords = []) {
  return { planningIntent: 'unknown', conversationActs: [], answer: null, delta: EMPTY,
    studyRecords, studyRecordQuestion: null, studyRestDays: [] };
}
async function turn(page, request, text, interpreted, { renderer = false } = {}) {
  const count = await bubbles(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  const call = await nextCall(request);
  expect(call.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, call, interpreted);
  if (renderer) {
    const render = await nextCall(request);
    expect(render.schema).toBe(RENDERER_SCHEMA);
    const reply = rendererReply(render);
    // Consecutive identical questions trigger a renderer repair call. This scenario
    // scripts distinct replies because its subject is the actual-save boundary.
    reply.text += text === '保存して' ? '続けてお話しください。' : 'ほかにもお話しください。';
    await answer(request, render, reply);
  }
  await expect(bubbles(page)).toHaveCount(count + 1);
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator('.ai-planning-conversation').getByText(text, { exact: true })).toHaveCount(1);
  return bubbles(page).last().innerText();
}
async function openConfirmation(page) {
  await page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function checkPendingDialog(page, rows) {
  const dialog = await openConfirmation(page);
  for (const row of rows) await expect(dialog.getByText(formatActualRecordRow(row), { exact: true })).toBeVisible();
  await expect(dialog.locator('.ai-planning-actual-records-list li')).toHaveCount(6);
  await expect(dialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(400)}`);
  await expect(dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true })).toBeVisible();
  return dialog;
}

test('chat save requests do not save corrected pending actuals; explicit UI approval saves them once', async ({ page, request }, testInfo) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const posts = [];
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns' && outgoing.method() === 'POST') posts.push(outgoing);
  });
  const before = await actualDocuments(request, owner);
  const week = await previousWeekOf(page);
  await openPreviousWeek(page);
  const suffix = String(Date.now());
  const initialRows = WEEK_RECORDS.map(item => ({ occurrenceDate: week[item.day], subject: `${item.subject}${suffix}`, minutes: item.minutes }));
  const correctedRows = initialRows.map(row => row.occurrenceDate === week[1] ? { ...row, minutes: 50 } : row);
  const ids = correctedRows.map(row => vnextActualRecordId(owner, row.occurrenceDate, row.subject));
  expect(new Set(ids).size).toBe(6);
  expect(before.filter(doc => ids.some(id => doc.name.endsWith(`/actuals/${id}`)))).toEqual([]);
  const initialText = `先週の実績です。月曜は数学${suffix}を60分、火曜は英語${suffix}を45分、水曜は現代文${suffix}を30分、木曜は休み、金曜は英語${suffix}を50分、土曜は数学${suffix}を120分、日曜は化学${suffix}を90分勉強しました。`;
  const initialReading = { ...reading(initialRows.map(({ occurrenceDate, subject, minutes }) => ({ dateExpression: occurrenceDate, subject, minutes }))),
    studyRestDays: [week[3]] };
  const initialReply = await turn(page, request, initialText, initialReading);
  const first = await checkpoint(page);
  expect(first.ownerId).toBe(owner);
  expect(first.vnext.actualRecords).toHaveLength(6);
  expect(first.vnext.actualRecords.every(record => record.status === 'pending')).toBe(true);
  expect(await actualDocuments(request, owner)).toEqual(before);
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  const correctedText = `火曜の英語${suffix}は50分でした。`;
  const correctionReply = await turn(page, request, correctedText, reading([{ dateExpression: week[1], subject: correctedRows[1].subject, minutes: 50 }]));
  const corrected = await checkpoint(page);
  expect(corrected.conversationId).toBe(first.conversationId);
  expect(corrected.vnext.actualRecords).toHaveLength(6);
  expect(corrected.vnext.actualRecords.map(({ id, status, minutes }) => ({ id, status, minutes })))
    .toEqual(correctedRows.map((row, index) => ({ id: ids[index], status: 'pending', minutes: row.minutes })));
  expect(await actualDocuments(request, owner)).toEqual(before);
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  // These phrases come from the product's own saved-state formatter/constants.
  const savedClaims = [ALREADY_SAVED_ACTUAL_RECORDS_PREFIX, ACTUAL_SAVE_RETRY_SAVED_REPLY,
    formatActualSaveReadbackReply([], [], []).split('：')[0],
    formatActualSaveReadbackReply([{ ...correctedRows[0], id: ids[0] }, { ...correctedRows[1], id: ids[1] }], [ids[0]], []).split('：')[0]];
  for (const reply of [initialReply, correctionReply]) {
    for (const claim of savedClaims) expect(reply, 'no saved claim while preparing or correcting the records').not.toContain(claim);
  }
  const observations = [{ user: initialText, assistant: initialReply }, { user: correctedText, assistant: correctionReply }];
  for (const text of ['保存して', 'はい']) {
    // The schema has no actual-save authorization act; unknown with no mutations is the
    // scripted reading. No claim is made here about a real model's semantic output.
    const reply = await turn(page, request, text, reading(), { renderer: true });
    observations.push({ user: text, assistant: reply });
    for (const claim of savedClaims) expect(reply, `no saved claim after ${text}`).not.toContain(claim);
    const current = await checkpoint(page);
    expect(current.conversationId).toBe(corrected.conversationId);
    expect(current.vnext.actualRecords).toEqual(corrected.vnext.actualRecords);
    expect(await actualDocuments(request, owner)).toEqual(before);
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    const dialog = await checkPendingDialog(page, correctedRows);
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  // Record the actual displayed replies without imposing an unconfirmed guidance contract.
  await testInfo.attach('synthetic-save-intent-replies.json', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
  expect(posts).toHaveLength(4);

  const dialog = await checkPendingDialog(page, correctedRows);
  expect(await actualDocuments(request, owner)).toEqual(before);
  await writes.during('save-actuals', async () => {
    await dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => writes.commitsIn('save-actuals').length).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await actualDocuments(request, owner)).length).toBe(before.length + 6);
  });
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 6)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  const afterSave = await actualDocuments(request, owner);
  const saved = afterSave.filter(doc => ids.some(id => doc.name.endsWith(`/actuals/${id}`)));
  expect(saved).toHaveLength(6);
  for (const [index, row] of correctedRows.entries()) {
    const doc = saved.find(item => item.name.endsWith(`/actuals/${ids[index]}`));
    expect(doc).toBeTruthy();
    expect(doc.fields.userId.stringValue).toBe(owner);
    expect(doc.fields.occurrenceDate.stringValue).toBe(row.occurrenceDate);
    expect(doc.fields.subject.stringValue).toBe(row.subject);
    expect(Number(doc.fields.actualDurationMinutes.integerValue)).toBe(row.minutes);
  }
  expect(afterSave.filter(doc => !ids.some(id => doc.name.endsWith(`/actuals/${id}`)))).toEqual(before);
  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  expect(await actualDocuments(request, owner)).toEqual(afterSave);
});
