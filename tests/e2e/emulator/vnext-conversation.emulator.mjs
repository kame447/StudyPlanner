import { expect, test } from '@playwright/test';

// The connected VNext path (#926) on the isolated target (#947): the real planning UI, switched to VNext
// only by the explicit local query parameter, talks to the local Worker, which authenticates against the
// Auth emulator, records trace in the Firestore emulator and forwards AI calls to the synthetic provider.
// The test answers each forwarded call from the request the Worker actually sent (real network path,
// scripted model output: real-model quality is the real-API workflow's job). The preview is approved
// through V5's approval, saved to Firestore, reloaded, survives a failed turn, and the page returns to V5.
const SYNTHETIC = 'http://127.0.0.1:18790';
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const VNEXT = '/?weeklyPlanningCore=vnext';
const V5 = '/?weeklyPlanningCore=v5';
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

async function signIn(page, path) {
  await page.goto(path);
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

/** The next model call the Worker forwarded, with the structured-output schema it asked for. */
async function nextCall(request) {
  const response = await request.get(`${SYNTHETIC}/__synthetic/next?route=chat`, { timeout: 30_000 });
  const held = await response.json();
  return { ...held, schema: held.body?.response_format?.json_schema?.name ?? null };
}

async function answer(request, call, content, status = 200) {
  const body = status === 200
    ? { id: `synthetic-${call.id}`, object: 'chat.completion', model: call.body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    : { error: { message: 'synthetic provider failure' } };
  await request.post(`${SYNTHETIC}/__synthetic/respond`, { data: { id: call.id, status, body } });
}

/**
 * A renderer reply for the application's decision as the actual request states it: the same action,
 * kind and question, naming every label the request requires (the renderer's own validator checks this).
 */
function rendererReply(call) {
  const prompt = call.body.messages.map((message) => {
    try { return JSON.parse(message.content); } catch { return null; }
  }).find((content) => content?.applicationDecision);
  expect(prompt, 'renderer request carries the application decision').toBeTruthy();
  const decision = prompt.applicationDecision;
  const labels = [...(decision.relevantLabels ?? []), decision.previewPromotionControlLabel].filter(Boolean);
  return { actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode ?? null,
    groundingAcknowledgement: null, text: `${labels.join('、')}について確認しました。` };
}

async function firestoreDocuments(request, collection) {
  const response = await request.get(`${FIRESTORE}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), collection).toBe(true);
  return (await response.json()).documents ?? [];
}

test('VNext core: UI → Worker → Auth/Firestore/trace → preview → approval → save → reload → failure → V5 and back', async ({ page, request }) => {
  await signIn(page, VNEXT);
  await openPlanning(page);

  // Turn 1: facts alone. The user's text reaches the VNext interpreter through the Worker; it reads no
  // request to create a plan, so, as in Stable V5, the facts are kept but no preview is made (#926 A).
  await send(page, 'ゼミ資料を60分');
  const reading = await nextCall(request);
  expect(reading.schema).toBe('weekly_planning_vnext_native_v1');
  expect(JSON.stringify(reading.body.messages)).toContain('ゼミ資料を60分');
  await answer(request, reading, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: { patch: [], remove: [], relate: [], defer: [], add: [
    { kind: 'task', localId: 'seminar', category: 'study', title: 'ゼミ資料' },
    { kind: 'workload', localId: 'seminar_minutes', taskRef: { localId: 'seminar' }, componentRef: null,
      quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null },
  ] } });
  const unauthorized = await nextCall(request);
  expect(unauthorized.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  const unauthorizedReply = rendererReply(unauthorized);
  expect(unauthorizedReply.actionKind).not.toBe('preview_ready');
  await answer(request, unauthorized, unauthorizedReply);
  await expect(page.locator('.ai-planning-conversation')).toContainText(unauthorizedReply.text);
  await expect(page.locator('.ai-planning-plan-card')).toHaveCount(0);

  // Turn 2: an explicit request to create the plan; the accepted facts now preview without restating them.
  await send(page, 'この条件で予定を作って');
  const create = await nextCall(request);
  expect(create.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, create, { planningIntent: 'create_plan', conversationActs: [], answer: null,
    delta: { add: [], patch: [], remove: [], relate: [], defer: [] } });
  const rendering = await nextCall(request);
  expect(rendering.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  const previewReply = rendererReply(rendering);
  expect(previewReply.actionKind).toBe('preview_ready');
  await answer(request, rendering, previewReply);

  // The V5 preview UI shows the VNext placement; approval runs through V5's approval application.
  const planCard = page.locator('.ai-planning-plan-card');
  await expect(planCard).toBeVisible();
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(1);
  await preview.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  await preview.getByRole('button', { name: 'この内容で保存' }).click();
  await expect(preview).toBeHidden();

  // Saved in Firestore by the existing plan repository (schedule_events), and traced through the Worker.
  await expect.poll(async () => JSON.stringify(await firestoreDocuments(request, 'schedule_events'))).toContain('ゼミ資料');
  await expect.poll(async () => (await firestoreDocuments(request, 'weekly_planning_trace_sessions')).length).toBeGreaterThan(0);

  // Reload: the VNext conversation resumes from its own checkpoint, and the plan was saved exactly once.
  await page.reload();
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).toContainText('ゼミ資料を60分');
  const seminarEvents = async () => (await firestoreDocuments(request, 'schedule_events'))
    .filter((document) => JSON.stringify(document.fields).includes('ゼミ資料')).length;
  expect(await seminarEvents()).toBe(1);

  // A failed provider call: the native reading fails, then the recovery renderer is asked to explain it.
  // Failing that too must end the turn with VNext's system notice, apply nothing and save nothing.
  await send(page, '英語の音読も30分');
  const failed = await nextCall(request);
  expect(failed.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, failed, null, 500);
  const recovery = await nextCall(request);
  await answer(request, recovery, null, 500);
  await expect(page.locator('.ai-planning-conversation'))
    .toContainText('うまく反映できませんでした。もう一度、言い方を変えて教えてください。');
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  expect(JSON.stringify(await firestoreDocuments(request, 'schedule_events'))).not.toContain('英語の音読');
  expect(await seminarEvents()).toBe(1);

  // Trace (through the Worker into Firestore) records each turn's own result: facts without a request to
  // plan as V5's needs_scope, the previewed turn as preview_ready, the failed one as failed, never idle.
  const outcomesIn = (value) => (value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, item]) =>
      (key === 'outcome' && typeof item?.stringValue === 'string' ? [item.stringValue] : outcomesIn(item)))
    : []);
  const traceOutcomes = async () => outcomesIn(await firestoreDocuments(request, 'weekly_planning_trace_entries')).sort();
  await expect.poll(traceOutcomes).toEqual(['failed', 'needs_scope', 'preview_ready']);

  // Rollback: the same origin without VNext is Stable V5 with its own conversation; then VNext again.
  await signIn(page, V5);
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).not.toContainText('ゼミ資料を60分');
  await signIn(page, VNEXT);
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).toContainText('ゼミ資料を60分');
});
