import { expect, test } from '@playwright/test';

// The VNext production path with the REAL model, through the real Worker (#926): UI -> Firebase Auth emulator ->
// Worker (production code on wrangler dev) -> durable turn job -> api.openai.com, with trace into the Firestore
// emulator. Run only by the owner-only weekly-planning-vnext-worker-real-api workflow. The model is stochastic,
// so assertions are structural (a reply arrives, no failure notice, a preview exists, a reload mid-turn returns
// the reply without a second AI run, saving happens exactly once), never exact wording. At most three turns.
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

test('VNext + real model through the Worker: durable turns, return mid-turn, preview, one save', async ({ page, request }) => {
  const posts = [];
  const failedResponses = [];
  page.on('request', (call) => { if (call.method() === 'POST' && call.url().includes(TURN_ENDPOINT)) posts.push(call.postDataJSON()?.requestId); });
  page.on('response', (response) => {
    if (response.url().includes(TURN_ENDPOINT) && response.status() >= 400) failedResponses.push(`${response.request().method()} ${response.status()}`);
  });
  const conversation = page.locator('.ai-planning-conversation');
  const composer = page.locator('.ai-planning-composer textarea');
  const idle = async () => { await expect(composer).toBeEnabled({ timeout: 150_000 }); };

  await signIn(page);
  await openPlanning(page);

  // Turn 1: stated work. The real model reads it through the durable job and the Worker's real output clamp.
  await send(page, 'ゼミ資料の準備に合計60分かかります。今週の夜にやりたいです。');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(1);
  await idle();
  await expect(conversation).toContainText('ゼミ資料');
  await expect(conversation).not.toContainText(FAILURE_NOTICE);

  // Turn 2: an explicit request; the accepted facts become a preview without restating them.
  await send(page, 'この条件で予定を作ってください');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(2);
  await idle();
  await expect(conversation).not.toContainText(FAILURE_NOTICE);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible({ timeout: 30_000 });

  // Turn 3: return mid-turn. Reload once the Worker has accepted the turn; the saved receipt must bring the reply
  // back by reading the same job, never by starting another AI run.
  await send(page, '英語の音読も毎日10分したいです');
  await expect.poll(() => posts.length, { timeout: 60_000 }).toBe(3);
  await page.reload();
  await openPlanning(page);
  await expect(conversation).toContainText('英語の音読', { timeout: 150_000 });
  await idle();
  await expect(conversation).not.toContainText(FAILURE_NOTICE);
  expect(posts).toHaveLength(3);
  expect(new Set(posts).size).toBe(3);

  // Approve the shown preview through the existing approval and save it once.
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await preview.getByRole('button', { name: 'この内容で保存' }).click();
  await expect(preview).toBeHidden();
  await expect.poll(async () => JSON.stringify(await firestoreDocuments(request, 'schedule_events'))).toContain('ゼミ資料');
  const saved = (await firestoreDocuments(request, 'schedule_events'))
    .filter((document) => JSON.stringify(document.fields).includes('ゼミ資料')).length;
  expect(saved).toBeGreaterThanOrEqual(1);
  await page.reload();
  await openPlanning(page);
  expect((await firestoreDocuments(request, 'schedule_events'))
    .filter((document) => JSON.stringify(document.fields).includes('ゼミ資料')).length).toBe(saved);

  // Trace reached Firestore through the Worker, and no turn ended in failure. The per-document sizes show what
  // the real model's outputs looked like once they had crossed the Worker and the trace boundary.
  const traces = await firestoreDocuments(request, 'weekly_planning_trace_entries');
  const outcomes = outcomesIn(traces).sort();
  expect(outcomes).not.toContain('failed');
  expect(failedResponses).toEqual([]);
  await test.info().attach('worker-real-api-evidence.json', { contentType: 'application/json', body: JSON.stringify({
    turnPosts: posts.length, traceOutcomes: outcomes, traceDocumentBytes: traces.map((document) => JSON.stringify(document).length) }, null, 2) });
});
