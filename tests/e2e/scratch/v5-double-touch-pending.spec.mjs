// Near-reproduction of weekly-preview-approval.spec.mjs:143, not the same test:
// that test sends a fixture prompt and receives a prebuilt candidate from a
// stubbed turn gateway. Here SETUP and AUTHORIZATION are separate utterances;
// the real Stable V5 runtime creates the candidate from mocked provider output.
// Both test the same boundary: two taps at the promotion position make one
// draft, advance its revision once, and leave explicit approval/save pending.
// This is an API-free local harness, not a test of real model interpretation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../support/fixed-clock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const origin = 'http://127.0.0.1:4177';
const proxy = `${origin}/mock-jev-proxy/chat/completions`;
const setup = '8月20日から26日で数学20問を1問2分。まず条件だけ確認してください。';
const authorization = 'この条件で未保存の計画案を作ってください。';
const savedKey = 'studyplanner.scheduleEvents.v1';

function initialConditions() {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-20/2026-08-26',
      start: '2026-08-20', end: '2026-08-26', sourceText: '8月20日から26日' },
    tasks: [{ localId: 'task', category: 'study', title: '数学',
      study: { purpose: 'self_study', contextLabel: '数学', components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 20, unitCode: 'problem',
        unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false,
        periodExpression: null, sourceText: '数学20問' }],
      effortEstimates: [{ localId: 'effort', targetLocalId: 'work', kind: 'duration_per_unit',
        minutes: 2, unitCode: 'problem', precision: 'exact', sourceText: '1問2分' }],
      temporalConstraints: [], recurrence: [], sourceText: '数学20問を1問2分' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function structuredUserPrompt(body, field) {
  for (const message of body.messages ?? []) {
    if (message.role !== 'user') continue;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && Object.hasOwn(parsed, field)) return parsed;
    } catch { /* Other user messages may be plain text. */ }
  }
  throw new Error(`Missing structured fixture prompt: ${field}`);
}

function rendererReply(prompt) {
  const decision = prompt.applicationDecision;
  const facts = prompt.currentTurnGrounding.acceptedFacts.filter(fact => fact.kind === 'effort_estimate');
  const acknowledgement = facts.map(fact => {
    const data = fact.data;
    const measurement = data.kind === 'total_duration' ? '全部で' : `1${data.kind === 'session_duration' ? '回' : data.unitLabel}`;
    return `${data.targetLabels.join('の')}は${measurement}${data.minutes}分${data.precision === 'approximate' ? 'くらい' : ''}で見積もります。`;
  }).join('');
  let text = `内容を確認してください。${decision.previewPromotionControlLabel ?? ''}`;
  if (decision.questionCode === 'missing_effort_estimate') {
    text = `数学20問は${decision.questionIntent?.measurement === 'duration_per_unit' ? '1問あたり' : '全部で'}何分かかりますか？`;
  }
  return { actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
    groundingAcknowledgement: facts.length ? { factIds: facts.map(fact => fact.factId), text: acknowledgement } : null,
    text: acknowledgement + text };
}

async function installRealV5WithMockProvider(page) {
  const audit = { blockedExternal: [], schemas: [], gatewayRestored: false };
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      audit.blockedExternal.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  // The stable harness inherits the UI stub alias. Replace that response with
  // the real gateway exports, as the existing JEV authority test does.
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', route => {
    audit.gatewayRestored = true;
    return route.fulfill({ contentType: 'application/javascript', body:
      `export { weeklyPlanningTurnRuntimeGateway } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway.ts`)};\n`
      + `export { createWeeklyPlanningVNextRuntimeGateway, readWeeklyPlanningVNextDurableReceipt } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeGateway.ts`)};` });
  });
  for (const [file, marker, injected] of [
    ['aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(proxy)};`],
    ['firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "local-fixture-session" } };'],
  ]) {
    await page.route(`**/src/lib/${file}*`, async route => {
      const response = await route.fetch();
      const code = await response.text();
      expect(code.split(marker)).toHaveLength(2);
      return route.fulfill({ response, body: code.replace(marker, `${marker}\n${injected}`) });
    });
  }
  await page.route(proxy, route => {
    const body = route.request().postDataJSON();
    const schema = body.response_format?.json_schema?.name;
    audit.schemas.push(schema);
    expect(body).not.toHaveProperty('model');
    let content;
    if (schema === 'weekly_planning_focused_authorization_v5') {
      expect(body.decisionContext).toMatchObject({ purpose: 'focused_authorization', previousStatus: 'needs_scope',
        hasTasks: true, hasPendingQuestion: false });
      content = { decision: 'create_plan' };
    } else if (schema === 'weekly_planning_semantic_document_v5') {
      expect(body).not.toHaveProperty('decisionContext');
      expect(structuredUserPrompt(body, 'userText').userText).toBe(setup);
      content = initialConditions();
    } else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      content = rendererReply(structuredUserPrompt(body, 'applicationDecision'));
    } else {
      throw new Error(`Unexpected mock proxy schema: ${schema}`);
    }
    const focused = schema === 'weekly_planning_focused_authorization_v5';
    return route.fulfill({ json: { content: JSON.stringify(content),
      ...(focused ? { decisionContext: { requestId: body.decisionContext.requestId, inputRevision: body.decisionContext.inputRevision } } : {}) },
    headers: { 'X-StudyPlanner-AI-Provider': focused ? 'openrouter' : 'openai' } });
  });
  return audit;
}

