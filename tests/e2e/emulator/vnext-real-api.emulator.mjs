import { expect, test } from '@playwright/test';
import {
  emulatorUserId, notSavedYet, placement, savedAtLeastOnce, savedExactlyOnce, savedFor, unchangedSince,
} from '../support/schedule-event-ledger.mjs';

// The VNext production path with the REAL model, through the real Worker (#926): UI -> Firebase Auth emulator ->
// Worker (production code on wrangler dev) -> durable turn job -> api.openai.com, with trace into the Firestore
// emulator. Run only by the owner-only weekly-planning-real-api-checkpoint workflow (profile vnext-worker). The model is stochastic,
// so assertions are structural (a reply arrives, no failure notice, the preview total follows a correction, the study plan is
// saved, a fixed event is registered as its own preview the V5 way, a reload mid-turn returns the reply without a
// second AI run, each saves exactly once),
// never exact wording. Five real turns, under the budget of six.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const VNEXT = '/?weeklyPlanningCore=vnext';
const FAILURE_NOTICE = 'うまく反映できませんでした';
const TURN_ENDPOINT = '/weekly-planning/turns';
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

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

async function send(page, text) {
  await page.locator('.ai-planning-composer textarea').fill(text);
  await page.getByRole('button', { name: '送信' }).click();
}

/** The preview dialog's own total ("合計 1時間30分"), in minutes, then closed. */
async function previewTotalMinutes(page) {
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  const text = await preview.locator('.ai-planning-preview-total').innerText();
  const hours = Number(/(\d+)時間/.exec(text)?.[1] ?? 0);
  const minutes = Number(/(\d+)分/.exec(text)?.[1] ?? 0);
  await preview.getByRole('button', { name: '閉じる' }).click();
  await expect(preview).toBeHidden();
  return hours * 60 + minutes;
}

/** Approves the shown preview through the existing approval and save. */
async function approveShownPreview(page) {
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await preview.getByRole('button', { name: 'この内容で保存' }).click();
  await expect(preview).toBeHidden();
}

