import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { answer, nextCall, rendererReply, RENDERER_SCHEMA, VNEXT_READING_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { requestContextOf, scriptedReading } from '../support/vnext-scripted-readings.mjs';
import { RECORD_ONLY_KINDS, scriptedActualReading, WEEK_RECORDS, WEEK_TOTAL_AFTER_TUESDAY_FIX, WEEK_TOTAL_MINUTES } from '../support/vnext-actual-readings.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { expectDurableVNext, observeDurableTurns } from '../support/vnext-durable-observation.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
// The wording and arithmetic of the records belong to ONE owner (fix-01 B): expected texts are built from its functions, never from a
// second format kept in this spec.
import { formatActualRecordMinutes, formatActualRecordRow, formatActualRecordsTotal, sumActualRecordMinutes } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';

// #973 I4: the examinee's week of study records by CONVERSATION, on the durable emulator stack (production build with durable
// turns, production Worker, Auth + Firestore emulators, synthetic provider answering from scripted readings; no model call).
// Contract under test (DESIGN-DECISION.md): the chat gathers the records, nothing is saved until the student clicks the
// confirmation UI; the save is ONE batch of `actuals` documents that carry a duration and NO start or end time; Thursday (rest)
// has no document; a correction replaces the same (date, subject); a re-send never doubles a record.
//
// The expected values come from the fixed scenario (ARGON-FIRST.md), not from the application:
//   Mon 数学 60, Tue 英語 45, Wed 現代文 30, Thu rest, Fri 英語 50, Sat 数学 120, Sun 化学 90 = 395 min (6時間35分);
//   after "火曜は50分だった" = 400 min (6時間40分).
// The recorded week is the previous week of the (real) browser clock: on 2026-11-03 it is 2026-10-26 .. 2026-11-01. The durable
// Worker refuses a turn whose browser start time is not near its own, so the clock is never moved (see vnext-production-flows.mjs).
//
// Shapes come from I2 (evidence/I2-provider-shape.md) and I3 (evidence/I3-confirm-ui-shape.md), stated before their integration;
// the first run on the integrated branch is the check. Open points: whether the reply of a rest-day-only turn goes through the renderer
// (assumed: yes, it makes no record), and the reload behaviour of the confirmation (I3: not shown again once saved).
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const RULES_ENDPOINT = 'http://127.0.0.1:8180/emulator/v1/projects/demo-studyplanner:securityRules';
const OWNER = { Authorization: 'Bearer owner' };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const rowText = ({ date, subject, minutes }) => formatActualRecordRow({ occurrenceDate: date, subject, minutes });
// Before the click the chat only organises records for confirmation: it must not say they were recorded or saved (fix-01 A).
const PENDING_PREFIX = '確認用に整理しました（まだ保存していません）：';
const pendingReply = (rows, minutes) => `${PENDING_PREFIX}${rows.map(rowText).join('、')}。ここまでの合計は${formatActualRecordsTotal(minutes)}です。`;

const CONFIRM = {
  open: page => page.locator('.ai-planning-actual-card').getByRole('button', { name: '実績を確認' }),
  dialog: page => page.getByRole('dialog', { name: '実績の確認' }),
  section: dialog => dialog,
  save: dialog => dialog.locator('button.ai-planning-actual-records-save'),
  total: dialog => dialog.locator('[aria-label="実績の合計"]'),
};

const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;
const composer = page => page.locator('.ai-planning-composer textarea');
const assistantBubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');

async function signIn(page) {
  await page.goto('/');
  const primaryNav = page.locator('.primary-bottom-nav');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(primaryNav.or(signInTab).first()).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
    await page.getByLabel('メールアドレス').fill(email());
    await page.getByLabel('パスワード', { exact: true }).fill(password());
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(primaryNav).toBeVisible();
}

const isoDay = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

/** The seven dates (Monday first) of the week before the browser clock's current week (JST, week starts Monday). */
async function previousWeekOf(page) {
  const nowMs = await page.evaluate(() => Date.now());
  const jst = new Date(nowMs + 9 * 3600_000);
  const today = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const monday = addDays(today, -mondayOffset - 7);
  return Array.from({ length: 7 }, (_, index) => isoDay(addDays(monday, index)));
}

/** Selects a day of the previous week in the schedule (the planner follows the selected day's week), then opens the AI planner. */
async function openPlannerOnPreviousWeek(page) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const previous = page.getByRole('button', { name: '前の期間へ' });
  for (let step = 0; step < 7; step++) await previous.click();
  await openAiPlanning(page);
}

