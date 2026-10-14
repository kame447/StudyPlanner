import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/fixed-clock.mjs';

// Tier A+B: real client/semantic/runtime/application/UI and the existing local
// repository. Only final Worker responses are stipulated; no real provider or Worker ingress executes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
const PROXY = 'http://127.0.0.1:4174/mock-jev-proxy/chat/completions';
const SETUP = '8月20日から26日で数学20問を1問2分。まず条件だけ確認してください。';
const CORRECTION = '期間を8月21日から27日に訂正してください。まだ保存しないで。';
const REGENERATE = '訂正した条件で計画案を再生成してください。';
const AUTHORIZATION = 'この条件で未保存の計画案を作ってください。';
const modes = ['jev accepted', 'abstain → Luna', 'unavailable → Luna', 'generic escape', 'dual failure'];
const composer = page => page.locator('.ai-planning-composer textarea');
const previewButton = page => page.getByRole('button', { name: '計画プレビューを確認' });
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));

function delta(planningIntent = 'create_plan') {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent, planningWindow: null, tasks: [],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [] };
}
// Same bounded task/workload/effort shape as ProviderBoundary.integration.test.tsx:50.
function initialConditions() {
  const document = delta('discuss');
  document.planningWindow = { localId: 'window', kind: 'absolute', value: '2026-08-20/2026-08-26',
    start: '2026-08-20', end: '2026-08-26', sourceText: '8月20日から26日' };
  document.tasks = [{ localId: 'task', category: 'study', title: '数学',
    study: { purpose: 'self_study', contextLabel: '数学', components: [] },
    workloads: [{ localId: 'work', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学20問' }],
    effortEstimates: [{ localId: 'effort', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 2,
      unitCode: 'problem', precision: 'exact', sourceText: '1問2分' }],
    temporalConstraints: [], recurrence: [], sourceText: '数学20問を1問2分' }];
  return document;
}

async function boot(page, mode) {
  const audit = { blockedExternal: [], proxy: [], replacedModules: [] };
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', async route => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4174') {
      audit.blockedExternal.push(url.origin); return route.abort();
    }
    return route.continue();
  });
  // Restore production execution only in this test's Page; never edit Vite's alias.
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', async route => {
    audit.replacedModules.push('gateway');
    return route.fulfill({ contentType: 'application/javascript',
      body: `export { weeklyPlanningTurnRuntimeGateway } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway.ts`)};` });
  });
  for (const [file, marker, injected] of [
    ['aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(PROXY)};`],
    ['firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "local-fixture-session" } };'],
  ]) {
    await page.route(`**/src/lib/${file}*`, async route => {
      const response = await route.fetch(); const code = await response.text();
      expect(code.split(marker)).toHaveLength(2); // Fail closed on a changed seam.
      audit.replacedModules.push(file);
      return route.fulfill({ response, body: code.replace(marker, `${marker}\n${injected}`) });
    });
  }
  await page.route(PROXY, async route => {
    const body = route.request().postDataJSON();
    const schema = body.response_format?.json_schema?.name;
    audit.proxy.push({ schema, body });
    expect(body).not.toHaveProperty('model');
    let content;
    if (schema === 'weekly_planning_focused_authorization_v5') {
      expect(body.decisionContext).toMatchObject({ purpose: 'focused_authorization', previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false });
      if (mode === 'dual failure') return route.fulfill({ status: 502, json: { error: 'Mock Jev and focused Luna unavailable.' } });
      content = { decision: mode === 'generic escape' ? 'fallback' : 'create_plan' };
    } else if (schema === 'weekly_planning_semantic_document_v5') {
      expect(body).not.toHaveProperty('decisionContext');
      const input = JSON.parse(body.messages.at(-1).content);
      if (mode === 'dual failure' && input.userText !== SETUP) return route.fulfill({ status: 502, json: { error: 'Mock generic Luna unavailable.' } });
      if (input.userText === SETUP) content = initialConditions();
      else if (input.userText === CORRECTION) {
        content = delta('update_plan');
        content.planningWindow = { localId: 'corrected-window', kind: 'absolute', value: '2026-08-21/2026-08-27',
          start: '2026-08-21', end: '2026-08-27', sourceText: '8月21日から27日' };
      } else {
        expect([AUTHORIZATION, REGENERATE]).toContain(input.userText); content = delta();
      }
    } else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = JSON.parse(body.messages.at(-1).content); const decision = prompt.applicationDecision;
      content = { actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
        groundingAcknowledgement: null, text: `内容を確認してください。${decision.previewPromotionControlLabel ?? ''}` };
    } else throw new Error(`Unexpected mock proxy schema: ${schema}`);
    const jevReply = schema === 'weekly_planning_focused_authorization_v5'
      && ['jev accepted', 'generic escape'].includes(mode);
    await route.fulfill({ json: { content: JSON.stringify(content),
      ...(jevReply ? { decisionContext: { requestId: body.decisionContext.requestId, inputRevision: body.decisionContext.inputRevision } } : {}) },
      headers: { 'X-StudyPlanner-AI-Provider': jevReply ? 'openrouter' : 'openai' } });
  });
  await page.goto(URL);
  await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toBeVisible();
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  return audit;
}

