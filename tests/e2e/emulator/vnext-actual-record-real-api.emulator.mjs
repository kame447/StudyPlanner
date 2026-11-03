import { expect, test as base } from '@playwright/test';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import {
  examWeekOf, todayInJapan,
  byDate, noClockTimes, noneSaved, nothingOn, pendingReply, questionMarksIn, rowText, savedExactly, savedReply,
  savedWordsIn, studyRecordIdPrefix, studyRecordsOf, sumMinutes, totalText,
} from '../support/actual-record-ledger.mjs';

// The examinee's "last week" study record with the REAL model, through the real Worker (#973 R1). Run only by the
// owner-only weekly-planning-real-api-checkpoint workflow (profile vnext-worker), never by a pull request, and not by
// the scripted suites: scripted readings prove the code path, not that the model reads a student's sentences.
// "Last week" is the Monday..Sunday before the run's week in Japan (real clock). Every expected value comes from
// the fixed scenario (support/actual-record-ledger.mjs), never from a model output; a model failure stays a failure
// (no retry, no skip, no loosened expectation). Evidence per turn: the reply the user saw and what the confirmation lists.
// Ids are owner x date x subject (fix-02), so each scenario clears this account's study records first. N3 sends the same week again after a
// reload: the answer is the owner's "already saved" sentence (fix-03). Contract under test: the reply lists records for confirmation without saying anything is saved; actuals are written only
// by the click on 「この内容で実績を保存」 (all or nothing, one document per date and subject, no clock time).
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const VNEXT = '/?weeklyPlanningCore=vnext';
const FAILURE_NOTICE = 'うまく反映できませんでした';
const TURN_ENDPOINT = '/weekly-planning/turns';
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

// The real clock: the durable Worker accepts a turn only if it starts within a few minutes of now (durableTurnJob.ts acceptanceAgeMs), so
// the browser clock is never faked here. "Last week" is the Monday..Sunday before this run's week in Japan, computed once at load.
const { week: WEEK, restDay: REST_DAY, correctedTuesday: CORRECTED_TUESDAY, total: WEEK_TOTAL, correctedTotal: CORRECTED_TOTAL } = examWeekOf(todayInJapan());
const test = base.extend({ timezoneId: ['Asia/Tokyo', { option: true }] });

