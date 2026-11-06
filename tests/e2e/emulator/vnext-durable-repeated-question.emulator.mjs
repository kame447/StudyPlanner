import { expect, test } from '@playwright/test';
import { answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

// Exact requiredLabels from weeklyPlanningVNextDialogue.ts:113-115 at ccd7944e.
const labels = ['何分くらい', '所要時間はまだ分からないので、仮置きで予定を組んで見せて', '後で決める'];
const provisionalChoice = labels[1];
const firestore = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const emptyDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const nativeSchema = 'weekly_planning_vnext_native_v1';
const rendererSchema = 'weekly_planning_stable_v5_dialogue_response';
const focusedSchema = 'weekly_planning_focused_contextual_answer_v5';
const fallback = { decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null };
const endings = ['', ' お知らせください。', ' 一緒に確認しましょう。', ' ご検討ください。', ' ご確認ください。'];

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(nav.or(signInTab).first()).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
    await page.getByLabel('メールアドレス').fill(test.info().project.metadata.email);
    await page.getByLabel('パスワード', { exact: true }).fill(process.env.STUDYPLANNER_LIVE_PASSWORD);
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(nav).toBeVisible();
}

async function send(page, text) {
  await page.locator('.ai-planning-composer textarea').fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
}

async function checkpoint(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => !key.includes('.anonymous'));
    const index = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
    const chatId = index ? JSON.parse(localStorage.getItem(index)).activeChatId : null;
    const core = chatId ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(`.${chatId}.core`)) : [];
    if (core.length > 1) throw new Error(`Ambiguous active checkpoints: ${core.length}`);
    return core.length ? JSON.parse(localStorage.getItem(core[0])) : null;
  });
}

async function documents(request, collection) {
  const response = await request.get(`${firestore}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), `read ${collection} from emulator`).toBe(true);
  return (await response.json()).documents ?? [];
}

// The focused question interpreter may first abstain. Let the real VNext native
// interpreter read the entire utterance; only model answers are scripted.
async function nativeReading(request) {
  let call = await nextCall(request);
  if (call.schema === focusedSchema) {
    await answer(request, call, fallback);
    call = await nextCall(request);
  }
  expect(call.schema).toBe(nativeSchema);
  return call;
}

async function renderTurn(page, request, index, expectedCount) {
  const render = await nextCall(request);
  expect(render.schema).toBe(rendererSchema);
  const prompt = render.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.applicationDecision);
  expect(prompt).toBeTruthy();
  const reply = rendererReply(render);
  reply.text += endings[index];
  await answer(request, render, reply);
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  await expect(assistant).toHaveCount(expectedCount);
  await expect(assistant.last()).toHaveText(reply.text);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  return { decision: prompt.applicationDecision, text: reply.text };
}

// Real clock and same-commit Pages/Worker. Every model response is synthetic;
// the browser, durable job, semantic validation, scheduler and UI are real.
test('three unanswered effort questions offer a provisional plan that stays unsaved', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const posts = [];
  page.on('request', outgoing => {
    if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === '/weekly-planning/turns') posts.push(outgoing);
  });
  await openAiPlanning(page);
  await goToTargetPlannerWeek(page);
  const beforePlans = await documents(request, 'schedule_events');
  const beforeActuals = await documents(request, 'actuals');
  const beforeApprovals = await documents(request, 'weekly_planning_approval_operations');
  const initialAssistantCount = await page.locator('.ai-planning-message-row.assistant .ai-planning-bubble').count();

  await send(page, 'ゼミ資料は20枚で12枚できた');
  const initial = await nativeReading(request);
  await answer(request, initial, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
    ...emptyDelta, add: [
      { kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' },
      { kind: 'workload', localId: 'total', taskRef: { localId: 'slides' }, componentRef: null,
        quantityRole: 'scope_total', amount: 20, unitCode: 'page', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
      { kind: 'workload', localId: 'done', taskRef: { localId: 'slides' }, componentRef: null,
        quantityRole: 'completed', amount: 12, unitCode: 'page', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ],
  } });
  const asked = await renderTurn(page, request, 0, initialAssistantCount + 1);
  expect(asked.decision.questionCode).toBe('missing_effort_estimate');
  await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(2);
  const first = await checkpoint(page);
  expect(first.ownerId).toBe(owner);
  expect(first.vnext.presentedQuestion).not.toBeNull();
  expect(first.vnext.preview).toBeNull();
  expect(first.vnext.state.graph.workloads.map(item => [item.quantityRole, item.amount]))
    .toEqual(expect.arrayContaining([['scope_total', 20], ['completed', 12]]));

  let third;
  for (const [index, text] of ['全部', 'ない', 'そういうこと'].entries()) {
    await send(page, text);
    const reading = await nativeReading(request);
    const context = reading.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
      .find(value => value?.openQuestions);
    expect(context?.presentedQuestion?.key).toBeTruthy();
    expect(context.openQuestions.some(question => question.key === context.presentedQuestion.key && question.code === 'missing_effort_estimate')).toBe(true);
    await answer(request, reading, { planningIntent: 'unknown', conversationActs: [], answer: null, delta: emptyDelta });
    const shown = await renderTurn(page, request, index + 1, initialAssistantCount + index + 2);
    expect(shown.decision.questionCode).toBe('missing_effort_estimate');
    if (index === 2) third = shown;
  }

  // Inspect the actual displayed bubble first; the old version must fail here.
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  await expect(assistant.last()).toContainText(provisionalChoice);
  expect(third.decision.communication.goal).toBe('explain_question');
  expect(third.decision.relevantLabels).toEqual(expect.arrayContaining(labels));
  for (const label of labels) expect(third.text).toContain(label);
  const afterThird = await checkpoint(page);
  expect(afterThird.vnext.unansweredQuestionStreak).toMatchObject({ questionKey: first.vnext.presentedQuestion.questionKey, count: 3 });
  expect(afterThird.vnext.state.graph).toEqual(first.vnext.state.graph);

  await send(page, provisionalChoice);
  const chosen = await nativeReading(request);
  const context = chosen.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.openQuestions);
  expect(context.userText).toBe(provisionalChoice);
  const question = context.openQuestions.find(item => item.key === context.presentedQuestion?.key);
  expect(question?.code).toBe('missing_effort_estimate');
  await answer(request, chosen, { planningIntent: 'unknown', conversationActs: [], answer: null,
    delta: { ...emptyDelta, defer: [{ questionKey: question.key, allocation: 'provisional_timebox' }] } });
  await renderTurn(page, request, 4, initialAssistantCount + 5);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  const final = await checkpoint(page);
  expect(final.vnext.state.deferrals).toContainEqual(expect.objectContaining({
    questionKey: first.vnext.presentedQuestion.questionKey, allocation: 'provisional_timebox',
  }));
  expect(final.vnext.state.graph.tasks).toEqual(first.vnext.state.graph.tasks);
  expect(final.vnext.state.graph.workloads).toEqual(first.vnext.state.graph.workloads);
  expect(final.vnext.preview).not.toBeNull();
  expect(final.vnext.unansweredQuestionStreak).toBeUndefined();
  expect(posts).toHaveLength(5);
  expect(protectedWritesIn(writes.writes())).toEqual([]);
  expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
  expect(await documents(request, 'actuals')).toEqual(beforeActuals);
  expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);
});