async function submit(page, audit, text) {
  const count = audit.schemas.length;
  const composer = page.locator('.ai-planning-composer textarea');
  await composer.fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => audit.schemas.length).toBeGreaterThan(count);
  await expect(page.getByRole('button', { name: '処理をキャンセル', exact: true })).toHaveCount(0);
  await expect(composer).toBeEnabled();
}

test('V5 double touch pending', async ({ page, isMobile, hasTouch }) => {
  test.setTimeout(90_000);
  expect(isMobile).toBe(true);
  expect(hasTouch).toBe(true);
  const audit = await installRealV5WithMockProvider(page);
  await page.goto(`${origin}/full-planner-recovery.html`);
  const nav = page.getByRole('navigation', { name: '主要ナビゲーション' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled({ timeout: 30_000 });

  await submit(page, audit, setup);
  const previewButton = page.getByRole('button', { name: '計画プレビューを確認' });
  await expect(previewButton).toHaveCount(0);
  await submit(page, audit, authorization);
  expect(audit.gatewayRestored).toBe(true);
  expect(audit.schemas).toContain('weekly_planning_semantic_document_v5');
  expect(audit.schemas).toContain('weekly_planning_focused_authorization_v5');
  await previewButton.click();
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog.locator('.ai-planning-draft-block')).toHaveCount(1);
  await expect(dialog).toContainText('数学');

  const before = await page.evaluate(key => ({
    state: structuredClone(window.__weeklyPlanningApplication.state),
    saved: localStorage.getItem(key),
    writes: window.__plannerRecoveryStorageWrites.filter(write => write.key === key).length,
  }), savedKey);
  expect(before.state.previewCandidates).toHaveLength(1);
  expect(before.state.draftBlocks).toEqual([]);
  expect(JSON.parse(before.saved ?? '[]')).toEqual([]);
  const promote = dialog.getByRole('button', { name: 'この内容で仮予定にする' });
  await promote.scrollIntoViewIfNeeded();
  const box = await promote.boundingBox();
  if (!box) throw new Error('Promotion control is not measurable');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);

  await expect.poll(() => page.evaluate(() => window.__weeklyPlanningApplication.state.draftBlocks.length)).toBe(1);
  await expect(dialog.getByRole('button', { name: 'この内容で保存', exact: true })).toBeVisible();
  const after = await page.evaluate(key => ({
    state: structuredClone(window.__weeklyPlanningApplication.state),
    saved: localStorage.getItem(key),
    writes: window.__plannerRecoveryStorageWrites.filter(write => write.key === key).length,
  }), savedKey);
  expect(after.state.draftBlocks).toHaveLength(1);
  expect(after.state.draftBlocks[0]).toMatchObject({ title: '数学 20問', status: 'draft' });
  expect(after.state.previewCandidates).toEqual([]);
  expect(after.state.mode).toBe('awaiting_approval');
  expect(after.state.pendingApproval).toBeUndefined();
  expect(after.state.revision).toBe(before.state.revision + 1);
  expect(after.saved).toBe(before.saved);
  expect(after.writes).toBe(before.writes);
  expect(audit.blockedExternal).toEqual([]);
});
