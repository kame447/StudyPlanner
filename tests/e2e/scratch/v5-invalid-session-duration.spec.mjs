// Near-reproduction of weekly-session-duration-ack.spec.mjs:156 at 390px.
// Both cases use the same utterance and inject the same semantic document with
// session_duration.minutes = 0 on the initial reading and one repair. The
// original converts that document for VNext at 4174; this sends V5 format to
// the real Stable V5 gateway at 4177. Both require rejection before any
// preview, draft, approval or save. Provider/auth responses are synthetic;
// this does not test the real model's interpretation of the utterance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { unaliasedRuntimeGatewayStubBody } from '../support/weekly-planning-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const capture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/weekly-session-duration-873.json'), 'utf8'));
const origin = 'http://127.0.0.1:4177';
const proxy = `${origin}/invalid-duration-proxy/chat/completions`;
const semanticSchema = 'weekly_planning_semantic_document_v5';
const rendererSchema = 'weekly_planning_stable_v5_dialogue_response';
const recoverySchema = 'weekly_planning_recovery_verdict';
const recoveryText = '今回の内容は計画へ反映していません。1回の長さをもう一度教えてください。';

test('Stable V5 rejects invalid typed duration before preview or save', async ({ page }) => {
  test.setTimeout(120_000);
  const invalid = structuredClone(capture.semanticDocument);
  invalid.tasks[0].effortEstimates[0].minutes = 0;
  const calls = [];
  const errors = [];
  const blockedExternal = [];
  let restoredGateway = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-26T07:59:00.000Z'));
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blockedExternal.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', route => {
    restoredGateway = true;
    return route.fulfill({ contentType: 'application/javascript', body: unaliasedRuntimeGatewayStubBody(root) });
  });
  for (const [file, marker, added] of [
    ['lib/aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(proxy)};`],
    ['lib/firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "synthetic-session" } };'],
    ['features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace.ts', 'function recordWeeklyPlanningStableV5DebugTrace(params) {', '(globalThis.__invalidDurationTrace ??= []).push(structuredClone(params));'],
  ]) {
    await page.route(`**/src/${file}*`, async route => {
      const response = await route.fetch();
      const code = await response.text();
      expect(code.split(marker)).toHaveLength(2);
      return route.fulfill({ response, body: code.replace(marker, `${marker}\n${added}`) });
    });
  }
  await page.route(proxy, route => {
    const request = route.request().postDataJSON();
    const schema = request.response_format?.json_schema?.name;
    calls.push(schema);
    let content;
    if (schema === semanticSchema) {
      content = invalid;
    } else if (schema === rendererSchema) {
      const prompt = request.messages.filter(message => message.role === 'user').map(message => {
        try { return JSON.parse(message.content); } catch { return null; }
      }).findLast(value => value?.applicationDecision);
      expect(prompt.applicationDecision).toMatchObject({ actionKind: 'status', previewCount: 0,
        recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true } });
      expect(prompt.currentTurnGrounding?.acceptedFacts ?? []).toEqual([]);
      content = { actionId: prompt.actionId, actionKind: 'status', questionCode: null,
        groundingAcknowledgement: null, text: recoveryText };
    } else if (schema === recoverySchema) {
      const prompt = JSON.parse(request.messages.at(-1).content);
      expect(prompt).toMatchObject({ question: null, text: recoveryText,
        recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true } });
      content = { actionId: prompt.actionId, questionMatches: 'yes', planningDetailsNotApplied: 'yes',
        acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' };
    } else {
      throw new Error(`Unexpected provider schema: ${schema}`);
    }
    return route.fulfill({ json: { content: JSON.stringify(content) }, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
  });

  await page.goto(`${origin}/full-planner-recovery.html`);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  const composer = page.locator('.ai-planning-composer textarea');
  await expect(composer).toBeEnabled({ timeout: 45_000 });
  await composer.fill(capture.userText);
  await page.evaluate(() => { window.__invalidDurationWriteBaseline = window.__plannerRecoveryStorageWrites.length; });
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__weeklyPlanningApplication?.state;
    return Boolean(state && !state.pendingTurn && state.messages.at(-1)?.role === 'assistant');
  }), { timeout: 60_000 }).toBe(true);
  const { state, validations, savedEvents, plans, writes } = await page.evaluate(() => ({
    state: globalThis.__weeklyPlanningApplication.state,
    validations: (globalThis.__invalidDurationTrace ?? []).filter(event => event.stage === 'semantic_validation_result'),
    savedEvents: JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'),
    plans: JSON.parse(localStorage.getItem('studyplanner.plans') ?? '[]'),
    writes: window.__plannerRecoveryStorageWrites.slice(window.__invalidDurationWriteBaseline ?? 0)
      .filter(write => ['studyplanner.plans', 'studyplanner.scheduleEvents.v1'].includes(write.key)),
  }));
  expect(restoredGateway).toBe(true);
  expect(calls.filter(schema => schema === semanticSchema)).toHaveLength(2);
  expect(validations.map(event => ({ attempt: event.data.attempt, accepted: event.data.accepted }))).toEqual(
    expect.arrayContaining([{ attempt: 'initial', accepted: false }, { attempt: 'repair', accepted: false }]),
  );
  expect(state.previewCandidates ?? []).toEqual([]);
  expect(state.draftBlocks).toEqual([]);
  expect(state.pendingApproval).toBeUndefined();
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
  expect(savedEvents).toEqual([]);
  expect(plans).toEqual([]);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(blockedExternal).toEqual([]);
});
