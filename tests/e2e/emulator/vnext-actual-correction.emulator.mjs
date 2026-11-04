import { expect, test } from '@playwright/test';
import { answer, nextCall, VNEXT_READING_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { scriptedActualReading, WEEK_RECORDS, WEEK_TOTAL_AFTER_TUESDAY_FIX, WEEK_TOTAL_MINUTES } from '../support/vnext-actual-readings.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, formatActualRecordRow, formatActualRecordsTotal } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';

// A single durable conversation: 395 minutes are pending, Tuesday is corrected to 50 before the only save,
// and reload plus an identical correction must leave exactly the six 400-minute server documents.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;
const isoDay = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const fieldText = field => field?.stringValue ?? null;
const composer = page => page.locator('.ai-planning-composer textarea');
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(nav.or(signInTab).first()).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
    await page.getByLabel('メールアドレス').fill(email());
    await page.getByLabel('パスワード', { exact: true }).fill(password());
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(nav).toBeVisible();
}

async function previousWeekOf(page) {
  const nowMs = await page.evaluate(() => Date.now());
  const jst = new Date(nowMs + 9 * 3600_000);
  const today = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const monday = addDays(today, -((today.getUTCDay() + 6) % 7) - 7);
  return Array.from({ length: 7 }, (_, index) => isoDay(addDays(monday, index)));
}

async function openPlannerOnPreviousWeek(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const previous = page.getByRole('button', { name: '前の期間へ' });
  for (let step = 0; step < 7; step++) await previous.click();
  await openAiPlanning(page);
}

async function actualTurn(page, request, week, utterance, kind) {
  const run = (async () => {
    const reading = await nextCall(request);
    expect(reading.schema).toBe(VNEXT_READING_SCHEMA);
    await answer(request, reading, scriptedActualReading(kind, { week }));
  })();
  run.catch(() => undefined);
  const before = await bubbles(page).count();
  await composer(page).fill(utterance);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => bubbles(page).count(), { timeout: 120_000 }).toBeGreaterThan(before);
  await expect(composer(page)).toBeEnabled({ timeout: 60_000 });
  await run;
}

async function collectionDocuments(request, collection) {
  const response = await request.get(`${FIRESTORE}/${collection}?pageSize=300`, { headers: OWNER });
  expect(response.ok(), collection).toBe(true);
  return (await response.json()).documents ?? [];
}

async function planDocuments(request, ownerId) {
  return Promise.all(['plans', 'schedule_events'].map(async collection => ({
    collection,
    documents: (await collectionDocuments(request, collection))
      .filter(document => document.fields?.userId?.stringValue === ownerId)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })));
}

async function actualDocuments(request, ownerId) {
  return (await collectionDocuments(request, 'actuals'))
    .map(({ name, fields = {} }) => ({
      docId: name.split('/').pop(), userId: fieldText(fields.userId), date: fieldText(fields.occurrenceDate),
      subject: fieldText(fields.subject), minutes: fields.actualDurationMinutes?.integerValue === undefined
        ? null : Number(fields.actualDurationMinutes.integerValue),
      planId: fields.planId?.nullValue === null ? null : fieldText(fields.planId),
      start: fieldText(fields.actualStartTime), end: fieldText(fields.actualEndTime),
      fieldNames: Object.keys(fields).sort(), updatedAt: fieldText(fields.updatedAt),
    }))
    .filter(record => record.userId === ownerId)
    .sort((a, b) => `${a.date}${a.subject}${a.docId}`.localeCompare(`${b.date}${b.subject}${b.docId}`));
}

async function clearSyntheticAccountActuals(request, ownerId) {
  for (const record of await actualDocuments(request, ownerId)) {
    const response = await request.delete(`${FIRESTORE}/actuals/${record.docId}`, { headers: OWNER });
    expect(response.ok()).toBe(true);
  }
}

const rows = (week, tuesdayMinutes) => WEEK_RECORDS.map(({ day, subject, minutes }) => ({
  date: week[day], subject, minutes: day === 1 ? tuesdayMinutes : minutes,
}));

