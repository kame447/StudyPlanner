import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, VNEXT_READING_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { WEEK_RECORDS } from '../support/vnext-actual-readings.mjs';
import { actualsCommitProblems, attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openAiPlanning } from '../support/vnext-production-flows.mjs';
import { vnextActualRecordId } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords.ts';
import { PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL,
  SAVE_ACTUAL_RECORDS_BUTTON_LABEL, SAVING_ACTUAL_RECORDS_LABEL,
  formatActualRecordRow, formatActualRecordsTotal } from '../../../src/features/weeklyPlanning/application/weeklyPlanningActualRecords.ts';

// The emulator's Firestore SDK sends the batch in a Write/channel POST. Hold that POST
// before it reaches the server, while the SDK awaits a result. This does not test a
// delayed or lost acknowledgement after server acceptance; c770067d / b0b82f4b's
// unit and integration tests cover that boundary separately.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
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

async function previousWeek(page) {
  return page.evaluate(() => {
    const jst = new Date(Date.now() + 9 * 3_600_000);
    const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
    const mondayOffset = (jst.getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, day) => new Date(today + (day - mondayOffset - 7) * 86_400_000).toISOString().slice(0, 10));
  });
}

// A no-limit owner query streams every result rather than sampling a list page.
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

function baselineMinutes(documents, week) {
  return week.map(date => documents.reduce((sum, { fields = {} }) => {
    if (fields.occurrenceDate?.stringValue !== date || fields.actualDurationMinutes?.integerValue === undefined) return sum;
    const minutes = Number(fields.actualDurationMinutes.integerValue);
    return sum + (Number.isInteger(minutes) && minutes > 0 && minutes <= 1439 ? minutes : 0);
  }, 0));
}

async function showRecordedWeek(page, week) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  const date = week[0];
  await page.getByRole('button', { name: `${Number(date.slice(0, 4))}年 ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${weekdays[0]}`, exact: true }).click();
  await page.getByRole('tab', { name: '週', exact: true }).click();
  const columns = page.locator('.schedule-week-day-column');
  await expect(columns).toHaveCount(7);
  const labels = await columns.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label').split('（')[0]));
  expect(labels).toEqual(week.map(day => `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`));
  await page.locator('.week-timeline-mode-control').getByRole('button', { name: '記録', exact: true }).click();
  await expect(page.locator('.weekly-draft-preview-date')).toHaveCount(7);
}

async function expectWeekTotals(page, totals) {
  for (const [day, minutes] of totals.entries()) {
    const value = page.locator('.weekly-draft-preview-date').nth(day).locator('.week-duration-actual-total');
    if (minutes === 0) await expect(value, `day ${day} has no duration total`).toHaveCount(0);
    else await expect(value, `day ${day} duration total`).toHaveText(`時刻なし ${formatActualRecordsTotal(minutes)}`);
  }
}

function writtenDocumentNames(request) {
  const body = request.postData();
  if (!body) return [];
  const messages = [...new URLSearchParams(body).entries()].filter(([key]) => key.endsWith('___data__'));
  return messages.flatMap(([, value]) => {
    const message = JSON.parse(value);
    return (message.writes ?? []).map(write => write.update?.name).filter(Boolean);
  });
}

