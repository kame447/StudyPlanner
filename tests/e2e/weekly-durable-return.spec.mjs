import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { outputFiles } = await build({ stdin: { contents: `
  export { DurableTurnJob } from './workers/ai-proxy/src/durableTurns/durableTurnJob';
  export { executeDurableVNextTurn } from './workers/ai-proxy/src/durableTurns/durableVNextTurn';
  export { serializeWeeklyPlanningTurnResult } from './workers/ai-proxy/src/durableTurns/weeklyPlanningTurnResult';
`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs',
  // The Worker entry imports the Cloudflare runtime; only the job and the turn execution run here.
  plugins: [{ name: 'cloudflare-workers-stub', setup: (b) => {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare-workers', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class DurableObject {}', loader: 'js' }));
  } }] });
const module = { exports: {} };
new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { DurableTurnJob, executeDurableVNextTurn, serializeWeeklyPlanningTurnResult } = module.exports;
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
    await expect(input).toBeVisible(); await input.fill('学習計画を相談したい'); await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    // Destroy the browser runtime while the accepted job is still queued.
    await page.goto('about:blank');
    // The Worker's own VNext turn over the journaled provider; only the model's answers are scripted.
    const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
      AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      providerCalls += 1;
      const body = JSON.parse(init.body);
      let content;
      if (body.response_format?.json_schema?.name === 'weekly_planning_vnext_native_v1') {
        content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
          delta: { add: [], patch: [], remove: [], relate: [], defer: [] } });
      } else {
        const prompt = body.messages.map((message) => { try { return JSON.parse(message.content); } catch { return null; } })
          .find((value) => value?.applicationDecision);
        content = JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
          questionCode: prompt.applicationDecision.questionCode ?? null, groundingAcknowledgement: null, text: reply });
      }
      return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
    };
    try {
      await job.run(async (payload, dispatch) => serializeWeeklyPlanningTurnResult(
        await executeDurableVNextTurn(env, JSON.parse(payload), dispatch)));
    } finally { globalThis.fetch = realFetch; }
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