/** Tomorrow in Japan as an ISO date, the date the saved fixed event must carry. */
function tomorrowIsoInJapan() {
  return new Date(Date.now() + 24 * 60 * 60_000 + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

/** Tomorrow in Japan as the explicit date the user states (the browser runs with timezoneId Asia/Tokyo). */
function tomorrowInJapan() {
  const date = new Date(Date.now() + 24 * 60 * 60_000 + 9 * 60 * 60_000);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

async function firestoreDocuments(request, collection) {
  const response = await request.get(`${FIRESTORE}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), collection).toBe(true);
  return (await response.json()).documents ?? [];
}

function outcomesIn(value) {
  return value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, item]) =>
      (key === 'outcome' && typeof item?.stringValue === 'string' ? [item.stringValue] : outcomesIn(item)))
    : [];
}

test('VNext + real model through the Worker: preview, correction, fixed event, consultation, return mid-turn, one save', async ({ page, request }) => {
  const posts = [];
  const failedResponses = [];
  page.on('request', (call) => { if (call.method() === 'POST' && call.url().includes(TURN_ENDPOINT)) posts.push(call.postDataJSON()?.requestId); });
  page.on('response', (response) => {
    if (response.url().includes(TURN_ENDPOINT) && response.status() >= 400) failedResponses.push(`${response.request().method()} ${response.status()}`);
  });
  const conversation = page.locator('.ai-planning-conversation');
  const composer = page.locator('.ai-planning-composer textarea');
  const idle = async () => { await expect(composer).toBeEnabled({ timeout: 150_000 }); };
  // Review evidence: the assistant text the user saw after each turn, and the preview card text when shown.
  // Attached on success and failure so the Japanese reply quality can be reviewed without another AI run.
  const replies = [];
  const capture = async (label) => {
    const bubbles = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
    const card = page.locator('.ai-planning-plan-card');
    replies.push({ label, reply: await bubbles.last().innerText().catch(() => null),
      card: (await card.isVisible().catch(() => false)) ? await card.innerText().catch(() => null) : null });
    // One attachment per turn: a later failing assertion cannot lose the earlier replies.
    await test.info().attach(`reply-${label}.json`, { body: JSON.stringify(replies[replies.length - 1], null, 2), contentType: 'application/json' });
  };

  // What is saved is judged for this account and these exact targets only: the emulator holds other specs' events.
  const userId = await emulatorUserId(request, { email: email(), password: password() });
  const study = { userId, title: 'ゼミ資料' };
  const fixed = { userId, title: 'ピアノ教室', date: tomorrowIsoInJapan() };
  const events = () => firestoreDocuments(request, 'schedule_events');
  const holds = (problems) => expect(problems).toEqual([]);

  await signIn(page);
  await openPlanning(page);
  holds(notSavedYet(await events(), study));
  holds(notSavedYet(await events(), fixed));

  // Turn 1: stated work. The real model reads it through the durable job and the Worker's real output clamp.
  await send(page, 'ゼミ資料の準備に合計60分かかります。今週の夜にやりたいです。');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(1);
  await idle();
  await expect(conversation).toContainText('ゼミ資料');
  await capture('turn1-stated-work');
  await expect(conversation).not.toContainText(FAILURE_NOTICE);

  // Turn 2: an explicit request; the accepted facts become a preview without restating them.
  await send(page, 'この条件で予定を作ってください');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(2);
  await idle();
  await expect(conversation).not.toContainText(FAILURE_NOTICE);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible({ timeout: 30_000 });
  await capture('turn2-create-plan');
  expect(await previewTotalMinutes(page)).toBe(60);
  holds(notSavedYet(await events(), study));

  // Turn 3: a correction after the preview. The preview total must follow the corrected minutes before approval.
  await send(page, '60分ではなく90分に変更してください');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(3);
  await idle();
  await expect(conversation).not.toContainText(FAILURE_NOTICE);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible({ timeout: 30_000 });
  expect(await previewTotalMinutes(page)).toBe(90);
  await capture('turn3-correction-60-to-90');
  // The preview and the correction are only shown: no study plan may be saved before its approval.
  holds(notSavedYet(await events(), study));

  // Approve the corrected study preview through the existing approval. The study blocks are then saved (how
  // many is the planner's choice, so the count is not pinned); the fixed event is not.
  await approveShownPreview(page);
  await expect.poll(async () => savedAtLeastOnce(await events(), study)).toEqual([]);
  const savedStudy = placement(savedFor(await events(), study));
  holds(notSavedYet(await events(), fixed));

  // Turn 4: a fixed event with an explicit date and time, registered as an event rather than study work. As in
  // Stable V5 (current-contract-v5 "Fixed-event registration"), the registration preview carries only the fixed
  // event: registration neither re-authorizes nor repeats study work (here already saved), so the preview is
  // exactly the one 60-minute event. (An unapproved study preview would likewise be left out of a registration
  // turn; the offline EventRegistration test pins that V5 rule.)
  await send(page, `${tomorrowInJapan()}の19:00から20:00にピアノ教室があります。予定として登録してください`);
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(4);
  await idle();
  await expect(conversation).toContainText('ピアノ教室');
  await capture('turn4-fixed-event');
  await expect(conversation).not.toContainText(FAILURE_NOTICE);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible({ timeout: 30_000 });
  expect(await previewTotalMinutes(page)).toBe(60);
  // Registering a fixed event neither saves it before approval nor touches the saved study blocks.
  holds(notSavedYet(await events(), fixed));
  holds(unchangedSince(savedStudy, await events(), study));

  // Turn 5: a consultation that changes nothing, with the return mid-turn. Reload once the Worker has accepted
  // the turn; the saved receipt must bring the reply back by reading the same job, never by another AI run.
  await send(page, '夜に集中が続かないときはどうしたらいいですか？ 今の予定はそのままで大丈夫です');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(5);
  await page.reload();
  await openPlanning(page);
  await expect(conversation).toContainText('夜に集中が続かない', { timeout: 150_000 });
  await idle();
  await expect(conversation).not.toContainText(FAILURE_NOTICE);
  expect(posts).toHaveLength(5);
  await capture('turn5-consultation-after-reload');
  expect(new Set(posts).size).toBe(5);
  // The consultation left the registration preview as it was, and nothing of it is saved before approval.
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible({ timeout: 30_000 });
  expect(await previewTotalMinutes(page)).toBe(60);
  holds(notSavedYet(await events(), fixed));
  holds(unchangedSince(savedStudy, await events(), study));

  // Approve the registration: the fixed event is saved exactly once, on the stated day and hours, and the study
  // blocks stay exactly as saved. After a reload both are still the same documents at the same times.
  await approveShownPreview(page);
  await expect.poll(async () => savedExactlyOnce(await events(), fixed)).toEqual([]);
  const savedFixed = savedFor(await events(), fixed);
  expect(savedFixed.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })))
    .toEqual([{ date: fixed.date, startTime: '19:00', endTime: '20:00' }]);
  holds(unchangedSince(savedStudy, await events(), study));
  await page.reload();
  await openPlanning(page);
  holds(savedExactlyOnce(await events(), fixed));
  holds(unchangedSince(placement(savedFixed), await events(), fixed));
  holds(unchangedSince(savedStudy, await events(), study));

  // Trace reached Firestore through the Worker, and no turn ended in failure. The per-document sizes show what
  // the real model's outputs looked like once they had crossed the Worker and the trace boundary.
  const traces = await firestoreDocuments(request, 'weekly_planning_trace_entries');
  const outcomes = outcomesIn(traces).sort();
  expect(outcomes).not.toContain('failed');
  expect(failedResponses).toEqual([]);
  await test.info().attach('worker-real-api-evidence.json', { contentType: 'application/json', body: JSON.stringify({
    turnPosts: posts.length, traceOutcomes: outcomes, traceDocumentBytes: traces.map((document) => JSON.stringify(document).length) }, null, 2) });
});