test('a duration batch appears in the week only after its save completes', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const before = await actualDocuments(request, owner);
  const week = await previousWeek(page);
  const baseline = baselineMinutes(before, week);
  const suffix = String(Date.now());
  const rows = WEEK_RECORDS.map(item => ({ occurrenceDate: week[item.day], subject: `${item.subject}${suffix}`, minutes: item.minutes }));
  const ids = rows.map(row => vnextActualRecordId(owner, row.occurrenceDate, row.subject));
  expect(new Set(ids).size).toBe(6);
  expect(rows.reduce((sum, row) => sum + row.minutes, 0)).toBe(395);
  expect(before.filter(doc => ids.some(id => doc.name.endsWith(`/actuals/${id}`)))).toEqual([]);

  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: '日', exact: true }).click();
  for (let day = 0; day < 7; day++) await page.getByRole('button', { name: '前の期間へ' }).click();
  await showRecordedWeek(page, week);
  await expectWeekTotals(page, baseline);
  await openAiPlanning(page);

  const text = `先週の実績です。月曜は数学${suffix}を60分、火曜は英語${suffix}を45分、水曜は現代文${suffix}を30分、木曜は休み、金曜は英語${suffix}を50分、土曜は数学${suffix}を120分、日曜は化学${suffix}を90分勉強しました。`;
  const reading = { planningIntent: 'unknown', conversationActs: [], answer: null, delta: EMPTY,
    studyRecords: rows.map(({ occurrenceDate, subject, minutes }) => ({ dateExpression: occurrenceDate, subject, minutes })),
    studyRecordQuestion: null, studyRestDays: [week[3]] };
  const count = await bubbles(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  const call = await nextCall(request);
  expect(call.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, call, reading);
  await expect(bubbles(page)).toHaveCount(count + 1);
  await expect(composer(page)).toBeEnabled();
  expect(await actualDocuments(request, owner)).toEqual(before);
  expect(protectedWritesIn(writes.writes())).toEqual([]);

  await page.locator('.ai-planning-actual-card').getByRole('button', { name: REVIEW_PROVISIONAL_ACTUAL_RECORDS_LABEL, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL, exact: true });
  await expect(dialog).toBeVisible();
  for (const row of rows) await expect(dialog.getByText(formatActualRecordRow(row), { exact: true })).toBeVisible();
  await expect(dialog.locator('.ai-planning-actual-records-list li')).toHaveCount(6);
  await expect(dialog.locator('[aria-label="実績の合計"]')).toHaveText(`合計 ${formatActualRecordsTotal(395)}`);

  const pattern = '**/google.firestore.v1.Firestore/Write/channel**';
  const held = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const holdBatch = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const names = writtenDocumentNames(route.request());
    if (!names.some(name => ids.some(id => name.endsWith(`/actuals/${id}`)))) return route.continue();
    held.push(names);
    await gate;
    await route.continue();
  };
  await page.route(pattern, holdBatch);
  try {
    await writes.during('save-actuals', async () => {
      await dialog.getByRole('button', { name: SAVE_ACTUAL_RECORDS_BUTTON_LABEL, exact: true }).click();
      await expect(dialog.getByText(SAVING_ACTUAL_RECORDS_LABEL, { exact: true })).toBeVisible();
      await expect.poll(() => held.length, { message: 'the six-record Write POST is held before transmission' }).toBe(1);
      expect(held[0].map(name => name.split('/').pop()).sort()).toEqual([...ids].sort());
      expect(await actualDocuments(request, owner), 'the held batch has not reached Firestore').toEqual(before);

      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      await expect(dialog).toBeHidden();
      await showRecordedWeek(page, week);
      await expectWeekTotals(page, baseline);
      expect(await actualDocuments(request, owner)).toEqual(before);

      release();
      await expect.poll(async () => (await actualDocuments(request, owner)).length).toBe(before.length + 6);
      const expected = baseline.map((minutes, day) => minutes + WEEK_RECORDS.filter(row => row.day === day).reduce((sum, row) => sum + row.minutes, 0));
      await expectWeekTotals(page, expected);
      expect(expected.reduce((sum, minutes, day) => sum + minutes - baseline[day], 0)).toBe(395);
    });
  } finally {
    release();
    await page.unroute(pattern, holdBatch);
  }
  expect(held).toHaveLength(1);
  expect(actualsCommitProblems(writes.commitsIn('save-actuals'), 6)).toEqual([]);
  expect(writes.violations()).toEqual([]);
  const after = await actualDocuments(request, owner);
  const saved = after.filter(doc => ids.some(id => doc.name.endsWith(`/actuals/${id}`)));
  expect(saved).toHaveLength(6);
  for (const [index, row] of rows.entries()) {
    const doc = saved.find(item => item.name.endsWith(`/actuals/${ids[index]}`));
    expect(doc.fields.userId.stringValue).toBe(owner);
    expect(doc.fields.occurrenceDate.stringValue).toBe(row.occurrenceDate);
    expect(doc.fields.subject.stringValue).toBe(row.subject);
    expect(Number(doc.fields.actualDurationMinutes.integerValue)).toBe(row.minutes);
  }
  expect(after.filter(doc => !ids.some(id => doc.name.endsWith(`/actuals/${id}`)))).toEqual(before);
});
