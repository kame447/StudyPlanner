// Near-reproduction of weekly-session-duration-ack.spec.mjs:107, specifically
// the 390px "original redundant duration" case. It sends the same utterance,
// uses the same captured V5 semantic document and renderer acknowledgement,
// and checks the same 60-minute preview, explicit single save and reload.
// The original runs a VNext harness after converting the semantic document;
// this runs the actual Stable V5 gateway at 4177 with the unconverted document.
// Provider responses and authentication are synthetic; no live AI is tested.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { unaliasedRuntimeGatewayStubBody } from '../support/weekly-planning-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const capture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/weekly-session-duration-873.json'), 'utf8'));
const origin = 'http://127.0.0.1:4177';
const proxy = `${origin}/session-ack-proxy/chat/completions`;
const semanticSchema = 'weekly_planning_semantic_document_v5';
const rendererSchema = 'weekly_planning_stable_v5_dialogue_response';
const savedEvents = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
const planWrites = page => page.evaluate(() => window.__plannerRecoveryStorageWrites
  .slice(window.__sessionAckWriteBaseline ?? 0)
  .filter(write => ['studyplanner.plans', 'studyplanner.scheduleEvents.v1'].includes(write.key)));

test('Stable V5: session duration preview requires explicit single save and survives reload', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = [];
  const blockedExternal = [];
  const errors = [];
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
  // The 4177 harness inherits the gateway alias; restore its real exports.
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', route => {
    restoredGateway = true;
    return route.fulfill({ contentType: 'application/javascript', body: unaliasedRuntimeGatewayStubBody(root) });
  });
  for (const [file, marker, added] of [
    ['lib/aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(proxy)};`],
    ['lib/firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "synthetic-session" } };'],
  ]) {
    await page.route(`**/src/${file}*`, async route => {
      const response = await route.fetch();
      const code = await response.text();
      expect(code.split(marker)).toHaveLength(2);
      return route.fulfill({ response, body: code.replace(marker, `${marker}\n${added}`) });
    });
  }
  const modelText = `${capture.replies[0].acknowledgement}候補を確認してください。`;
  await page.route(proxy, route => {
    const request = route.request().postDataJSON();
    const schema = request.response_format?.json_schema?.name;
    calls.push(schema);
    let content;
    if (schema === semanticSchema) {
      content = structuredClone(capture.semanticDocument);
    } else if (schema === rendererSchema) {
      const prompt = request.messages.filter(message => message.role === 'user').map(message => {
        try { return JSON.parse(message.content); } catch { return null; }
      }).findLast(value => value?.applicationDecision);
      const effort = prompt.currentTurnGrounding.acceptedFacts.find(fact => fact.kind === 'effort_estimate');
      expect(effort?.data).toMatchObject({ kind: 'session_duration', minutes: 60 });
      expect(prompt.applicationDecision.actionKind).toBe('preview_ready');
      content = { actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode,
        groundingAcknowledgement: { factIds: [effort.factId], text: modelText }, text: modelText };
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
  await page.evaluate(() => { window.__sessionAckWriteBaseline = window.__plannerRecoveryStorageWrites.length; });
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__weeklyPlanningApplication?.state;
    return Boolean(state && !state.pendingTurn && state.messages.at(-1)?.role === 'assistant');
  }), { timeout: 60_000 }).toBe(true);
  const state = await page.evaluate(() => globalThis.__weeklyPlanningApplication.state);
  expect(restoredGateway).toBe(true);
  expect(calls.filter(schema => schema === semanticSchema)).toHaveLength(1);
  expect(calls.filter(schema => schema === rendererSchema)).toHaveLength(1);
  const assistants = state.messages.filter(message => message.role === 'assistant');
  expect(assistants).toHaveLength(1);
  expect(assistants[0].content).toBe(modelText);
  expect(state.previewCandidates).toHaveLength(1);
  const candidate = state.previewCandidates[0];
  expect(candidate).toMatchObject({ title: '英語の勉強 60分', date: '2026-10-27',
    startTime: '09:00', endTime: '10:00', durationMinutes: 60, approvalStatus: 'unapproved',
    stableV5Metadata: { runtime: 'stable_v5' } });
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
  expect(saved[0]).toMatchObject({ title: candidate.title, date: candidate.date,
    startTime: candidate.startTime, endTime: candidate.endTime });
  expect((await planWrites(page)).filter(write => write.key === 'studyplanner.scheduleEvents.v1')).toHaveLength(1);
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
  await page.getByRole('tab', { name: '月', exact: true }).click();
  await expect(page.getByRole('grid', { name: '月間カレンダー' })).toContainText('27目標 1h', { timeout: 45_000 });
  expect(await savedEvents(page)).toEqual(saved);
  expect(await planWrites(page)).toEqual([]);
  expect(errors).toEqual([]);
  expect(blockedExternal).toEqual([]);
});