/** One turn: answers this turn's provider calls (reading, then renderer) from the request the Worker sent, sends, waits. */
async function sendTurn(page, request, text, reading, { renderer = true } = {}) {
  const run = (async () => {
    const read = await nextCall(request);
    expect(read.schema).toBe(VNEXT_READING_SCHEMA);
    await answer(request, read, reading(requestContextOf(read.body.messages)));
    if (!renderer) return; // the reply is the application's own fixed text
    const render = await nextCall(request);
    expect(render.schema).toBe(RENDERER_SCHEMA);
    await answer(request, render, rendererReply(render));
  })();
  run.catch(() => undefined);
  const baseline = await assistantBubbles(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => assistantBubbles(page).count(), { timeout: 120_000 }).toBeGreaterThan(baseline);
  await expect(composer(page)).toBeEnabled({ timeout: 60_000 });
  await run;
}
const actualTurn = (page, request, week, text, kind) => sendTurn(page, request, text, () => scriptedActualReading(kind, { week }), { renderer: !RECORD_ONLY_KINDS.includes(kind) });
const lastReply = page => assistantBubbles(page).last();

const text = field => field?.stringValue ?? null;
const integer = field => (field?.integerValue === undefined ? null : Number(field.integerValue));

/** The account's `actuals` documents with the fields the contract is about (a missing field stays null: never defaulted). */
// The records the conversation saved. The neighbouring-week and other-account seeds (SEED_PREFIX) are checked separately.
const SEED_PREFIX = 'i4-';
async function actualDocuments(request, userId, { includeSeeds = false } = {}) {
  const response = await request.get(`${FIRESTORE}/actuals?pageSize=300`, { headers: OWNER });
  expect(response.ok(), 'actuals').toBe(true);
  return ((await response.json()).documents ?? [])
    .map(({ name, fields = {} }) => ({
      docId: name.split('/').pop(), userId: text(fields.userId), planId: fields.planId?.nullValue === null ? null : text(fields.planId),
      date: text(fields.occurrenceDate), subject: text(fields.subject), minutes: integer(fields.actualDurationMinutes),
      start: text(fields.actualStartTime), end: text(fields.actualEndTime), fieldNames: Object.keys(fields).sort(),
      updatedAt: text(fields.updatedAt),
    }))
    .filter(record => record.userId === userId && (includeSeeds || !record.docId.startsWith(SEED_PREFIX)))
    .sort((a, b) => `${a.date}${a.subject}${a.docId}`.localeCompare(`${b.date}${b.subject}${b.docId}`));
}

async function deleteActualsOf(request, userId) {
  for (const record of await actualDocuments(request, userId, { includeSeeds: true })) {
    const response = await request.delete(`${FIRESTORE}/actuals/${record.docId}`, { headers: OWNER });
    expect(response.ok(), 'test cleanup of the synthetic account').toBe(true);
  }
}

const durationFields = ({ id, userId, date, subject, minutes }) => ({
  id: { stringValue: id }, userId: { stringValue: userId }, planId: { nullValue: null }, occurrenceDate: { stringValue: date },
  subject: { stringValue: subject }, title: { stringValue: `${subject}の勉強` }, note: { stringValue: '' },
  actualDurationMinutes: { integerValue: String(minutes) }, updatedAt: { stringValue: '2026-11-03T00:00:00.000Z' },
});

async function putActual(request, docId, fields) {
  const response = await request.patch(`${FIRESTORE}/actuals/${docId}`, { headers: OWNER, data: { fields } });
  expect(response.ok(), docId).toBe(true);
}

const snapshotOf = async (request, docId) => (await request.get(`${FIRESTORE}/actuals/${docId}`, { headers: OWNER })).json();

const total = records => records.reduce((sum, record) => sum + (record.minutes ?? 0), 0);

