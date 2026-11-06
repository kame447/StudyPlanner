import { expect, test as base } from '@playwright/test';
import { installStartupSkipContext } from '../support/startup-ready.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';

// Baseline for an examinee's week of study records (#926 follow-up, ARGON-FIRST.md S1): the week 2026-10-26 (Mon) to
// 2026-11-01 (Sun) is entered through the existing record UI only (QuickEntryModal, "記録" kind: a standalone Actual,
// planId null), read back in the day view, the week view and Firestore, and compared after a reload. Nothing here goes
// through the AI chat and no model is called. Expected values come from the scenario, not from what the app shows:
//   Mon 数学 60, Tue 英語 45, Wed 現代文 30, Thu rest (no record, 0 minutes), Fri 英語 50, Sat 数学 120, Sun 化学 90 = 395.
// The start time is typed by the user; none is invented from date/subject/minutes.
// The browser clock is fixed to Tue 2026-11-03 10:00 (Asia/Tokyo) so "the past week" is the same on every run.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const FIXED_NOW = new Date('2026-11-03T10:00:00+09:00');
const OWNER = { Authorization: 'Bearer owner' };

const WEEK = [
  { date: '2026-10-26', start: '19:00', weekday: '月', subject: '数学', title: '数学の勉強', minutes: 60 },
  { date: '2026-10-27', start: '18:30', weekday: '火', subject: '英語', title: '英語の勉強', minutes: 45 },
  { date: '2026-10-28', start: '20:00', weekday: '水', subject: '現代文', title: '現代文の勉強', minutes: 30 },
  { date: '2026-10-30', start: '17:00', weekday: '金', subject: '英語', title: '英語の勉強', minutes: 50 },
  { date: '2026-10-31', start: '09:00', weekday: '土', subject: '数学', title: '数学の勉強', minutes: 120 },
  { date: '2026-11-01', start: '13:00', weekday: '日', subject: '化学', title: '化学の勉強', minutes: 90 },
];
const THURSDAY = '2026-10-29';
const WEEK_DATES = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const OUTSIDE = [
  { date: '2026-10-20', start: '19:30', weekday: '火', subject: '英語', title: '先々週の英語', minutes: 30 },
  { date: '2026-11-02', start: '19:15', weekday: '月', subject: '数学', title: '今週の数学', minutes: 45 },
];

const test = base.extend({
  context: async ({ context }, use) => {
    await context.clock.install({ time: FIXED_NOW });
    const cleanup = await installStartupSkipContext(context);
    await use(context);
    await cleanup();
  },
});

const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

