import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { outputFiles } = await build({ stdin: { contents: `
  export { DurableTurnJob } from './workers/ai-proxy/src/durableTurns/durableTurnJob';
  export { executeIsolatedWeeklyPlanningTurn } from './src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';
`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} };
new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { DurableTurnJob, executeIsolatedWeeklyPlanningTurn } = module.exports;
const url = 'http://127.0.0.1:4175/real-weekly.html';
const reply = 'どの学習を計画しましょうか？';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`durable reply survives page departure and two reloads at ${viewport.width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    let record; let posts = 0; let providerCalls = 0;
    const job = new DurableTurnJob({ read: async () => record && structuredClone(record),
      write: async (value) => { record = structuredClone(value); }, alarmAt: async () => {} });
    await context.route('**/weekly-planning/turns**', async (route) => {
      expect(route.request().headers().authorization).toBe('Bearer synthetic-only');
      if (route.request().method() === 'POST') {
        posts += 1; const input = route.request().postDataJSON();
        const result = await job.accept({ ...input, ownerId: 'browser-real-weekly-user', payload: JSON.stringify(input.payload) });
        return route.fulfill({ status: 202, json: result });
      }
      const query = new URL(route.request().url()).searchParams;
      const state = await job.status({ ownerId: 'browser-real-weekly-user', conversationId: query.get('conversationId'), requestId: query.get('requestId') });
      return route.fulfill({ status: state ? 200 : 404, json: state });
    });
    await page.goto(url);
    // Keep the real browser transport: Node mocks do not enforce native fetch's receiver.
    console.info('Native fetch receiver check', await page.evaluate(async () => {
      try { await ({ fetch }).fetch('data:text/plain,binding-check'); return 'object receiver accepted'; }
      catch (error) { return `${error.name}: ${error.message}`; }
    }));
    const input = page.locator('.ai-planning-composer textarea');
    await expect(input).toBeVisible(); await input.fill('学習計画を相談したい'); await input.press('Enter');
    await expect.poll(() => posts).toBe(1);
    // Destroy the browser runtime while the accepted job is still queued.
    await page.goto('about:blank');
    await job.run(async (payload, dispatch) => JSON.stringify(await executeIsolatedWeeklyPlanningTurn(JSON.parse(payload), {
      createChatCompletion: (request) => dispatch(JSON.stringify(request), async () => {
        providerCalls += 1;
        if (request.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify({
          schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
          tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
        });
        const prompt = JSON.parse(request.messages.at(-1).content);
        return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
          questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text: reply });
      }),
    })));
    expect(record.status).toBe('completed'); expect(providerCalls).toBe(2);
    await page.goto(url);
    const conversation = page.locator('.ai-planning-conversation');
    await expect(conversation.getByText(reply, { exact: true })).toHaveCount(1);
    await page.reload();
    await expect(conversation.getByText(reply, { exact: true })).toHaveCount(1);
    await expect(conversation.getByText('学習計画を相談したい', { exact: true })).toHaveCount(1);
    expect(posts).toBe(1); expect(providerCalls).toBe(2);
    expect(await page.evaluate(() => window.__realWeeklyEvents.filter((event) => event.type === 'real-save-approved-plan'))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('durable-return.png'), fullPage: true });
  });
}
