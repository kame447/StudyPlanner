import { expect, test } from '@playwright/test';
import { answer, answerScriptedTurn, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { defineVNextProductionFlows, goToTargetPlannerWeek } from '../support/vnext-production-flows.mjs';
import { DURABLE_TURNS_PATH, expectDurableVNext, observeDurableTurns } from '../support/vnext-durable-observation.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

// Real clock: the durable Worker refuses a turn whose browser start time is not within minutes of its own, so this
// target cannot use the fixed past clock of the other emulator specs. Flows derive their dates from the browser clock.
// The VNext production smoke's flows (support/vnext-production-flows.mjs, also run by
// weekly-planning-vnext-production.live.mjs against production) on the durable emulator target: the real application
// build with durable turns on, the production Worker with its Durable Object job, the Auth and Firestore emulators,
// and the synthetic provider answering from the requests the Worker actually sends. The scripted readings are the only
// difference from production, where the real model answers; each is checked against the real VNext session in the unit
// suite's harness. The same helpers (storage contract, durable observation, day-view cleanup) therefore run in CI.
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;

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

defineVNextProductionFlows({
  test,
  signIn,
  tag: 'E2E-VNEXT-emulator',
  exerciseWeekSwitch: true,
  beforeTurn: ({ request, ...turn }) => answerScriptedTurn(request, turn),
});

// The other provider-recovery spec runs the browser-owned core. This scenario must
// send the saved failure checkpoint through the production Worker's durable parser.
test('P1 durable recovery: keeps the unsaved preview and accepts the next checkpoint after a provider outage', async ({ page, request }) => {
  const durable = observeDurableTurns(page);
  const writes = attachWriteLedger(page);
  await signIn(page);
  await page.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
  // Keep the real clock aligned with the Worker's request deadline. The existing
  // week helper ensures capacity remains even when CI runs late on Sunday.
  const target = await goToTargetPlannerWeek(page);
  const rawCheckpoint = () => page.evaluate(week => {
    const keys = Object.keys(localStorage);
    const index = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.') && !key.endsWith('.anonymous'));
    const chatId = index ? JSON.parse(localStorage.getItem(index)).activeChatId : null;
    const cores = chatId ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.')
      && key.endsWith(`.${week}.${chatId}.core`)) : [];
    if (cores.length !== 1) throw new Error(`Expected one active checkpoint for ${week}, found ${cores.length}`);
    return localStorage.getItem(cores[0]);
  }, target.weekStart);
  const bubbles = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  const baseline = await bubbles.count();
  const composer = page.locator('.ai-planning-composer textarea');
  const send = async text => {
    await composer.fill(text);
    await page.getByRole('button', { name: '送信', exact: true }).click();
  };

  await send('数学を60分、この条件で予定を作ってください。');
  const initial = await nextCall(request);
  expect(initial.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, initial, { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: {
    patch: [], remove: [], relate: [], defer: [], add: [
      { kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'math-minutes', taskRef: { localId: 'math' }, componentRef: null,
        quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ],
  } });
  const initialRenderer = await nextCall(request);
  expect(initialRenderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, initialRenderer, rendererReply(initialRenderer));
  await expect(bubbles).toHaveCount(baseline + 1);
  await expect(composer).toBeEnabled();
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  const before = JSON.parse(await rawCheckpoint()).vnext;
  expect(before.preview).not.toBeNull();

  await send('数学を90分に変更してください。');
  const failed = await nextCall(request);
  expect(failed.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, failed, null, 500);
  await expect(bubbles).toHaveCount(baseline + 2);
  await expect(bubbles.last()).toContainText('今回の内容は計画に反映していません。');
  await expect(bubbles.last()).not.toContainText('保存しました');
  await expect(composer).toBeEnabled();
  const failedRaw = await rawCheckpoint();
  const retained = JSON.parse(failedRaw).vnext;
  expect(retained.state.graph).toEqual(before.state.graph);
  expect(retained.preview).toEqual(before.preview);
  expect(retained.failureRecovery).toEqual({ reason: 'provider_error', consecutiveCount: 1 });

  const nextText = '英語も30分あります。';
  const submitted = page.waitForRequest(sent => sent.method() === 'POST'
    && new URL(sent.url()).pathname.endsWith(DURABLE_TURNS_PATH)
    && sent.postDataJSON()?.payload?.input?.userText === nextText);
  await send(nextText);
  // The real durable endpoint receives the exact extended checkpoint, rather
  // than a sanitized copy or a test double calling the parser independently.
  expect((await submitted).postDataJSON().payload.checkpoint).toBe(failedRaw);
  const resumed = await nextCall(request);
  expect(resumed.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, resumed, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
    patch: [], remove: [], relate: [], defer: [], add: [
      { kind: 'task', localId: 'english', category: 'study', title: '英語' },
      { kind: 'workload', localId: 'english-minutes', taskRef: { localId: 'english' }, componentRef: null,
        quantityRole: 'target', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ],
  } });
  const resumedRenderer = await nextCall(request);
  expect(resumedRenderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, resumedRenderer, rendererReply(resumedRenderer));
  await expect(bubbles).toHaveCount(baseline + 3);
  await expect(composer).toBeEnabled();
  const after = JSON.parse(await rawCheckpoint()).vnext;
  expect(after.state.graph.tasks.map(task => task.title)).toEqual(['数学', '英語']);
  expect(after.state.graph.workloads.map(work => work.amount)).toEqual([60, 30]);
  expect(after.failureRecovery).toBeUndefined();
  await expectDurableVNext(durable, { turns: 3 });
  expect(protectedWritesIn(writes.writes())).toEqual([]);
});
