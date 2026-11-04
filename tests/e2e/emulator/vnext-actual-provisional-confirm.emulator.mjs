import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply, VNEXT_READING_SCHEMA, RENDERER_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { WEEK_RECORDS } from '../support/vnext-actual-readings.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { vnextActualRecordId } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords.ts';
import { PROVISIONAL_ACTUAL_RECORDS_LABEL, PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, ACTUAL_RECORDS_REFLECTION_QUESTION, SAVE_ACTUAL_RECORDS_BUTTON_LABEL, formatActualRecordMinutes, formatActualRecordRow, formatActualRecordsTotal } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';

// PR #974 comment 6634537603 requires 仮実績 and this confirmation question in both
// conversation and confirmation UI. This is a real Pages /
// durable Worker / Auth + Firestore emulator test; model readings and renderer are synthetic.
const PROVISIONAL = PROVISIONAL_ACTUAL_RECORDS_LABEL;
const CONFIRM_QUESTION = ACTUAL_RECORDS_REFLECTION_QUESTION;
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const composer = page => page.locator('.ai-planning-composer textarea');
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble:not(.ai-planning-typing)');

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

async function previousWeek(page) {
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
}

// runQuery streams the complete result; no first-page limit, and no other owner's data.
async function actualDocuments(request, owner) {
  const response = await request.post(`${FIRESTORE}:runQuery`, { headers: { Authorization: 'Bearer owner' }, data: {
    structuredQuery: { from: [{ collectionId: 'actuals' }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: owner } } } },
  } });
  expect(response.ok(), 'owner actuals query').toBe(true);
  const rows = await response.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.every(row => !row.error), 'complete actuals query').toBe(true);
  return rows.flatMap(row => row.document ? [row.document] : []).sort((a, b) => a.name.localeCompare(b.name));
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

const reading = (studyRecords = [], studyRestDays = []) => ({
  planningIntent: 'unknown', conversationActs: [], answer: null, delta: EMPTY,
  studyRecords, studyRecordQuestion: null, studyRestDays,
});

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
    await answer(request, render, rendererReply(render));
  }
  await expect(bubbles(page)).toHaveCount(count + 1);
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator('.ai-planning-conversation').getByText(text, { exact: true })).toHaveCount(1);
  return bubbles(page).last().innerText();
}

