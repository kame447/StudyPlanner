import { expect, test } from '@playwright/test';
import { answer, nextCall, rendererReply, RENDERER_SCHEMA, VNEXT_READING_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { requestContextOf } from '../support/vnext-scripted-readings.mjs';
import { RECORD_ONLY_KINDS, scriptedActualReading, WEEK_RECORDS, WEEK_TOTAL_MINUTES } from '../support/vnext-actual-readings.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, UNKNOWN_ACTUAL_SAVE_RESULT_REPLY, formatActualRecordRow, formatActualRecordsTotal } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';
import { VNEXT_STUDY_RECORD_PENDING_PREFIX } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords.ts';

// The test body and its helpers are copied from ce0bdacc; this is an independent
// test of unavailable readback while a save result is unknown.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';

const OWNER = { Authorization: 'Bearer owner' };

const rowText = ({ date, subject, minutes }) => formatActualRecordRow({ occurrenceDate: date, subject, minutes });
// Before the click the chat only organises records for confirmation: it must not say they were recorded or saved (fix-01 A).
const PENDING_PREFIX = VNEXT_STUDY_RECORD_PENDING_PREFIX;
const pendingReply = (rows, minutes) => `${PENDING_PREFIX}${rows.map(rowText).join('、')}。ここまでの合計は${formatActualRecordsTotal(minutes)}です。`;

const CONFIRM = {
  open: page => page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL }),
  dialog: page => page.getByRole('dialog', { name: PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL }),
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

  test('A2: lost save acknowledgement and unavailable server readback keep six records pending without another write', async ({ page, request }) => {
    await signIn(page);
    const week = await previousWeekOf(page);
    await seedNeighbours(request, week);
    await openPlannerOnPreviousWeek(page);
    const rows = scenarioRows(week);
    await actualTurn(page, request, week,
      '先週の勉強をまとめて記録したいです。月曜は数学を60分、火曜は英語を45分、水曜は現代文を30分、木曜は休みでした。金曜は英語を50分、土曜は数学を120分、日曜は化学を90分やりました。', 'actual_week');
    await expectPendingReply(page, rows, WEEK_TOTAL_MINUTES);
    const originalIds = (await recordStates(page)).map(state => state.split(' ')[1]);
    expect(originalIds).toHaveLength(6);
    expect(new Set(originalIds).size).toBe(6);
    expect(await actualDocuments(request, userId), 'conversation alone writes no actuals').toEqual([]);
    const dialog = await openConfirmation(page);
    await expectConfirmationRows(dialog, rows, WEEK_TOTAL_MINUTES);

    // First lose only the save acknowledgement. The route is removed before reload.
    const firestoreRoute = /127\.0\.0\.1:8180/;
    await page.route(firestoreRoute, route => route.abort('connectionreset'));
    try {
      await CONFIRM.save(dialog).click();
      await expect(CONFIRM.save(dialog)).toHaveText('保存中...');
      await expect(dialog).toContainText('保存中（まだ確定していません）');
      expect(await actualDocuments(request, userId), 'the blocked first batch never reached the server').toEqual([]);
    } finally {
      await page.unroute(firestoreRoute);
    }

    // The server-only readback uses an exact document-ID range. Its Listen POST alone contains
    // this lower-bound field/value shape; startup's owner-wide actuals query does not.
    const listenRoute = '**/google.firestore.v1.Firestore/Listen/channel**';
    const readbackBound = '"fieldPath":"__name__"},"op":"GREATER_THAN_OR_EQUAL","value":{"referenceValue":"';
    let blockedReadbacks = 0;
    let passedListenPosts = 0;
    await page.route(listenRoute, route => {
      const request = route.request();
      let body = '';
      try { body = decodeURIComponent(request.postData() ?? ''); } catch { /* A malformed body is not the target. */ }
      if (request.method() === 'POST' && body.includes(readbackBound)
        && body.includes('/documents/actuals/wp-actual-')) {
        blockedReadbacks += 1;
        return route.abort('connectionreset');
      }
      if (request.method() === 'POST') passedListenPosts += 1;
      return route.continue();
    });

    try {
      // Begin the ledger on the reloaded document, so retries from the discarded page are not
      // mistaken for an automatic resend by the new page.
      let firestore;
      const observeReloadedPage = frame => {
        if (frame !== page.mainFrame()) return;
        firestore = attachWriteLedger(page);
        page.off('framenavigated', observeReloadedPage);
      };
      page.on('framenavigated', observeReloadedPage);
      await page.reload();
      expect(firestore, 'the ledger observes the reloaded page').toBeDefined();
      await expect(page.locator('.primary-bottom-nav')).toBeVisible({ timeout: 30_000 });
      await openPlannerOnPreviousWeek(page);
      await expect.poll(() => blockedReadbacks, { message: 'the readback Listen POST was intercepted' }).toBeGreaterThan(0);
      expect(passedListenPosts, 'ordinary startup Listen POSTs were allowed through').toBeGreaterThan(0);
      await expect(lastReply(page)).toContainText(UNKNOWN_ACTUAL_SAVE_RESULT_REPLY);
      const reply = await lastReply(page).innerText();
      expect(reply).not.toContain('すでに保存されています');
      expect(reply).not.toContain('サーバー上に保存されていません');
      expect(reply).not.toContain('保存しました');
      expect(await recordStates(page), 'the same six IDs remain pending after the unreadable readback')
        .toEqual(originalIds.map(id => `pending ${id}`));
      expect(await actualDocuments(request, userId), 'the server still has no study records').toEqual([]);
      expect(protectedWritesIn(firestore.writes()), 'reload must not resend the interrupted batch').toEqual([]);

      const pendingDialog = await openConfirmation(page);
      await expectConfirmationRows(pendingDialog, rows, WEEK_TOTAL_MINUTES);
      await expect(CONFIRM.save(pendingDialog), 'the unknown state still exposes a clickable confirmation').toBeEnabled();
      const replyCount = await assistantBubbles(page).count();
      await CONFIRM.save(pendingDialog).click();
      await expect(pendingDialog).toBeVisible();
      expect(await assistantBubbles(page).count(), 'an unknown result makes no new saved claim').toBe(replyCount);
      expect(await recordStates(page), 'an unknown retry cannot change the six pending IDs')
        .toEqual(originalIds.map(id => `pending ${id}`));
      expect(await actualDocuments(request, userId), 'clicking while readback is unknown writes zero documents').toEqual([]);
      expect(protectedWritesIn(firestore.writes()), 'clicking while unknown must not issue a protected write').toEqual([]);
      await expectNeighboursUnchanged(request);
    } finally {
      await page.unroute(listenRoute);
    }
  });
});