async function confirmation(page, expectedRows, totalMinutes) {
  const card = page.locator('.ai-planning-actual-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL }).click();
  const dialog = page.getByRole('dialog', { name: PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ai-planning-actual-records-list li')).toHaveCount(6);
  for (const row of expectedRows) {
    await expect(dialog.getByText(formatActualRecordRow({
      occurrenceDate: row.date, subject: row.subject, minutes: row.minutes,
    }), { exact: true })).toBeVisible();
  }
  await expect(dialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(totalMinutes)}`);
  return dialog;
}

function expectSavedWeek(documents, week) {
  expect(documents).toHaveLength(6);
  const expected = rows(week, 50).sort((a, b) => a.date.localeCompare(b.date));
  expect(documents.map(({ date, subject, minutes }) => ({ date, subject, minutes }))).toEqual(expected);
  expect(documents.filter(record => record.date === week[3])).toEqual([]);
  expect(new Set(documents.map(record => record.docId)).size).toBe(6);
  expect(documents.reduce((sum, record) => sum + record.minutes, 0)).toBe(WEEK_TOTAL_AFTER_TUESDAY_FIX);
  for (const record of documents) {
    expect(record.planId).toBeNull();
    expect(record.start).toBeNull();
    expect(record.end).toBeNull();
    expect(record.fieldNames).not.toContain('actualStartTime');
    expect(record.fieldNames).not.toContain('actualEndTime');
  }
}

test('correct before approval: 395 pending → Tuesday 50 → 400 saved → reload and resend keep six exact documents', async ({ page, request }) => {
  const ownerId = await emulatorUserId(request, { email: email(), password: password() });
  await clearSyntheticAccountActuals(request, ownerId);
  const writes = attachWriteLedger(page);
  await signIn(page);
  const week = await previousWeekOf(page);
  const plansBefore = await planDocuments(request, ownerId);
  await openPlannerOnPreviousWeek(page);

  await actualTurn(page, request, week,
    '先週の勉強をまとめて記録したいです。月曜は数学を60分、火曜は英語を45分、水曜は現代文を30分、木曜は休みでした。金曜は英語を50分、土曜は数学を120分、日曜は化学を90分やりました。',
    'actual_week');
  const initial = await confirmation(page, rows(week, 45), WEEK_TOTAL_MINUTES);
  expect(await actualDocuments(request, ownerId)).toEqual([]);
  expect(protectedWritesIn(writes.writes()), '395 minutes are only pending').toEqual([]);
  await initial.getByRole('button', { name: '閉じる' }).click();
  await expect(initial).toBeHidden();

  const correction = 'あ、火曜は50分でした。';
  await actualTurn(page, request, week, correction, 'actual_tue_fix');
  const corrected = await confirmation(page, rows(week, 50), WEEK_TOTAL_AFTER_TUESDAY_FIX);
  expect(await actualDocuments(request, ownerId)).toEqual([]);
  expect(protectedWritesIn(writes.writes()), 'the correction is still unapproved').toEqual([]);

  await writes.during('save-actuals', async () => {
    await corrected.locator('button.ai-planning-actual-records-save').click();
    await expect(corrected).toBeHidden({ timeout: 60_000 });
    await expect.poll(() => writes.commitsIn('save-actuals').length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await actualDocuments(request, ownerId)).length, { timeout: 30_000 }).toBe(6);
  });
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 6)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  const saved = await actualDocuments(request, ownerId);
  expectSavedWeek(saved, week);
  expect(await planDocuments(request, ownerId)).toEqual(plansBefore);

  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
  await openPlannerOnPreviousWeek(page);
  const reloaded = await actualDocuments(request, ownerId);
  expectSavedWeek(reloaded, week);
  expect(reloaded, 'same six ids and fields after reload').toEqual(saved);
  await expect(page.locator('.ai-planning-actual-card')).toHaveCount(0);
  expect(await planDocuments(request, ownerId)).toEqual(plansBefore);

  const writesBeforeResend = protectedWritesIn(writes.writes()).length;
  await actualTurn(page, request, week, correction, 'actual_tue_fix');
  await expect(page.locator('.ai-planning-actual-card')).toHaveCount(0);
  expect(protectedWritesIn(writes.writes()).length, 'the same corrected utterance writes nothing').toBe(writesBeforeResend);
  expect(await actualDocuments(request, ownerId)).toEqual(saved);
  expect(await planDocuments(request, ownerId)).toEqual(plansBefore);
  expect(writes.violations()).toEqual([]);
});