async function signIn(page) {
  await page.goto(VNEXT);
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

async function openPlanning(page) {
  await page.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画' }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
}

async function firestoreDocuments(request, collection) {
  const response = await request.get(`${FIRESTORE}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), collection).toBe(true);
  return (await response.json()).documents ?? [];
}

/**
 * Study-record ids are owner x date x subject, so every scenario of this account writes the same documents for the same days:
 * each scenario starts from none. The emulator's REST owner token removes this synthetic account's study records only
 * (ids made from conversations), before the page loads its actuals.
 */
async function clearStudyRecords(request, userId) {
  for (const record of studyRecordsOf(await firestoreDocuments(request, 'actuals'), userId)) {
    const response = await request.delete(`${FIRESTORE}/actuals/${encodeURIComponent(record.id)}`, { headers: { Authorization: 'Bearer owner' } });
    expect(response.ok(), `clearing ${record.id}`).toBe(true);
  }
  expect(studyRecordsOf(await firestoreDocuments(request, 'actuals'), userId).map((record) => record.id)).toEqual([]);
}

/** One scenario: a fresh browser context (a fresh conversation), an account with no study records, and the turn helpers. */
async function begin(page, request) {
  const posts = [];
  const failedResponses = [];
  page.on('request', (call) => { if (call.method() === 'POST' && call.url().includes(TURN_ENDPOINT)) posts.push(call.postDataJSON()?.requestId); });
  page.on('response', (response) => {
    if (response.url().includes(TURN_ENDPOINT) && response.status() >= 400) failedResponses.push(`${response.request().method()} ${response.status()}`);
  });
  const userId = await emulatorUserId(request, { email: email(), password: password() });
  await clearStudyRecords(request, userId);
  await signIn(page);
  await openPlanning(page);
  const composer = page.locator('.ai-planning-composer textarea');
  const conversation = page.locator('.ai-planning-conversation');
  const evidence = [];
  const added = async () => studyRecordsOf(await firestoreDocuments(request, 'actuals'), userId);

  /** Sends one utterance, waits for the real model's reply, and records exactly what the user saw. */
  async function say(label, utterance) {
    const before = posts.length;
    await composer.fill(utterance);
    await page.getByRole('button', { name: '送信' }).click();
    await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(before + 1);
    await expect(composer).toBeEnabled({ timeout: 150_000 });
    await expect(conversation).not.toContainText(FAILURE_NOTICE);
    const reply = await page.locator('.ai-planning-message-row.assistant .ai-planning-bubble').last().innerText();
    const card = page.locator('.ai-planning-actual-card');
    const listed = (await card.isVisible()) ? await listedRows(page) : [];
    const entry = { label, utterance, reply, listed };
    evidence.push(entry);
    // One attachment per turn: a later failing assertion cannot lose the earlier ones.
    await test.info().attach(`turn-${evidence.length}-${label}.json`, { body: JSON.stringify(entry, null, 2), contentType: 'application/json' });
    // Before the user's click nothing may say "saved".
    expect(savedWordsIn(reply), `${label}: the reply claims a save that has not happened`).toEqual([]);
    return entry;
  }
  return { posts, failedResponses, userId, added, say, evidence, conversation };
}

/** What the confirmation lists (opened from the card, closed again), and its code-made total text. */
async function listedRows(page) {
  await page.locator('.ai-planning-actual-open').click();
  const section = page.locator('section.ai-planning-actual-records');
  await expect(section).toBeVisible();
  const rows = await section.locator('li').allInnerTexts();
  const total = await section.locator('[aria-label="実績の合計"]').innerText();
  await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).first().click();
  await expect(section).toBeHidden();
  return { rows: rows.map((row) => row.trim()), total: total.trim() };
}

/** Opens the confirmation and clicks the only save authority, then waits until the confirmation is done. */
async function confirmAndSave(page) {
  await page.locator('.ai-planning-actual-open').click();
  const section = page.locator('section.ai-planning-actual-records');
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: 'この内容で実績を保存' }).click();
  await expect(page.locator('.ai-planning-actual-card')).toBeHidden({ timeout: 60_000 });
}

const holds = (problems) => expect(problems).toEqual([]);
const expectListed = (entry, records) => {
  const wanted = byDate(records);
  expect(entry.listed.rows).toEqual(wanted.map(rowText));
  expect(entry.listed.total).toBe(`合計 ${totalText(sumMinutes(wanted))}`);
};

async function finish(scenario, request, page, expected) {
  const saved = await scenario.added();
  holds(savedExactly(saved, expected));
  holds(noClockTimes(saved));
  holds(nothingOn(saved, REST_DAY));
  // After a reload the same documents are still the whole truth, and the confirmation offers nothing again.
  await page.reload();
  await openPlanning(page);
  await expect(page.locator('.ai-planning-actual-card')).toHaveCount(0);
  const reloaded = await scenario.added();
  expect(reloaded.map(({ id, date, subject, minutes }) => ({ id, date, subject, minutes })))
    .toEqual(saved.map(({ id, date, subject, minutes }) => ({ id, date, subject, minutes })));
  expect(scenario.failedResponses).toEqual([]);
  await test.info().attach('scenario-evidence.json', { contentType: 'application/json', body: JSON.stringify({
    turnPosts: scenario.posts.length, turns: scenario.evidence, saved }, null, 2) });
}

test('S1 one long utterance: six rows for confirmation, nothing saved until the click, then six documents', async ({ page, request }) => {
  const s = await begin(page, request);
  const first = await s.say('s1-long', '先週の勉強を記録したいです。月曜は数学を60分、火曜は英語を45分、水曜は現代文を30分、木曜は休みでした。'
    + '金曜は英語を50分、土曜は数学を2時間、日曜は化学を90分やりました。');
  expect(first.reply).toBe(pendingReply(WEEK, WEEK));
  expectListed(first, WEEK);
  expect(WEEK_TOTAL).toBe(sumMinutes(WEEK));
  holds(noneSaved(await s.added()));
  await confirmAndSave(page);
  await finish(s, request, page, WEEK);
});

test('S2 short turns, then a Tuesday correction: one Tuesday document of 50 minutes, total 400', async ({ page, request }) => {
  const s = await begin(page, request);
  const [mon, tue, wed, fri, sat, sun] = WEEK; // Thursday has no entry
  expectListed(await s.say('s2-1-mon', '先週の勉強を記録したいです。月曜は数学を60分やりました。'), [mon]);
  expectListed(await s.say('s2-2-tue-wed', '火曜は英語を45分、水曜は現代文を30分です。'), [mon, tue, wed]);
  // A rest day adds nothing; the list is as it was.
  const rest = await s.say('s2-3-thu-rest', '木曜は休みでした。');
  expectListed(rest, [mon, tue, wed]);
  expectListed(await s.say('s2-4-fri-sun', '金曜は英語を50分、土曜は数学を120分、日曜は化学を90分でした。'), WEEK);
  holds(noneSaved(await s.added()));
  const corrected = [mon, CORRECTED_TUESDAY, wed, fri, sat, sun];
  const fixed = await s.say('s2-5-correction', 'あ、火曜は50分だった。');
  expectListed(fixed, corrected);
  expect(sumMinutes(corrected)).toBe(CORRECTED_TOTAL);
  holds(noneSaved(await s.added()));
  await confirmAndSave(page);
  await finish(s, request, page, corrected);
});

test('N1 a rest day makes no record: Thursday has no document and no invented minutes', async ({ page, request }) => {
  const s = await begin(page, request);
  const entry = await s.say('n1-rest', '先週の勉強を記録したいです。月曜は数学を60分やりました。木曜は休みで、勉強していません。');
  expectListed(entry, [WEEK[0]]);
  await confirmAndSave(page);
  await finish(s, request, page, [WEEK[0]]);
});

test('N2 a plan sentence adds no actual: the one stated record stays the only one', async ({ page, request }) => {
  const s = await begin(page, request);
  expectListed(await s.say('n2-1-record', '先週の勉強を記録したいです。月曜は数学を60分やりました。'), [WEEK[0]]);
  const planned = await s.say('n2-2-plan', '来週の数学の計画を60分入れてください。');
  expectListed(planned, [WEEK[0]]);
  holds(noneSaved(await s.added()));
  await confirmAndSave(page);
  // Only the confirmed record exists; no actual was made from the plan sentence (a plan preview, if shown, is not judged here).
  await finish(s, request, page, [WEEK[0]]);
});

test('N3 saved, reloaded, the same week sent again: answered as already saved, nothing to confirm, the same six documents', async ({ page, request }) => {
  const s = await begin(page, request);
  const long = '先週の勉強を記録したいです。月曜は数学を60分、火曜は英語を45分、水曜は現代文を30分、木曜は休みでした。'
    + '金曜は英語を50分、土曜は数学を120分、日曜は化学を90分やりました。';
  const first = await s.say('n3-1-long', long);
  expect(first.reply).toBe(pendingReply(WEEK, WEEK));
  await confirmAndSave(page);
  const savedOnce = await s.added();
  holds(savedExactly(savedOnce, WEEK));
  const snapshot = savedOnce.map(({ id, date, subject, minutes }) => ({ id, date, subject, minutes }));
  // A reload starts a new conversation (an empty checkpoint) while the six documents stay saved.
  await page.reload();
  await openPlanning(page);
  const again = await s.say('n3-2-resend-after-reload', long);
  // The product owns the wording; the scenario fixes what it must say: that sentence alone, never "not saved yet".
  expect(again.reply).toBe(savedReply(WEEK));
  expect(again.reply).not.toContain('まだ保存していません');
  await expect(page.locator('.ai-planning-actual-card')).toHaveCount(0);
  const after = await s.added();
  expect(after.map(({ id, date, subject, minutes }) => ({ id, date, subject, minutes }))).toEqual(snapshot);
  holds(noClockTimes(after));
  holds(nothingOn(after, REST_DAY));
  expect(s.failedResponses).toEqual([]);
  await test.info().attach('scenario-evidence.json', { contentType: 'application/json', body: JSON.stringify({ turnPosts: s.posts.length, turns: s.evidence, saved: after }, null, 2) });
});

test('N4 vague input records nothing and asks exactly one question; a total over days is never split', async ({ page, request }) => {
  const s = await begin(page, request);
  const card = page.locator('.ai-planning-actual-card');
  const vague = await s.say('n4-1-chotto', '先週、数学ちょっとやりました。');
  expect(questionMarksIn(vague.reply), vague.reply).toBe(1);
  await expect(card).toHaveCount(0);
  const spread = await s.say('n4-2-weekend-total', '土日で化学を3時間やりました。');
  expect(questionMarksIn(spread.reply), spread.reply).toBe(1);
  // Not 90 + 90 and not any other split: the user never said how the three hours divide.
  await expect(card).toHaveCount(0);
  holds(noneSaved(await s.added()));
  holds(noClockTimes(await s.added()));
  expect(s.failedResponses).toEqual([]);
  await test.info().attach('scenario-evidence.json', { contentType: 'application/json', body: JSON.stringify({ turnPosts: s.posts.length, turns: s.evidence }, null, 2) });
});
