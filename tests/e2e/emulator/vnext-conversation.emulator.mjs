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

/** The renderer must echo the action it was asked to explain; read it from the actual request. */
function requestedActionId(call) {
  const match = call.body.messages.map((message) => /"actionId"\s*:\s*"([^"]+)"/.exec(message.content)).find(Boolean);
  expect(match, 'renderer request carries an actionId').toBeTruthy();
  return match[1];
}

async function firestoreDocuments(request, collection) {
  const response = await request.get(`${FIRESTORE}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), collection).toBe(true);
  return (await response.json()).documents ?? [];
}

test('VNext core: UI → Worker → Auth/Firestore/trace → preview → approval → save → reload → failure → V5 and back', async ({ page, request }) => {
  await signIn(page, VNEXT);
  await openPlanning(page);

  // Turn 1: the user's text reaches the VNext interpreter through the Worker; then the V5 renderer explains.
  await send(page, 'ゼミ資料を60分');
  const reading = await nextCall(request);
  expect(reading.schema).toBe('weekly_planning_vnext_native_v1');
  expect(JSON.stringify(reading.body.messages)).toContain('ゼミ資料を60分');
  await answer(request, reading, { answer: null, delta: { patch: [], remove: [], relate: [], defer: [], add: [
    { kind: 'task', localId: 'seminar', category: 'study', title: 'ゼミ資料' },
    { kind: 'workload', localId: 'seminar_minutes', taskRef: { localId: 'seminar' }, componentRef: null,
      quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null },
  ] } });
  const rendering = await nextCall(request);
  expect(rendering.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, rendering, { actionId: requestedActionId(rendering), actionKind: 'preview_ready', questionCode: null,
    groundingAcknowledgement: null, text: 'ゼミ資料を60分の予定案にしました。プレビューを確認して保存してください。' });

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

  // Reload: the VNext conversation resumes from its own checkpoint.
  await page.reload();
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).toContainText('ゼミ資料を60分');

  // A failed provider call changes nothing; the turn reports it and the conversation stays.
  await send(page, '英語の音読も30分');
  const failed = await nextCall(request);
  expect(failed.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, failed, null, 500);
  await expect(page.locator('.ai-planning-conversation')).toContainText('英語の音読も30分');
  await expect.poll(async () => JSON.stringify(await firestoreDocuments(request, 'schedule_events'))).not.toContain('英語の音読');

  // Rollback: the same origin without VNext is Stable V5 with its own conversation; then VNext again.
  await signIn(page, V5);
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).not.toContainText('ゼミ資料を60分');
  await signIn(page, VNEXT);
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).toContainText('ゼミ資料を60分');
});