const text = (field) => field?.stringValue ?? null;
const endOf = (start, minutes) => {
  const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const minutesBetween = (start, end) => Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - Number(start.slice(0, 2)) * 60 - Number(start.slice(3));
const dayLabel = ({ date, weekday }) => `${Number(date.slice(0, 4))}年 ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${weekday}`;

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

async function openSchedule(page, view) {
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await page.getByRole('tab', { name: view, exact: true }).click();
}

async function selectDay(page, entry) {
  await openSchedule(page, '日');
  await page.getByRole('button', { name: dayLabel(entry), exact: true }).click();
  await expect(page.getByRole('button', { name: dayLabel(entry), exact: true })).toHaveAttribute('aria-current', 'date');
}

/** One record through the real UI: the day is selected first (the modal's date is the selected day, not editable). */
async function recordThroughUi(page, entry, { submit = (button) => button.click() } = {}) {
  await selectDay(page, entry);
  await page.locator('.quick-add-trigger').click();
  await page.getByRole('menuitem', { name: '学習を追加' }).click();
  const dialog = page.getByRole('dialog', { name: '予定・記録の追加' });
  await dialog.getByRole('tab', { name: '記録', exact: true }).click();
  await dialog.getByLabel('タイトル').fill(entry.title);
  await dialog.getByLabel('科目').fill(entry.subject);
  const preset = dialog.getByRole('button', { name: `${entry.minutes}分`, exact: true });
  if (await preset.count()) {
    await preset.click();
  } else {
    await dialog.getByRole('button', { name: '自由', exact: true }).click();
    await dialog.getByLabel('自由入力（分）').fill(String(entry.minutes));
  }
  await dialog.getByLabel('開始時刻').fill(entry.start);
  await expect(dialog.getByLabel('日付')).toHaveValue(entry.date);
  await expect(dialog.getByText(`終了時刻: ${endOf(entry.start, entry.minutes)}`)).toBeVisible();
  await submit(dialog.getByRole('button', { name: '保存', exact: true }));
  await expect(dialog).toHaveCount(0);
}

async function actualDocuments(request, userId) {
  const response = await request.get(`${FIRESTORE}/actuals?pageSize=300`, { headers: OWNER });
  expect(response.ok(), 'actuals').toBe(true);
  return ((await response.json()).documents ?? [])
    .map(({ name, fields = {} }) => ({
      docId: name.split('/').pop(), id: text(fields.id), userId: text(fields.userId), planId: fields.planId?.nullValue === null ? null : text(fields.planId),
      date: text(fields.occurrenceDate), start: text(fields.actualStartTime), end: text(fields.actualEndTime),
      title: text(fields.title), subject: text(fields.subject), note: text(fields.note), updatedAt: text(fields.updatedAt),
    }))
    .filter((record) => record.userId === userId)
    .sort((a, b) => `${a.date}${a.title}${a.id}`.localeCompare(`${b.date}${b.title}${b.id}`));
}

const minutesOf = (record) => minutesBetween(record.start, record.end);
const inWeek = (record) => WEEK_DATES.includes(record.date);
const weekTotal = (records) => records.filter(inWeek).reduce((sum, record) => sum + minutesOf(record), 0);
const byDate = (records) => Object.fromEntries(WEEK_DATES.map((date) => [date, records.filter((record) => record.date === date).map((record) => `${record.subject} ${minutesOf(record)}`)]));

const EXPECTED_BY_DATE = {
  '2026-10-26': ['数学 60'], '2026-10-27': ['英語 45'], '2026-10-28': ['現代文 30'], '2026-10-29': [],
  '2026-10-30': ['英語 50'], '2026-10-31': ['数学 120'], '2026-11-01': ['化学 90'],
};

async function readWeekView(page) {
  await openSchedule(page, '週');
  await page.getByRole('button', { name: '記録', exact: true }).click();
  const columns = page.locator('.schedule-week-day-column');
  await expect(columns).toHaveCount(7);
  return columns.evaluateAll((nodes) => nodes.map((node) => ({
    label: node.getAttribute('aria-label'),
    blocks: [...node.querySelectorAll('.weekly-draft-preview-block')].map((block) => block.getAttribute('title')),
  })));
}

test.describe.serial('examinee week of study records through the existing record UI', () => {
  let userId;
  let otherUser;
  test.beforeAll(async ({ request }) => {
    userId = await emulatorUserId(request, { email: email(), password: password() });
    // Another account's record, written the way the app writes it (shape copied after the first UI record below).
    otherUser = { id: 'other-examinee-uid', docId: 'other-examinee-record-1' };
  });

  test('S1: the week is recorded through the UI; day view, week view and Firestore agree before and after a reload', async ({ page, request }) => {
    await signIn(page);
    expect(await actualDocuments(request, userId), 'the account starts without records').toEqual([]);

    // Records in the neighbouring weeks first: the week's checks must exclude them and they must stay unchanged.
    for (const entry of OUTSIDE) await recordThroughUi(page, entry);
    const outsideSaved = await actualDocuments(request, userId);
    expect(outsideSaved.map(({ date, subject, start, end }) => ({ date, subject, start, end }))).toEqual([
      { date: '2026-10-20', subject: '英語', start: '19:30', end: endOf('19:30', 30) },
      { date: '2026-11-02', subject: '数学', start: '19:15', end: endOf('19:15', 45) },
    ]);

    // Another user's record in the same week: copied from this account's document, owned by someone else.
    const sample = (await request.get(`${FIRESTORE}/actuals/${outsideSaved[1].docId}`, { headers: OWNER }));
    expect(sample.ok()).toBe(true);
    const sampleFields = (await sample.json()).fields;
    const otherFields = { ...sampleFields, id: { stringValue: otherUser.id }, userId: { stringValue: 'someone-else-uid' }, occurrenceDate: { stringValue: '2026-10-27' }, title: { stringValue: '他人の記録' } };
    const created = await request.patch(`${FIRESTORE}/actuals/${otherUser.docId}`, { headers: OWNER, data: { fields: otherFields } });
    expect(created.ok(), 'other user record created').toBe(true);
    const otherBefore = await (await request.get(`${FIRESTORE}/actuals/${otherUser.docId}`, { headers: OWNER })).json();

    for (const entry of WEEK) await recordThroughUi(page, entry);

    const saved = await actualDocuments(request, userId);
    const week = saved.filter(inWeek);
    expect(week.length, 'one record per studied day, none for Thursday').toBe(6);
    expect(byDate(saved)).toEqual(EXPECTED_BY_DATE);
    expect(week.every((record) => record.planId === null), 'standalone records (planId null)').toBe(true);
    expect(week.map(({ date, start }) => ({ date, start })), 'only the start times the user typed').toEqual(WEEK.map(({ date, start }) => ({ date, start })));
    expect(weekTotal(saved)).toBe(395);
    expect(saved.filter((record) => !inWeek(record)).length).toBe(2);
    expect(saved.filter((record) => record.date === THURSDAY)).toEqual([]);

    const checkViews = async (label) => {
      for (const entry of WEEK) {
        await selectDay(page, entry);
        const block = page.locator('.timeline-actual-block').filter({ hasText: entry.title });
        await expect(block, `${label}: ${entry.date} day view`).toHaveCount(1);
        await expect(block).toContainText(`${entry.start}-${endOf(entry.start, entry.minutes)}`);
      }
      await selectDay(page, { date: THURSDAY, weekday: '木' });
      await expect(page.locator('.timeline-actual-block'), `${label}: Thursday day view shows no record`).toHaveCount(0);
      const columns = await readWeekView(page);
      const shown = Object.fromEntries(columns.map(({ label: columnLabel, blocks }) => [columnLabel, blocks]));
      expect(Object.values(shown).flat().length, `${label}: week view shows the 6 records of the week`).toBe(6);
    };
    await checkViews('before reload');
    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible();
    await checkViews('after reload');

    const afterReload = await actualDocuments(request, userId);
    expect(afterReload.map(({ id, date, start, end, subject, title, updatedAt }) => ({ id, date, start, end, subject, title, updatedAt })))
      .toEqual(saved.map(({ id, date, start, end, subject, title, updatedAt }) => ({ id, date, start, end, subject, title, updatedAt })));
    expect(afterReload.filter((record) => !inWeek(record))).toEqual(outsideSaved);
    expect(await (await request.get(`${FIRESTORE}/actuals/${otherUser.docId}`, { headers: OWNER })).json()).toEqual(otherBefore);
  });

  test('N3: a save pressed twice at once records one entry, and the neighbouring records stay as they were', async ({ page, request }) => {
    await signIn(page);
    const before = await actualDocuments(request, userId);
    const entry = { date: '2026-10-19', start: '19:00', weekday: '月', subject: '物理', title: '物理の勉強', minutes: 60 };
    await recordThroughUi(page, entry, { submit: (button) => button.evaluate((element) => { element.click(); element.click(); }) });
    await expect.poll(async () => (await actualDocuments(request, userId)).length).toBeGreaterThanOrEqual(before.length + 1);
    const after = await actualDocuments(request, userId);
    expect(after.filter((record) => record.date === entry.date), 'two clicks in the same tick').toHaveLength(1);
    expect(after.filter((record) => record.date !== entry.date)).toEqual(before);
  });

  test('S2: correcting Tuesday from 45 to 50 minutes edits that record: same id, same count, week total 400', async ({ page, request }) => {
    await signIn(page);
    const before = await actualDocuments(request, userId);
    const tuesday = before.filter((record) => record.date === '2026-10-27');
    expect(tuesday).toHaveLength(1);
    await selectDay(page, { date: '2026-10-27', weekday: '火' });
    await page.locator('.timeline-actual-block').filter({ hasText: '英語の勉強' }).click();
    const editor = page.locator('.standalone-actual-editor-card');
    await editor.getByRole('button', { name: '自由', exact: true }).click();
    await editor.getByLabel('自由入力（分）').fill('50');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editor).toHaveCount(0);

    const after = await actualDocuments(request, userId);
    expect(after).toHaveLength(before.length);
    const corrected = after.filter((record) => record.date === '2026-10-27');
    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({ id: tuesday[0].id, start: '18:30', end: '19:20', subject: '英語' });
    expect(weekTotal(before)).toBe(395);
    expect(weekTotal(after)).toBe(400);
    expect(after.filter((record) => record.date !== '2026-10-27')).toEqual(before.filter((record) => record.date !== '2026-10-27'));
    await page.reload();
    await expect(page.locator('.primary-bottom-nav')).toBeVisible();
    await selectDay(page, { date: '2026-10-27', weekday: '火' });
    await expect(page.locator('.timeline-actual-block').filter({ hasText: '英語の勉強' })).toContainText('18:30-19:20');
  });

  test('characterization: entering the same record again through the UI makes a second record (the UI does not de-duplicate)', async ({ page, request }) => {
    await signIn(page);
    const before = await actualDocuments(request, userId);
    await recordThroughUi(page, WEEK[0]);
    const after = await actualDocuments(request, userId);
    expect(after.filter((record) => record.date === WEEK[0].date)).toHaveLength(2);
    expect(after).toHaveLength(before.length + 1);
    expect(weekTotal(after)).toBe(weekTotal(before) + WEEK[0].minutes);
  });
});