test.describe('examinee week of study records by conversation (durable emulator stack)', () => {
  test.setTimeout(420_000);
  let userId;
  let neighbours; // records of other weeks and of another account, written before each test and compared after it

  test.beforeEach(async ({ request }) => {
    userId = await emulatorUserId(request, { email: email(), password: password() });
    await deleteActualsOf(request, userId);
  });

  async function seedNeighbours(request, week) {
    const otherWeek = isoDay(addDays(new Date(`${week[0]}T00:00:00Z`), -4));
    const nextWeek = isoDay(addDays(new Date(`${week[6]}T00:00:00Z`), 2));
    const seeds = [
      { docId: 'i4-own-other-week-1', id: 'i4-own-other-week-1', userId, date: otherWeek, subject: '英語', minutes: 30 },
      { docId: 'i4-own-next-week-1', id: 'i4-own-next-week-1', userId, date: nextWeek, subject: '数学', minutes: 45 },
      { docId: 'i4-other-user-1', id: 'i4-other-user-1', userId: 'i4-someone-else', date: week[1], subject: '物理', minutes: 20 },
    ];
    for (const seed of seeds) await putActual(request, seed.docId, durationFields(seed));
    neighbours = { docIds: seeds.map(seed => seed.docId), snapshots: await Promise.all(seeds.map(seed => snapshotOf(request, seed.docId))), otherWeekDates: [otherWeek, nextWeek] };
  }

  async function expectNeighboursUnchanged(request) {
    const after = await Promise.all(neighbours.docIds.map(docId => snapshotOf(request, docId)));
    expect(after, 'other weeks and another account are untouched').toEqual(neighbours.snapshots);
  }

  /** Opens the confirmation UI and returns its dialog. */
  async function openConfirmation(page) {
    await expect(CONFIRM.open(page)).toBeVisible({ timeout: 30_000 });
    await CONFIRM.open(page).click();
    const dialog = CONFIRM.dialog(page);
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async function expectConfirmationRows(dialog, rows, minutes) {
    const section = CONFIRM.section(dialog);
    await expect(section).toBeVisible();
    for (const row of rows) await expect(section.getByText(rowText(row), { exact: true })).toBeVisible();
    await expect(CONFIRM.total(dialog)).toHaveText(`合計 ${formatActualRecordsTotal(minutes)}`);
    await expect(dialog, 'no clock time is shown for a record that has none').not.toContainText(/\b\d{1,2}:\d{2}\b/u);
    await expect(section.locator('.ai-planning-actual-records-list li'), 'one line per recorded day, none for the rest day').toHaveCount(rows.length);
  }

  /** The week's rows in scenario order with their weekday index (Thursday has none). */
  const scenarioRows = (week, overrides = {}) => WEEK_RECORDS.map(entry => ({
    index: entry.day, date: week[entry.day], subject: entry.subject, minutes: overrides[entry.day] ?? entry.minutes,
  }));

  /** The chat's reply before the click, built from the owner's functions; it never claims the records are saved. */
  async function expectPendingReply(page, rows, minutes) {
    const reply = await lastReply(page).innerText();
    expect(reply, 'the reply is the owner-built pending wording').toContain(pendingReply(rows, minutes));
    for (const claim of ['記録しました', '保存しました', '保存済み']) expect(reply, `not claimed: ${claim}`).not.toContain(claim);
  }

  /** Before the confirmation click: no write to a protected collection has happened (ledger phase none). */
  const expectNothingWrittenYet = firestore => expect(firestore.writes().filter(write => write.classification === 'forbidden'), 'no protected write before the click').toEqual([]);

  /** The clicked save: authorized as its own phase; one commit of `count` actuals updates, seen by the observer. */
  async function clickSave(firestore, dialog, count) {
    await firestore.during('save-actuals', async () => {
      await CONFIRM.save(dialog).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
    });
    expect(protectedWritesIn(firestore.inPhase('save-actuals')), 'the save is seen by the observer (a blind observer proves nothing)').not.toEqual([]);
    expect(actualsCommitProblems(firestore.commitsIn('save-actuals'), count)).toEqual([]);
    expect(firestore.violations()).toEqual([]);
  }

  /** What the saved documents must be: a duration, never a start or end time, standalone, one per studied day. */
  function expectSavedWeek(documents, week, expected) {
    const saved = documents.filter(record => week.includes(record.date));
    expect(saved.map(({ date, subject, minutes }) => ({ date, subject, minutes })), 'one document per studied day with the stated minutes').toEqual(
      expected.map(({ index, subject, minutes }) => ({ date: week[index], subject, minutes })).sort((a, b) => a.date.localeCompare(b.date)));
    for (const record of saved) {
      expect(record.start, `${record.date}: no start time the student never gave`).toBeNull();
      expect(record.end, `${record.date}: no end time the student never gave`).toBeNull();
      expect(record.fieldNames.filter(name => /start|end/iu.test(name)), `${record.date}: no time-like field`).toEqual([]);
      expect(record.planId).toBeNull();
    }
    expect(saved.filter(record => record.date === week[3]), 'Thursday (rest) has no document').toEqual([]);
    expect(new Set(saved.map(record => record.docId)).size, 'document ids are distinct').toBe(saved.length);
    return saved;
  }

  /** Day view of each day of the week (DurationActualList: a "時刻なしの記録" list of rows, never on the time-of-day timeline). */
  async function expectWeekShown(page, week, expected, minutes) {
    await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
    // The period is moved to explicitly by date (never by counting steps back) and asserted before any row is judged:
    // the week view of the selected day lists exactly the seven dates of the recorded week.
    await page.getByRole('tab', { name: '日', exact: true }).click();
    const dayButton = (index, date) => page.getByRole('button', { name: `${Number(date.slice(0, 4))}年 ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${WEEKDAYS[index]}`, exact: true });
    await dayButton(0, week[0]).click();
    await page.getByRole('tab', { name: '週', exact: true }).click();
    await expect(page.locator('.schedule-week-day-column'), 'the week view renders its seven days').toHaveCount(7);
    const columnLabels = await page.locator('.schedule-week-day-column').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    expect(columnLabels.map(label => label.split('（')[0]), 'the shown week is the recorded week').toEqual(
      week.map(date => `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`));
    await page.getByRole('tab', { name: '日', exact: true }).click();
    let shown = 0;
    for (const [index, date] of week.entries()) {
      const label = `${Number(date.slice(0, 4))}年 ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${WEEKDAYS[index]}`;
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'date');
      const entry = expected.find(item => item.index === index);
      const list = page.locator('.duration-actual-list');
      if (!entry) {
        await expect(list, `${date} (rest day) shows no record`).toHaveCount(0);
        continue;
      }
      const rows = list.locator('.duration-actual-row');
      await expect(rows, `${date} day view: one record`).toHaveCount(1);
      await expect(rows.first()).toContainText('時刻なし');
      await expect(rows.first()).toContainText(formatActualRecordMinutes(entry.minutes));
      await expect(rows.first()).toContainText(entry.subject);
      await expect(list.locator('.duration-actual-list-head')).toContainText(`合計 ${formatActualRecordsTotal(entry.minutes)}`);
      await expect(page.locator('.timeline-actual-block'), `${date}: a time-less record is not drawn on the timeline`).toHaveCount(0);
      shown += entry.minutes;
    }
    expect(shown, 'the days shown add up to the week').toBe(minutes);
  }

  const readChatCount = page => page.evaluate(() => {
    const index = Object.keys(localStorage).find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.') && !key.endsWith('.anonymous'));
    try { return JSON.parse(localStorage.getItem(index)).chats.length; } catch { return null; }
  });

  /** The persisted `status id` of the conversation's records, from the chat checkpoint in this browser (no text, only status and id). */
  const recordStates = page => page.evaluate(() => {
    const find = value => {
      if (Array.isArray(value)) return null;
      if (value && typeof value === 'object') {
        if (Array.isArray(value.actualRecords)) return value.actualRecords;
        for (const item of Object.values(value)) { const found = find(item); if (found) return found; }
      }
      return null;
    };
    return Object.keys(localStorage).filter(key => key.includes('.weeklyPlanning.vnext.') && key.endsWith('.core') && !key.includes('.anonymous'))
      .flatMap(key => { try { return (find(JSON.parse(localStorage.getItem(key))) ?? []).map(record => `${record.status} ${record.id}`); } catch { return []; } });
  });

  test('S1: one long utterance → confirmation (6 rows, 6時間35分) → nothing saved before the click → one batch of 6 duration records → views and reload agree', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    const durable = observeDurableTurns(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await seedNeighbours(request, week);
    await openPlannerOnPreviousWeek(page);

    await actualTurn(page, request, week,
      '先週の勉強をまとめて記録したいです。月曜は数学を60分、火曜は英語を45分、水曜は現代文を30分、木曜は休みでした。金曜は英語を50分、土曜は数学を120分、日曜は化学を90分やりました。', 'actual_week');
    await expectDurableVNext(durable, { turns: 1 });
    await expectPendingReply(page, scenarioRows(week), WEEK_TOTAL_MINUTES);
    expect(sumActualRecordMinutes(scenarioRows(week)), 'the scenario itself sums to 395').toBe(WEEK_TOTAL_MINUTES);
    expect(await actualDocuments(request, userId), 'nothing is saved by the conversation itself').toEqual([]);
    expectNothingWrittenYet(firestore);

    const dialog = await openConfirmation(page);
    await expectConfirmationRows(dialog, scenarioRows(week), WEEK_TOTAL_MINUTES);
    expect(await actualDocuments(request, userId), 'opening the confirmation does not save').toEqual([]);
    expectNothingWrittenYet(firestore);
    await clickSave(firestore, dialog, 6);

    const saved = expectSavedWeek(await actualDocuments(request, userId), week, scenarioRows(week));
    expect(total(saved)).toBe(WEEK_TOTAL_MINUTES);
    await expectWeekShown(page, week, scenarioRows(week), WEEK_TOTAL_MINUTES);

    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
    const reloaded = await actualDocuments(request, userId);
    expect(reloaded.map(({ docId, date, subject, minutes, updatedAt }) => ({ docId, date, subject, minutes, updatedAt })))
      .toEqual(saved.map(({ docId, date, subject, minutes, updatedAt }) => ({ docId, date, subject, minutes, updatedAt })));
    await expectWeekShown(page, week, scenarioRows(week), WEEK_TOTAL_MINUTES);
    await expectNeighboursUnchanged(request);
    expect(firestore.violations()).toEqual([]);
  });

  test('S2: short turns, Thursday rest, then "火曜は50分だった" → Tuesday stays one record of 50 minutes, total 6時間40分 (400)', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    const durable = observeDurableTurns(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await seedNeighbours(request, week);
    await openPlannerOnPreviousWeek(page);

    await actualTurn(page, request, week, '先週の勉強を記録したいです。月曜は数学を60分やりました。', 'actual_mon');
    await actualTurn(page, request, week, '火曜は英語を45分、水曜は現代文を30分です。', 'actual_tue_wed');
    await actualTurn(page, request, week, '木曜は休みでした。', 'actual_thu_rest');
    await actualTurn(page, request, week, '金曜は英語を50分、土曜は数学を120分、日曜は化学を90分です。', 'actual_fri_sun');
    await expectDurableVNext(durable, { turns: 4 });
    expect(await actualDocuments(request, userId)).toEqual([]);

    // Before the correction the confirmation shows 395; the correction replaces Tuesday (it is not added to 45).
    await actualTurn(page, request, week, 'あ、火曜は50分でした。', 'actual_tue_fix');
    await expectDurableVNext(durable, { turns: 5 });
    await expectPendingReply(page, [{ date: week[1], subject: '英語', minutes: 50 }], WEEK_TOTAL_AFTER_TUESDAY_FIX);
    expect(await lastReply(page).innerText(), 'the corrected Tuesday replaces 45, the sum is recomputed').toContain(formatActualRecordsTotal(WEEK_TOTAL_AFTER_TUESDAY_FIX));
    expect(await actualDocuments(request, userId), 'a correction saves nothing').toEqual([]);
    expectNothingWrittenYet(firestore);

    const dialog = await openConfirmation(page);
    await expectConfirmationRows(dialog, scenarioRows(week, { 1: 50 }), WEEK_TOTAL_AFTER_TUESDAY_FIX);
    await clickSave(firestore, dialog, 6);

    const saved = expectSavedWeek(await actualDocuments(request, userId), week, scenarioRows(week, { 1: 50 }));
    expect(saved.filter(record => record.date === week[1]), 'Tuesday is one record, not 45 + 50').toHaveLength(1);
    expect(total(saved)).toBe(WEEK_TOTAL_AFTER_TUESDAY_FIX);
    await expectWeekShown(page, week, scenarioRows(week, { 1: 50 }), WEEK_TOTAL_AFTER_TUESDAY_FIX);
    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
    expect(total(await actualDocuments(request, userId))).toBe(WEEK_TOTAL_AFTER_TUESDAY_FIX);
    await expectNeighboursUnchanged(request);
  });

  test('N1: "木曜は休みでした" alone records nothing: no confirmation, no write, no document', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await seedNeighbours(request, week);
    await openPlannerOnPreviousWeek(page);
    await actualTurn(page, request, week, '木曜は休みでした。勉強していません。', 'actual_thu_rest');
    await expect(page.locator('.ai-planning-actual-card'), 'a rest day alone offers nothing to confirm').toHaveCount(0);
    expect(await actualDocuments(request, userId)).toEqual([]);
    expect(firestore.violations()).toEqual([]);
    await expectNeighboursUnchanged(request);
  });

  test('N2: a plan sentence ("数学の計画を60分入れてください") is a plan, not a record: no actuals write, no 実績 card', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await seedNeighbours(request, week);
    await openAiPlanning(page);
    // A day inside the planner's own week (as the plan flows do), so the application can answer with a plan preview.
    const target = await goToTargetPlannerWeek(page);
    await sendTurn(page, request, `${target.text}に数学の計画を60分入れてください。`,
      () => scriptedReading('plan', { title: '数学', date: target.iso }, null));
    expect(await actualDocuments(request, userId), 'a plan sentence creates no record').toEqual([]);
    expectNothingWrittenYet(firestore);
    await expect(page.locator('.ai-planning-actual-card'), 'a plan turn offers no 実績 card').toHaveCount(0);
    await expectNeighboursUnchanged(request);
  });

  test('N4: vague statements ("数学ちょっと", "土日で化学3時間") record nothing and get exactly one question', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await seedNeighbours(request, week);
    await openPlannerOnPreviousWeek(page);
    await actualTurn(page, request, week, '先週、数学ちょっとやりました。', 'actual_vague_math');
    await expect(lastReply(page)).toContainText('数学は何分くらい勉強しましたか？');
    expect((await lastReply(page).innerText()).match(/？/gu), 'one question, not several').toHaveLength(1);
    await expect(page.locator('.ai-planning-actual-card'), 'nothing was understood, so nothing to confirm').toHaveCount(0);
    await actualTurn(page, request, week, '土日で化学を3時間やりました。', 'actual_vague_weekend');
    await expect(lastReply(page)).toContainText('土日の化学は、日ごとに何分ずつでしたか？');
    expect((await lastReply(page).innerText()).match(/？/gu), 'one question, not several').toHaveLength(1);
    await expect(page.locator('.ai-planning-actual-card'), 'no equal split is assumed: nothing to confirm').toHaveCount(0);
    expect(await actualDocuments(request, userId)).toEqual([]);
    expect(firestore.writes().filter(write => write.classification === 'forbidden')).toEqual([]);
    await expectNeighboursUnchanged(request);
  });

  test('N3: a second click, a reload and the same statement again leave the saved records exactly as they were', async ({ page, request }, testInfo) => {
    const firestore = attachWriteLedger(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await openPlannerOnPreviousWeek(page);
    await actualTurn(page, request, week, '月曜は数学60分、火曜は英語45分、水曜は現代文30分、金曜は英語50分、土曜は数学120分、日曜は化学90分でした。', 'actual_week');
    expectNothingWrittenYet(firestore);
    await expectPendingReply(page, scenarioRows(week), WEEK_TOTAL_MINUTES);
    const dialog = await openConfirmation(page);
    expectNothingWrittenYet(firestore);
    // Two clicks in the same tick: the deterministic ids and the in-flight lock must give one save.
    await firestore.during('save-actuals', async () => {
      await CONFIRM.save(dialog).evaluate(element => { element.click(); element.click(); });
      await expect(dialog).toBeHidden({ timeout: 60_000 });
    });
    expect(actualsCommitProblems(firestore.commitsIn('save-actuals'), 6), 'two clicks make one commit of 6').toEqual([]);
    const first = await actualDocuments(request, userId);
    expectSavedWeek(first, week, scenarioRows(week));
    const afterSave = await recordStates(page);
    expect(afterSave.map(state => state.split(' ')[0]), 'the save marks every record saved in the conversation').toEqual(Array(6).fill('saved'));

    // After a reload the conversation is restored and the saved records are not offered again (I3: status 'saved' persists in the
    // session). Re-sending the same statement changes nothing either: the application answers that it is already recorded.
    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
    await openAiPlanning(page);
    await expect(page.locator('.ai-planning-actual-card'), 'saved records are not offered for confirmation again').toHaveCount(0);
    expect(await recordStates(page), 'the saved mark and the record ids survive the reload').toEqual(afterSave);
    await actualTurn(page, request, week, '月曜は数学60分、火曜は英語45分、水曜は現代文30分、金曜は英語50分、土曜は数学120分、日曜は化学90分でした。', 'actual_week');
    await testInfo.attach('record-states-after-resend.txt', { body: (await recordStates(page)).join('\n') + `\nchat count: ${(await readChatCount(page))}`, contentType: 'text/plain' });
    await expect(lastReply(page)).toContainText('その内容はすでに確認リストにあります。');
    await expect(page.locator('.ai-planning-actual-card'), 'a repeated statement creates nothing new to confirm').toHaveCount(0);
    const second = await actualDocuments(request, userId);
    expect(second.map(({ docId, date, subject, minutes }) => ({ docId, date, subject, minutes })), 'same documents, same ids, same count')
      .toEqual(first.map(({ docId, date, subject, minutes }) => ({ docId, date, subject, minutes })));
    expect(firestore.violations()).toEqual([]);
  });

  test('N3b: after a reload the same statement confirmed again must not add documents (the Firestore side of N3)', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await openPlannerOnPreviousWeek(page);
    const statement = '月曜は数学60分、火曜は英語45分、水曜は現代文30分、金曜は英語50分、土曜は数学120分、日曜は化学90分でした。';
    await actualTurn(page, request, week, statement, 'actual_week');
    await clickSave(firestore, await openConfirmation(page), 6);
    const first = await actualDocuments(request, userId);
    expectSavedWeek(first, week, scenarioRows(week));

    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
    await openAiPlanning(page);
    await actualTurn(page, request, week, statement, 'actual_week');
    // Whatever the application offers now, confirming it must leave exactly the documents saved before.
    if (await page.locator('.ai-planning-actual-card').count()) {
      const again = await openConfirmation(page);
      await firestore.during('save-actuals', async () => { await CONFIRM.save(again).click(); await expect(again).toBeHidden({ timeout: 60_000 }); });
    }
    const second = await actualDocuments(request, userId);
    expect(second.map(({ docId }) => docId).sort(), 'same documents (same ids), none added').toEqual(first.map(({ docId }) => docId).sort());
    expect(total(second)).toBe(WEEK_TOTAL_MINUTES);
  });

  test('save failure: the emulator rejects the batch → nothing is saved, the student retries once it is accepted, and there are no duplicates', async ({ page, request }) => {
    const firestore = attachWriteLedger(page);
    await signIn(page);
    const week = await previousWeekOf(page);
    await openPlannerOnPreviousWeek(page);
    await actualTurn(page, request, week, '月曜は数学60分、火曜は英語45分、水曜は現代文30分、金曜は英語50分、土曜は数学120分、日曜は化学90分でした。', 'actual_week');
    const dialog = await openConfirmation(page);

    const repoRules = readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');
    const putRules = async content => {
      const response = await request.put(RULES_ENDPOINT, { data: { rules: { files: [{ name: 'firestore.rules', content }] } } });
      expect(response.ok(), 'security rules endpoint of the Firestore emulator').toBe(true);
    };
    const denyActualWrites = 'rules_version = \'2\'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read: if true; allow write: if false; } } }';
    await putRules(denyActualWrites);
    try {
      await firestore.during('save-actuals', async () => { await CONFIRM.save(dialog).click(); });
      await expect(dialog.getByRole('alert'), 'the failure is shown, not swallowed').toBeVisible({ timeout: 30_000 });
      await expect(CONFIRM.save(dialog), 'the same button offers the retry').toHaveText('実績の保存を再試行');
      expect(await actualDocuments(request, userId), 'all or nothing: a rejected batch saves no record').toEqual([]);
      await expect(dialog, 'the confirmation stays open for a retry').toBeVisible();
    } finally {
      await putRules(repoRules);
    }
    await firestore.during('save-actuals', async () => {
      await expect(CONFIRM.save(dialog), 'the save can be retried').toBeEnabled();
      await CONFIRM.save(dialog).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
    });
    const saved = expectSavedWeek(await actualDocuments(request, userId), week, scenarioRows(week));
    expect(total(saved)).toBe(WEEK_TOTAL_MINUTES);
    expect(await actualDocuments(request, userId)).toHaveLength(6);
  });
});
