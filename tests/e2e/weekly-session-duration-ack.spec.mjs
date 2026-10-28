import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Synthetic UI harness: stub only provider transport/authentication, and run the
// real semantic validator, scheduler, renderer, approval and local persistence.
// Ported from PR #875; successful dialogue comes entirely from the model stub.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const capture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/weekly-session-duration-873.json'), 'utf8'));
const ORIGIN = 'http://127.0.0.1:4174';
const PROXY = `${ORIGIN}/session-ack-proxy/chat/completions`;
const SEMANTIC_SCHEMA = 'weekly_planning_semantic_document_v5';
const RENDERER_SCHEMA = 'weekly_planning_stable_v5_dialogue_response';
const RECOVERY_SCHEMA = 'weekly_planning_recovery_verdict';
const RECOVERY_TEXT = '今回の内容は計画へ反映していません。1回の長さをもう一度教えてください。';
const savedEvents = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
// Count only durable writes after the planner finished loading: boot hydration is not a turn side effect.
const planWrites = page => page.evaluate(() => window.__plannerRecoveryStorageWrites
  .slice(window.__sessionAckWriteBaseline ?? 0)
  .filter(write => ['studyplanner.plans', 'studyplanner.scheduleEvents.v1'].includes(write.key)));

async function boot(page, mode) {
  const calls = [];
  let recoveryActionId = null;
  const reading = structuredClone(capture.semanticDocument);
  const reply = capture.replies.find(item => item.name === mode);
  reading.tasks[0].effortEstimates[0].precision = reply?.precision ?? 'exact';
  if (mode === 'invalid typed duration') reading.tasks[0].effortEstimates[0].minutes = 0;
  const modelText = mode === 'misleading duration' ? '英語の勉強は明日90分ですね。候補を確認してください。'
    : mode === 'false save claim' ? '保存しました。'
      : `${reply?.acknowledgement ?? capture.replies[0].acknowledgement}候補を確認してください。`;
  await page.clock.setFixedTime(new Date('2026-10-26T07:59:00.000Z'));
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', route => new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export { weeklyPlanningTurnRuntimeGateway } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway.ts`)};`,
  }));
  const seams = [
    ['lib/aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(PROXY)};`],
    ['lib/firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "synthetic-session" } };'],
    ['features/weeklyPlanning/useWeeklyPlanningState.ts', 'const getPlanningState = useCallback(() => planningStateRef.current, []);', 'globalThis.__sessionAckState = getPlanningState;'],
  ];
  for (const [file, marker, added] of seams) await page.route(`**/src/${file}*`, async route => {
    const response = await route.fetch();
    const code = await response.text();
    expect(code.split(marker)).toHaveLength(2);
    await route.fulfill({ response, body: code.replace(marker, `${marker}\n${added}`) });
  });
  await page.route(PROXY, async route => {
    const request = route.request().postDataJSON();
    const schema = request.response_format?.json_schema?.name;
    calls.push(schema);
    let content;
    if (schema === SEMANTIC_SCHEMA) content = JSON.stringify(reading);
    else if (schema === RENDERER_SCHEMA) {
      const prompt = request.messages.filter(message => message.role === 'user').map(message => {
        try { return JSON.parse(message.content); } catch { return null; }
      }).findLast(value => value?.applicationDecision);
      if (mode === 'invalid typed duration') {
        // The full app reports the rejected turn through its recovery status, with no accepted facts.
        expect(prompt.applicationDecision).toMatchObject({ actionKind: 'status', previewCount: 0,
          recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true } });
        expect(prompt.currentTurnGrounding?.acceptedFacts ?? []).toEqual([]);
        recoveryActionId = prompt.actionId;
        content = JSON.stringify({ actionId: prompt.actionId, actionKind: 'status', questionCode: null,
          groundingAcknowledgement: null, text: RECOVERY_TEXT });
        await route.fulfill({ json: { content }, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
        return;
      }
      const effort = prompt.currentTurnGrounding.acceptedFacts.find(fact => fact.kind === 'effort_estimate');
      expect(effort?.data).toMatchObject({ kind: 'session_duration', minutes: 60 });
      expect(prompt.applicationDecision.actionKind).toBe('preview_ready');
      content = mode === 'invalid renderer JSON' ? '{invalid' : JSON.stringify({
        actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode,
        groundingAcknowledgement: { factIds: [effort.factId], text: modelText }, text: modelText,
      });
    } else if (schema === RECOVERY_SCHEMA && mode === 'invalid typed duration') {
      const prompt = JSON.parse(request.messages.at(-1).content);
      // The verifier must judge the recovery reply generated for this action, not an arbitrary text.
      expect(prompt).toMatchObject({ actionId: recoveryActionId, question: null, text: RECOVERY_TEXT,
        recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true } });
      content = JSON.stringify({ actionId: prompt.actionId, questionMatches: 'yes', planningDetailsNotApplied: 'yes',
        acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' });
    } else throw new Error(`Unexpected provider schema: ${schema}`);
    await route.fulfill({ json: { content }, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
  });
  await page.goto(`${ORIGIN}/full-planner-recovery.html`);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled({ timeout: 45_000 });
  await page.locator('.ai-planning-composer textarea').fill(capture.userText);
  await page.evaluate(() => { window.__sessionAckWriteBaseline = window.__plannerRecoveryStorageWrites.length; });
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__sessionAckState?.();
    return Boolean(state && !state.pendingTurn && state.messages.at(-1)?.role === 'assistant');
  }), { timeout: 60_000 }).toBe(true);
  return { state: await page.evaluate(() => globalThis.__sessionAckState()), calls, modelText };
}

for (const width of [390, 1280]) test.describe(`Issue #873 session duration UI harness at ${width}px`, () => {
  test.use({ timezoneId: 'Asia/Tokyo', viewport: { width, height: 844 } });

  for (const mode of [...capture.replies.map(reply => reply.name), 'misleading duration', 'false save claim', 'invalid renderer JSON']) {
    test(`${mode}: preview → explicit approval → exactly one local save → reload`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const { state, calls, modelText } = await boot(page, mode);
      const fallback = ['false save claim', 'invalid renderer JSON'].includes(mode);
      const assistants = state.messages.filter(message => message.role === 'assistant');
      expect(assistants).toHaveLength(1);
      if (fallback) {
        expect(assistants[0].content).toContain('まだ保存していません');
        expect(assistants[0].content).not.toBe(modelText);
      } else expect(assistants[0].content).toBe(modelText);
      expect(calls.filter(schema => schema === SEMANTIC_SCHEMA)).toHaveLength(1);
      expect(calls.filter(schema => schema === RENDERER_SCHEMA)).toHaveLength(1);
      expect(state.previewCandidates).toHaveLength(1);
      const candidate = state.previewCandidates[0];
      expect(candidate).toMatchObject({ title: '英語の勉強 60分', date: '2026-10-27',
        startTime: '09:00', endTime: '10:00', durationMinutes: 60, approvalStatus: 'unapproved' });
      expect(state.draftBlocks).toEqual([]);
      expect(state.pendingApproval).toBeUndefined();
      expect(await savedEvents(page)).toEqual([]);
      expect(await planWrites(page)).toEqual([]);
      await page.getByRole('button', { name: '計画プレビューを確認' }).click();
      const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('英語の勉強');
      await expect(dialog).toContainText('09:00');
      await expect(dialog).toContainText('10:00');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
      expect(await savedEvents(page)).toEqual([]);
      expect(await planWrites(page)).toEqual([]);
      await dialog.getByRole('button', { name: 'この内容で保存' }).click();
      await expect.poll(async () => (await savedEvents(page)).length).toBe(1);
      const saved = await savedEvents(page);
      expect(saved[0]).toMatchObject({ title: candidate.title, date: candidate.date, startTime: candidate.startTime, endTime: candidate.endTime });
      expect((await planWrites(page)).filter(write => write.key === 'studyplanner.scheduleEvents.v1')).toHaveLength(1);
      await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
      await page.reload();
      // The preserved storage bytes exist before the app restores; wait for the restored planner to render the save.
      await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
      await page.getByRole('tab', { name: '月', exact: true }).click();
      // Month cells summarize planned time: the restored 60-minute save is the only non-zero target.
      await expect(page.getByRole('grid', { name: '月間カレンダー' })).toContainText('27目標 1h', { timeout: 45_000 });
      expect(await savedEvents(page)).toEqual(saved);
      expect(await planWrites(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('invalid typed duration is rejected before preview, approval or save', async ({ page }) => {
    const { state, calls } = await boot(page, 'invalid typed duration');
    expect(calls.filter(schema => schema === SEMANTIC_SCHEMA)).toHaveLength(2);
    // The only renderer call is the recovery status checked in the provider stub, verified exactly once.
    expect(calls.filter(schema => schema === RENDERER_SCHEMA)).toHaveLength(1);
    expect(calls.filter(schema => schema === RECOVERY_SCHEMA)).toHaveLength(1);
    expect(state.messages.at(-1)).toMatchObject({ role: 'assistant', content: RECOVERY_TEXT });
    expect(state.previewCandidates ?? []).toEqual([]);
    expect(state.draftBlocks).toEqual([]);
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
    expect(await savedEvents(page)).toEqual([]);
    expect(await planWrites(page)).toEqual([]);
  });
});
