import { expect, test } from '../support/fixed-clock.mjs';
import { SYNTHETIC, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { expectTurnPersisted, previewDialog, promoteThenSave, readVNextChatStorage } from '../support/vnext-chat-storage.mjs';
import { emulatorUserId, notSavedYet, placement, savedAtLeastOnce, savedExactlyOnce, savedFor, unchangedSince } from '../support/schedule-event-ledger.mjs';

// Runs on the shared fixed clock (Asia/Tokyo, E2E_FIXED_NOW): the preview needs capacity left in the week, so a
// live clock late on Sunday makes turn 2 correctly answer insufficient_capacity and never call the renderer.
// The connected VNext path (#926) on the isolated target (#947): the real planning UI, whose only production
// conversation core is VNext, talks to the local Worker, which authenticates against the
// Auth emulator, records trace in the Firestore emulator and forwards AI calls to the synthetic provider.
// The test answers each forwarded call from the request the Worker actually sent (real network path,
// scripted model output: real-model quality is the real-API workflow's job). The preview is approved
// through V5's approval, saved to Firestore, reloaded and survives a failed turn.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const PLANNING = '/';
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

function outcomesIn(value) {
  return value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, item]) =>
      (key === 'outcome' && typeof item?.stringValue === 'string' ? [item.stringValue] : outcomesIn(item)))
    : [];
}

async function traceOutcomes(request) {
  return outcomesIn(await firestoreDocuments(request, 'weekly_planning_trace_entries')).sort();
}

/** Other projects' specs trace into the same emulator; keep only what this test's turns added. */
function withoutBaseline(outcomes, baseline) {
  const remaining = [...baseline];
  return outcomes.filter((outcome) => {
    const index = remaining.indexOf(outcome);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

async function firestoreDocuments(request, collection) {
  const response = await request.get(`${FIRESTORE}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), collection).toBe(true);
  return (await response.json()).documents ?? [];
}

test('VNext core: UI → Worker → Auth/Firestore/trace → preview → approval → save → reload → failure', async ({ page, request }) => {
  const traceBaseline = await traceOutcomes(request);
  // Saved events are judged for this account and this target only (the emulator holds other specs' events).
  const study = { userId: await emulatorUserId(request, { email: email(), password: password() }), title: 'ゼミ資料' };
  const events = () => firestoreDocuments(request, 'schedule_events');
  const holds = (problems) => expect(problems).toEqual([]);
  await signIn(page, PLANNING);
  await openPlanning(page);

  // Turn 1: facts alone. The user's text reaches the VNext interpreter through the Worker; it reads no
  // request to create a plan, so, as in Stable V5, the facts are kept but no preview is made (#926 A).
  const turn1Before = await readVNextChatStorage(page, 'ゼミ資料を60分');
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
  // A consultation-style turn (no plan made) still persists its messages and the VNext checkpoint.
  await expect.poll(async () => (await readVNextChatStorage(page, 'ゼミ資料を60分')).userTextPersisted).toBe(true);
  const turn1After = await readVNextChatStorage(page, 'ゼミ資料を60分');
  expectTurnPersisted(turn1Before, turn1After);
  expect(turn1After.stableV5Keys).toBe(turn1Before.stableV5Keys);

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
  const preview = previewDialog(page);
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-draft-block')).toHaveCount(1);
  // Shown, not yet approved: nothing of it is saved.
  holds(notSavedYet(await events(), study));
  await promoteThenSave(preview);
  await expect(preview).toBeHidden();

  // Saved in Firestore by the existing plan repository (schedule_events), and traced through the Worker.
  await expect.poll(async () => savedAtLeastOnce(await events(), study)).toEqual([]);
  const savedStudy = placement(savedFor(await events(), study));
  await expect.poll(async () => (await firestoreDocuments(request, 'weekly_planning_trace_sessions')).length).toBeGreaterThan(0);

  // Reload: the VNext conversation resumes from its own checkpoint, and the plan was saved exactly once.
  const messagesBeforeReload = (await readVNextChatStorage(page)).messages;
  await page.reload();
  await openPlanning(page);
  await expect(page.locator('.ai-planning-conversation')).toContainText('ゼミ資料を60分');
  // The reload restores exactly what the turns persisted.
  expect((await readVNextChatStorage(page, 'ゼミ資料を60分')).messages).toBe(messagesBeforeReload);
  holds(savedExactlyOnce(await events(), study));
  holds(unchangedSince(savedStudy, await events(), study));

  // A failed provider call: current-contract-v5 "Bounded structured-failure recovery" allows no new dispatch after a
  // provider failure, so the turn ends with VNext's fixed notice, applies nothing and saves nothing, and the provider
  // receives no further request (no recovery renderer call).
  await send(page, '英語の音読も30分');
  const failed = await nextCall(request);
  expect(failed.schema).toBe('weekly_planning_vnext_native_v1');
  const providerRequests = async () => (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;
  const requestsAtFailure = await providerRequests(); // includes the failed reading itself
  await answer(request, failed, null, 500);
  await expect(page.locator('.ai-planning-conversation'))
    .toContainText('うまく反映できませんでした。もう一度、言い方を変えて教えてください。');
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  expect(JSON.stringify(await firestoreDocuments(request, 'schedule_events'))).not.toContain('英語の音読');
  holds(unchangedSince(savedStudy, await events(), study));

  // Trace (through the Worker into Firestore) records each turn's own result: facts without a request to
  // plan as V5's needs_scope, the previewed turn as preview_ready, the failed one as failed, never idle.
  await expect.poll(async () => withoutBaseline(await traceOutcomes(request), traceBaseline))
    .toEqual(['failed', 'needs_scope', 'preview_ready']);
  // The failed turn is complete (its trace is written at its end) and the provider saw nothing after the failed reading.
  expect(await providerRequests()).toBe(requestsAtFailure);
});