async function openConfirmation(page) {
  await page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectRows(dialog, records, total) {
  const rows = dialog.locator('.ai-planning-actual-records-list li');
  await expect(rows).toHaveCount(records.length);
  for (const record of records) await expect(dialog.getByText(formatActualRecordRow(record), { exact: true })).toBeVisible();
  await expect(dialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(total)}`);
  await expect(dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true })).toBeVisible();
}

test('provisional actuals are explained, corrected and approved before they are saved', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const before = await actualDocuments(request, owner);
  const week = await previousWeek(page);
  await openPreviousWeek(page);
  await openAiPlanning(page);

  const suffix = String(Date.now());
  const initial = WEEK_RECORDS.map(item => ({ occurrenceDate: week[item.day], subject: `${item.subject}${suffix}`, minutes: item.minutes }));
  const corrected = initial.map(record => record.occurrenceDate === week[1] ? { ...record, minutes: 50 } : record);
  const ids = corrected.map(record => vnextActualRecordId(owner, record.occurrenceDate, record.subject));
  expect(new Set(ids).size).toBe(6);
  expect(before.filter(doc => ids.some(id => doc.name.endsWith(`/actuals/${id}`)))).toEqual([]);
  const rows = initial.map(({ occurrenceDate, subject, minutes }) => ({ dateExpression: occurrenceDate, subject, minutes }));
  const text = `先週の実績です。月曜は数学${suffix}を60分、火曜は英語${suffix}を45分、水曜は現代文${suffix}を30分、木曜は休み、金曜は英語${suffix}を50分、土曜は数学${suffix}を120分、日曜は化学${suffix}を90分勉強しました。`;
  const initialReply = await turn(page, request, text, reading(rows, [week[3]]));
  const first = await checkpoint(page);
  expect(first.ownerId).toBe(owner);
  expect(first.vnext.actualRecords).toHaveLength(6);
  expect(first.vnext.actualRecords.every(record => record.status === 'pending')).toBe(true);
  expect(await actualDocuments(request, owner)).toEqual(before);
  expect(protectedWritesIn(writes.writes())).toEqual([]);
  // Soft assertions report each missing UX requirement without preventing the later safety and persistence checks.
  expect.soft(initialReply, 'conversation identifies the proposed records').toContain(PROVISIONAL);
  expect.soft(initialReply, 'conversation asks for confirmation').toContain(CONFIRM_QUESTION);

  let dialog = await openConfirmation(page);
  await expectRows(dialog, initial, 395);
  const initialDialog = await dialog.innerText();
  expect.soft(initialDialog, 'confirmation identifies the proposed records').toContain(PROVISIONAL);
  expect.soft(initialDialog, 'confirmation asks for approval').toContain(CONFIRM_QUESTION);
  expect(await actualDocuments(request, owner)).toEqual(before);
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog).toBeHidden();

  const correctionReply = await turn(page, request, `火曜の英語${suffix}は50分でした。`,
    reading([{ dateExpression: week[1], subject: corrected[1].subject, minutes: 50 }]));
  const afterCorrection = await checkpoint(page);
  expect(afterCorrection.conversationId).toBe(first.conversationId);
  expect(afterCorrection.vnext.actualRecords.map(({ id, status, minutes }) => ({ id, status, minutes })))
    .toEqual(corrected.map((record, index) => ({ id: ids[index], status: 'pending', minutes: record.minutes })));
  expect(await actualDocuments(request, owner)).toEqual(before);
  expect(protectedWritesIn(writes.writes())).toEqual([]);
  expect.soft(correctionReply, 'correction names the previous value').toContain(formatActualRecordMinutes(45));
  expect.soft(correctionReply, 'correction names the new value').toContain(formatActualRecordMinutes(50));

  // The schema has no chat-based actual-save authorization. The synthetic reading
  // of はい is unknown with no mutations; this does not claim real-model accuracy.
  await turn(page, request, 'はい', reading(), { renderer: true });
  expect((await checkpoint(page)).vnext.actualRecords).toEqual(afterCorrection.vnext.actualRecords);
  expect(await actualDocuments(request, owner)).toEqual(before);
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  dialog = await openConfirmation(page);
  await expectRows(dialog, corrected, 400);
  await writes.during('save-actuals', async () => {
    await dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => writes.commitsIn('save-actuals').length).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await actualDocuments(request, owner)).length).toBe(before.length + 6);
  });
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 6)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  const saved = await actualDocuments(request, owner);
  const savedRows = saved.filter(doc => ids.some(id => doc.name.endsWith(`/actuals/${id}`)));
  expect(savedRows).toHaveLength(6);
  for (const [index, record] of corrected.entries()) {
    const doc = savedRows.find(item => item.name.endsWith(`/actuals/${ids[index]}`));
    expect(doc).toBeTruthy();
    expect(doc.fields.userId.stringValue).toBe(owner);
    expect(doc.fields.occurrenceDate.stringValue).toBe(record.occurrenceDate);
    expect(doc.fields.subject.stringValue).toBe(record.subject);
    expect(Number(doc.fields.actualDurationMinutes.integerValue)).toBe(record.minutes);
  }
  expect(saved.filter(doc => !ids.some(id => doc.name.endsWith(`/actuals/${id}`)))).toEqual(before);

  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  expect(await actualDocuments(request, owner)).toEqual(saved);
  await openAiPlanning(page);
  const restored = await checkpoint(page);
  expect(restored.conversationId).toBe(first.conversationId);
  expect(restored.vnext.actualRecords.map(({ id, status, minutes }) => ({ id, status, minutes })))
    .toEqual(corrected.map((record, index) => ({ id: ids[index], status: 'saved', minutes: record.minutes })));
  await expect(page.locator('.ai-planning-actual-card')).toHaveCount(0);

  // A persisted actual appears in the existing day view after reload, not only in the checkpoint.
  await openPreviousWeek(page);
  const date = week[1];
  const dayLabel = `${Number(date.slice(0, 4))}年 ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 火`;
  await page.getByRole('button', { name: dayLabel, exact: true }).click();
  const savedRow = page.locator('.duration-actual-row').filter({ hasText: corrected[1].subject });
  await expect(savedRow).toHaveCount(1);
  await expect(savedRow).toContainText(formatActualRecordMinutes(50));
  await expect(savedRow).toContainText('時刻なし');
});
