import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Local SQLite/alarm end-to-end probe. All outbound requests are synthetic and denied unless listed.
const bundled = await build({ stdin: { contents: "export { default, AiQuotaDurableObject, WeeklyPlanningTurnDurableObject } from './workers/ai-proxy/src/traceWorker';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
  write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['cloudflare:workers'], metafile: true });
const forbidden = Object.keys(bundled.metafile.inputs).filter((path) => /firebaseClient|lib\/aiConfig|openAiCompatibleClient\.ts|userPlanningContextSpace/.test(path));
assert.deepEqual(forbidden, [], 'Worker must not bundle browser session/config/transport dependencies');
let releaseSemantic;
let semanticGate = new Promise((resolve) => { releaseSemantic = resolve; });
let providerCalls = 0;
const startedAt = Date.now();
const day = new Date(startedAt).toISOString().slice(0, 10);
const graphBuild = await build({ stdin: { contents: "import {createEmptyWeeklyPlanningFactGraphV5} from './src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5'; import {createWeeklyPlanningTurnRequestContext} from './src/features/weeklyPlanning/application/weeklyPlanningTemporalContext'; console.log(JSON.stringify({graph:createEmptyWeeklyPlanningFactGraphV5(), context:createWeeklyPlanningTurnRequestContext({startedAtIso: '" + new Date(startedAt).toISOString() + "', timeZone:'UTC', weekStartsOn:'monday'})}));", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
let captured;
new Function('console', graphBuild.outputFiles[0].text)({ log: (text) => { captured = JSON.parse(text); } });
const mf = new Miniflare({ ...convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false, modules: true,
  compatibilityDate: '2026-04-10', script: bundled.outputFiles[0].text,
  durableObjects: { AI_TURNS: { className: 'WeeklyPlanningTurnDurableObject', useSQLite: true }, AI_QUOTA: { className: 'AiQuotaDurableObject', useSQLite: true } },
  bindings: { DURABLE_WEEKLY_TURNS: 'enabled', OPENAI_API_KEY: 'synthetic-only', FIREBASE_WEB_API_KEY: 'synthetic-only' },
  outboundService: async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'identitytoolkit.googleapis.com') return Response.json({ users: [{ localId: 'local-owner', emailVerified: true }] });
    assert.equal(url.hostname, 'api.openai.com', 'No unlisted external request');
    providerCalls += 1;
    const body = await request.json();
    let content;
    if (body.response_format.json_schema.name === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = JSON.parse(body.messages.findLast((message) => message.role === 'user').content);
      content = JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text: 'どの学習を計画しましょうか？' });
    } else {
      await semanticGate;
      content = JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
        tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] });
    }
    return Response.json({ model: body.model, choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
  },
}), telemetry: { enabled: false } });
try {
  const input = { conversationId: 'local-chat', requestId: 'local-chat:request:1', baseRevision: 0, startedAt,
    payload: { weekStartDate: day, graph: captured.graph, userContextRecords: [], input: { userId: 'local-owner', conversationId: 'local-chat',
      traceRequestId: 'local-chat:request:1', inputStateRevision: 0, messages: [], userText: '予定の相談です', selectedDate: day, plans: [], scheduleTemplates: [],
      requestContext: captured.context } } };
  const headers = { Authorization: 'Bearer synthetic-only', 'Content-Type': 'application/json' };
  const accepted = await mf.dispatchFetch('https://app.test/weekly-planning/turns', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(accepted.status, 202); const first = await accepted.json(); assert.equal(first.status, 'queued');
  // Acceptance connection has ended. The alarm must still enter provider work.
  const timeout = Date.now() + 20_000;
  while (providerCalls === 0 && Date.now() < timeout) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(providerCalls, 1, 'alarm continues after acceptance request ends');
  releaseSemantic();
  const statusUrl = 'https://app.test/weekly-planning/turns?conversationId=local-chat&requestId=local-chat%3Arequest%3A1';
  let latest;
  while (Date.now() < timeout) {
    const response = await mf.dispatchFetch(statusUrl, { headers }); latest = await response.json();
    if (latest.status === 'completed' || latest.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(latest.status, 'completed', JSON.stringify(latest));
  const countAtComplete = providerCalls;
  const replay = await mf.dispatchFetch('https://app.test/weekly-planning/turns', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.deepEqual(await replay.json(), latest);
  const changed = structuredClone(input); changed.payload.input.userText = 'changed payload';
  const conflict = await mf.dispatchFetch('https://app.test/weekly-planning/turns', { method: 'POST', headers, body: JSON.stringify(changed) });
  assert.equal(conflict.status, 409, await conflict.text());
  for (let i = 0; i < 3; i++) assert.deepEqual(await (await mf.dispatchFetch(statusUrl, { headers })).json(), latest);
  assert.equal(providerCalls, countAtComplete);
  // Explicit cancellation may leave the already dispatched semantic request in flight,
  // but no later renderer dispatch or delayed acceptance may revive the turn.
  semanticGate = new Promise((resolve) => { releaseSemantic = resolve; });
  const next = structuredClone(input); next.requestId = 'local-chat:request:2'; next.baseRevision = 2;
  next.payload.input.traceRequestId = next.requestId; next.payload.input.inputStateRevision = 2;
  assert.equal((await mf.dispatchFetch('https://app.test/weekly-planning/turns', { method: 'POST', headers, body: JSON.stringify(next) })).status, 202);
  const cancelDeadline = Date.now() + 20_000;
  while (providerCalls < countAtComplete + 1 && Date.now() < cancelDeadline) await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(providerCalls, countAtComplete + 1);
  const cancelQuery = new URLSearchParams({ conversationId: next.conversationId, requestId: next.requestId,
    baseRevision: String(next.baseRevision), startedAt: String(next.startedAt) });
  const cancelled = await mf.dispatchFetch(`https://app.test/weekly-planning/turns?${cancelQuery}`, { method: 'DELETE', headers });
  assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).failure, 'cancelled');
  releaseSemantic(); await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(providerCalls, countAtComplete + 1, 'no renderer after explicit cancellation');
  const finalCancelled = await (await mf.dispatchFetch(`https://app.test/weekly-planning/turns?${cancelQuery}`, { headers })).json();
  assert.equal(finalCancelled.failure, 'cancelled');
  console.log(JSON.stringify({ explicitCancellation: 'no subsequent provider dispatch', sqliteAlarm: 'pass', disconnectThenComplete: 'pass', replayAndPoll: 'no additional provider calls', providerCalls, workerBytes: bundled.outputFiles[0].text.length }));
} finally { releaseSemantic(); await mf.dispose(); }