async function submit(page, audit, text) {
  const before = audit.proxy.length;
  await composer(page).fill(text); await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => audit.proxy.length).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: '処理をキャンセル', exact: true })).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
}
async function openPreview(page) {
  await previewButton(page).click();
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog).toBeVisible(); return dialog;
}
async function reloadOwned(page) {
  // Existing fixture's documented one-shot preserve flag; otherwise it reseeds.
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  if (!(await composer(page).isVisible())) {
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  }
  await expect(composer(page)).toBeEnabled();
}

test.describe.configure({ retries: 0 });
for (const mode of modes) {
  test(`tier A/B ${mode}: preview needs explicit save; corrected candidates survive reload`, async ({ page }) => {
    const audit = await boot(page, mode);
    await submit(page, audit, SETUP);
    await expect(previewButton(page)).toHaveCount(0); expect(await saved(page)).toEqual([]);
    const beforeAuthorization = audit.proxy.length;
    await submit(page, audit, AUTHORIZATION);
    const semanticRoutes = audit.proxy.slice(beforeAuthorization).filter(item => item.body.purpose === 'weekly_planning_semantic_normalizer');
    expect(semanticRoutes[0].schema).toBe('weekly_planning_focused_authorization_v5');
    expect(semanticRoutes.map(item => item.schema)).toEqual(mode === 'generic escape' || mode === 'dual failure'
      ? ['weekly_planning_focused_authorization_v5', 'weekly_planning_semantic_document_v5'] : ['weekly_planning_focused_authorization_v5']);
    expect(await saved(page)).toEqual([]);
    if (mode === 'dual failure') {
      await expect(previewButton(page)).toHaveCount(0);
      await reloadOwned(page); await expect(previewButton(page)).toHaveCount(0);
      await expect(page.locator('.ai-planning-conversation').getByText(SETUP, { exact: true })).toHaveCount(1);
      expect(await saved(page)).toEqual([]);
    } else {
      let dialog = await openPreview(page);
      await expect(dialog.locator('.ai-planning-draft-block')).toHaveCount(1);
      await expect(dialog).toContainText('数学');
      expect(await saved(page)).toEqual([]);
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      await submit(page, audit, CORRECTION); await submit(page, audit, REGENERATE);
      // Recompute is observable: the only block must move into the corrected period.
      dialog = await openPreview(page);
      await expect(dialog.locator('.ai-planning-draft-block')).toHaveCount(1);
      await expect(dialog).toContainText('8/21');
      expect(await saved(page)).toEqual([]);
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      const beforeReload = audit.proxy.length;
      await reloadOwned(page); expect(audit.proxy).toHaveLength(beforeReload);
      dialog = await openPreview(page);
      await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
      const approve = dialog.getByRole('button', { name: 'この内容で保存' });
      await expect(approve).toBeEnabled(); expect(await saved(page)).toEqual([]);
      const writesBefore = await page.evaluate(() => window.__plannerRecoveryStorageWrites.filter(write => write.key === 'studyplanner.scheduleEvents.v1').length);
      await approve.evaluate(button => { button.click(); button.click(); });
      await expect.poll(async () => (await saved(page)).length).toBe(1);
      await expect(dialog).toHaveCount(0);
      const committed = await saved(page);
      expect(committed[0]).toMatchObject({ date: '2026-08-21' });
      expect(await page.evaluate(() => window.__plannerRecoveryStorageWrites.filter(write => write.key === 'studyplanner.scheduleEvents.v1').length)).toBe(writesBefore + 1);
      await reloadOwned(page); expect(await saved(page)).toEqual(committed);
      await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.snapshot().plans.map(plan => ({ date: plan.date, title: plan.title })))).toEqual([{ date: committed[0].date, title: committed[0].title }]);
      await expect(previewButton(page)).toHaveCount(0);
    }
    expect(audit.replacedModules).toEqual(expect.arrayContaining(['gateway', 'aiConfig.ts', 'firebaseClient.ts']));
    expect(audit.blockedExternal).toEqual([]); // Unexpected external attempts fail even though aborted.
  });
}
