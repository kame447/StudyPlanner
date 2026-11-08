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
  plugins: [{ name: 'cloudflare-workers-stub', setup: (b) => {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare-workers', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class DurableObject {}', loader: 'js' }));
  } }] });
const module = { exports: {} };
new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { DurableTurnJob, executeDurableVNextTurn, serializeWeeklyPlanningTurnResult } = module.exports;
const owner = 'browser-real-weekly-user';
const failedText = '数学の予定を変更したい';
const nextText = '続けて相談したい';
const reply = 'どの学習を計画しましょうか？';
// Copied exactly from weeklyPlanningDurableAccessDeniedError.ts at 99b7ad4e.
const deniedMessage = {
  401: '認証を確認できませんでした。今回の入力は保存も承認もされていません。再ログインして権限を確認した後、この会話で相談を続けられます。',
  403: 'この会話への権限を確認できませんでした。今回の入力は保存も承認もされていません。再ログインして権限を確認した後、この会話で相談を続けられます。',
};

for (const status of [401, 403]) {
  test(`durable ${status} keeps the consultation and preview unsaved and accepts the next turn`, async ({ page, context }) => {
    // Create a real UI preview with the existing synthetic gateway, then move its
    // persisted same-owner session to the durable harness (the ports differ).
    await page.goto('http://127.0.0.1:4174/real-weekly.html?preview=1');
    const input = page.locator('.ai-planning-composer textarea');
    await expect(input).toBeVisible();
    await input.fill('数学のワークを計画したい');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__realWeeklyState?.previewCandidates?.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('real-app-preview-math')))).toBe(true);
    const initialStorage = await page.evaluate(() => Object.entries(localStorage));
    await page.goto('http://127.0.0.1:4175/real-weekly.html');
    await page.evaluate(entries => { localStorage.clear(); for (const [key, value] of entries) localStorage.setItem(key, value); }, initialStorage);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__realWeeklyState?.previewCandidates?.length)).toBe(1);
    const before = await page.evaluate(() => ({ preview: structuredClone(window.__realWeeklyState.previewCandidates),
      drafts: structuredClone(window.__realWeeklyState.draftBlocks),
      planStorage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('studyplanner.scheduleEvents') || key.startsWith('studyplanner.actual'))) }));
    expect(before.preview[0].stableKey).toBe('real-app-preview-math');
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();

    let record; let posts = 0; let denied = true;
    const requests = []; const otherWrites = [];
    const job = new DurableTurnJob({ read: async () => record && structuredClone(record),
      write: async value => { record = structuredClone(value); }, alarmAt: async () => {} });
    page.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && !new URL(request.url()).pathname.endsWith('/weekly-planning/turns')) {
        otherWrites.push(`${request.method()} ${request.url()}`);
      }
    });
    await context.route('**/weekly-planning/turns**', async route => {
      const request = route.request();
      requests.push(request.method());
      expect(request.headers().authorization).toBe('Bearer synthetic-only');
      if (request.method() === 'POST') {
        posts += 1;
        if (denied) return route.fulfill({ status, body: '' });
        const input = request.postDataJSON();
        const accepted = await job.accept({ ...input, ownerId: owner, payload: JSON.stringify(input.payload) });
        const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
          AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } };
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (_url, init) => {
          const body = JSON.parse(init.body);
          let content;
          if (body.response_format?.json_schema?.name === 'weekly_planning_vnext_native_v1') {
            content = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null,
              delta: { add: [], patch: [], remove: [], relate: [], defer: [] } });
          } else if (body.response_format?.json_schema?.name === 'weekly_planning_vnext_turn_purpose_v1') {
            // A reading with nothing to plan is also sent to the consultation purpose check (#246); this turn is not one.
            content = JSON.stringify({ schemaVersion: 'learning-consultation-turn-purpose.v1', kind: 'unresolved' });
          } else {
            const prompt = body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
              .find(value => value?.applicationDecision);
            content = JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
              questionCode: prompt.applicationDecision.questionCode ?? null, groundingAcknowledgement: null, text: reply });
          }
          return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
        };
        try {
          await job.run(async (payload, dispatch) => serializeWeeklyPlanningTurnResult(
            await executeDurableVNextTurn(env, JSON.parse(payload), dispatch)));
        } finally { globalThis.fetch = realFetch; }
        return route.fulfill({ status: 202, json: accepted });
      }
      const query = new URL(request.url()).searchParams;
      const state = await job.status({ ownerId: owner, conversationId: query.get('conversationId'), requestId: query.get('requestId') });
      return route.fulfill({ status: state ? 200 : 404, json: state });
    });

    await input.fill(failedText);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    const conversation = page.locator('.ai-planning-conversation');
    await expect(conversation.getByText(deniedMessage[status], { exact: true })).toHaveCount(1);
    await expect(conversation.getByText(failedText, { exact: true })).toHaveCount(1);
    await expect(input).toHaveValue('');
    await expect(input).toBeEnabled();
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
    expect(await page.evaluate(() => window.__realWeeklyState.previewCandidates)).toEqual(before.preview);
    expect(await page.evaluate(() => window.__realWeeklyState.draftBlocks)).toEqual(before.drafts);
    expect(await page.evaluate(() => window.__realWeeklyState.pendingApproval)).toBeUndefined();
    expect(await page.evaluate(() => window.__realWeeklyEvents.filter(event => ['real-save-approved-plan', 'real-complete-approved-plan'].includes(event.type)))).toEqual([]);
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('studyplanner.scheduleEvents') || key.startsWith('studyplanner.actual'))))).toEqual(before.planStorage);
    expect(otherWrites).toEqual([]);
    expect(requests).toEqual(['POST']);
    expect(posts).toBe(1);

    denied = false;
    await input.fill(nextText);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect(conversation.getByText(nextText, { exact: true })).toHaveCount(1);
    await expect(conversation.getByText(reply, { exact: true })).toHaveCount(1);
    expect(posts).toBe(2);
    expect(otherWrites).toEqual([]);
    expect(await page.evaluate(() => window.__realWeeklyEvents.filter(event => ['real-save-approved-plan', 'real-complete-approved-plan'].includes(event.type)))).toEqual([]);
  });
}
