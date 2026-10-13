import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { JEV_MODEL } from './decisionPolicy';
import { createFocusedContextualBindingSnapshotV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualBindingV5';
import { createFocusedContextualBindingGraphFixtureV5, createFocusedContextualBindingInputFixtureV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualBindingV5.testUtils';
import { createExtendedContextualMessagesV5, FOCUSED_CONTEXTUAL_ANSWER_WITH_PROVISIONAL_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticFocusedPreRoutesV5';
import type { WeeklyPlanningFactGraphV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5';

type Mode = 'off' | 'shadow' | 'canary';
let oldWorker: typeof worker;
const jevBodies: Array<Record<string, unknown>> = [];
const lunaBodies: Array<Record<string, unknown>> = [];
let failJev = false;
beforeAll(async () => {
  // Actual immutable pre-J1 Worker + shared reader, not a reimplemented validator.
  const root = process.cwd();
  // Archive-only verification can point at the integration holder's read-only Git object store.
  const baselineRepository = process.env.JEV_COMPATIBILITY_BASE_REPO ?? root;
  const baseline = path.join(root, '.cache/j1-old-worker');
  fs.mkdirSync(baseline, { recursive: true });
  execFileSync('tar', ['-x', '-C', baseline], { input: execFileSync('git', ['archive', '070d25cbe14796aebb8168ac5425c93e3506df1c', 'workers/ai-proxy/src', 'shared'], { cwd: baselineRepository, maxBuffer: 32 * 1024 * 1024 }) });
  const bundle = path.join(baseline, 'worker-bundle.mjs');
  await build({ entryPoints: [path.join(baseline, 'workers/ai-proxy/src/worker.ts')], outfile: bundle,
    bundle: true, platform: 'node', format: 'esm',
    alias: { 'cloudflare:workers': path.join(baseline, 'workers/ai-proxy/src/cloudflareWorkersVitestStub.ts') } });
  const moduleUrl = pathToFileURL(bundle).href;
  oldWorker = (await import(/* @vite-ignore */ moduleUrl)).default;
});
beforeEach(() => {
  jevBodies.length = 0; lunaBodies.length = 0; failJev = false;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes('identitytoolkit')) return Response.json({ users: [{ localId: 'fixture-user', emailVerified: true }] });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(url).endsWith('/api/alpha/decisions')) {
      jevBodies.push(body);
      if (failJev) return new Response('', { status: 503 });
      return Response.json({ model: JEV_MODEL.responses[1], answers: {
        contextual_answer: { type: 'choice', choice: 'remaining', confidence: .999,
          probabilities: { target: .0001, remaining: .9996, completed: .0001, focused_luna: .0001, fallback: .0001 } },
        condition_change: { type: 'noul', noul: .001 }, independent_meaning: { type: 'noul', noul: .001 },
      } });
    }
    if (String(url).endsWith('/chat/completions')) {
      lunaBodies.push(body);
      return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify({
        decision: 'quantity_role_answer', effortTarget: null, effortMeasurement: null,
        minutes: null, precision: null, quantityRole: 'remaining',
      }) } }] });
    }
    throw new Error('Unexpected fixture transport');
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function payload(version: 'old' | 'new' = 'new', graph = createFocusedContextualBindingGraphFixtureV5()) {
  const input = createFocusedContextualBindingInputFixtureV5(graph);
  const bound = createFocusedContextualBindingSnapshotV5(input)!.context;
  const legacy = { purpose: 'focused_contextual_answer' as const, requestId: bound.requestId,
    inputRevision: bound.inputRevision, questionCode: bound.questionCode,
    state: { currentUserText: bound.state.currentUserText, pendingQuestion: {
      targetQuantityRole: bound.state.pendingQuestion.targetQuantityRole,
      questionBasis: bound.state.pendingQuestion.questionBasis,
      hasEstimateTarget: bound.state.pendingQuestion.hasEstimateTarget,
    } } };
  return { purpose: 'weekly_planning_semantic_normalizer', messages: createExtendedContextualMessagesV5(input),
    temperature: 0, response_format: FOCUSED_CONTEXTUAL_ANSWER_WITH_PROVISIONAL_RESPONSE_FORMAT_V5,
    max_completion_tokens: 320, decisionContext: version === 'new' ? structuredClone(bound) : legacy };
}
async function execute(version: 'old' | 'new', mode: Mode, body: unknown) {
  const pending: Promise<unknown>[] = [];
  const env = { OPENAI_API_KEY: 'fixture-key', OPENROUTER_API_KEY: 'fixture-key',
    FIREBASE_WEB_API_KEY: 'fixture-project', ALLOWED_ORIGIN: 'https://app.example',
    JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: mode,
    JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }) } };
  const response = await (version === 'new' ? worker : oldWorker).fetch(new Request('https://proxy.example/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer fixture', Origin: 'https://app.example' }, body: JSON.stringify(body),
  }), env as never, { getToken: async () => 'unused' }, { waitUntil: promise => pending.push(promise) } as ExecutionContext);
  await Promise.all(pending);
  return response;
}

describe('J1 actual old/new Worker wire compatibility', () => {
  for (const client of ['old', 'new'] as const) for (const server of ['old', 'new'] as const) {
    it.each(['off', 'shadow', 'canary'] as const)(`${client} client / ${server} Worker / %s`, async mode => {
      const response = await execute(server, mode, payload(client));
      expect(response.status).toBe(200);
      const eligible = client === server && mode !== 'off';
      expect(jevBodies).toHaveLength(eligible ? 1 : 0);
      expect(lunaBodies).toHaveLength(eligible && mode === 'canary' ? 0 : 1);
      expect(JSON.parse((await response.json()).content)).toMatchObject({ decision: 'quantity_role_answer', quantityRole: 'remaining' });
    });
  }
  it.each(['off', 'shadow', 'canary'] as const)('malformed v2 is original Luna once in %s, never legacy Jev', async mode => {
    for (const fault of ['amount', 'revision', 'role', 'token', 'question', 'unknown', 'array enum']) {
      jevBodies.length = 0; lunaBodies.length = 0;
      const body = payload();
      const context = body.decisionContext;
      if (context.purpose !== 'focused_contextual_answer_v2') throw new Error('Wrong fixture');
      const target = context.state.pendingQuestion.target;
      if (fault === 'amount') target.workload.amount = -1;
      if (fault === 'revision') target.sourceRevision = 7;
      if (fault === 'role') target.workload.quantityRole = 'remaining';
      if (fault === 'token') context.targetToken = 'other';
      if (fault === 'question') target.questionCode = 'missing_effort_estimate';
      if (fault === 'unknown') Object.assign(target, { graph: {} });
      if (fault === 'array enum') Object.assign(target.task, { category: ['study'] });
      const response = await execute('new', mode, body);
      expect(response.status).toBe(200);
      expect(jevBodies).toHaveLength(0); expect(lunaBodies).toHaveLength(1);
      expect(lunaBodies[0].messages).toEqual(body.messages);
    }
  });
  it('closes every non-string wire enum before provider exposure', async () => {
    for (const field of ['category', 'role', 'unitCode', 'quantityRole', 'questionCode']) {
      for (const invalid of [['study'], { value: 'study' }, 1, true, null]) {
        jevBodies.length = 0; lunaBodies.length = 0;
        const body = payload();
        if (body.decisionContext.purpose !== 'focused_contextual_answer_v2') throw new Error('Wrong fixture');
        const target = body.decisionContext.state.pendingQuestion.target;
        const object = field === 'category' ? target.task : field === 'role' ? target.componentChain[0]
          : field === 'questionCode' ? target : target.workload;
        Object.assign(object, { [field]: invalid });
        expect((await execute('new', 'canary', body)).status).toBe(200);
        expect(jevBodies).toHaveLength(0); expect(lunaBodies).toHaveLength(1);
        expect(lunaBodies[0].messages).toEqual(body.messages);
      }
    }
  });
  it('matches the v2 source text and quantity fields to the original typed Luna message', async () => {
    const body = payload();
    if (body.decisionContext.purpose !== 'focused_contextual_answer_v2') throw new Error('Wrong fixture');
    body.decisionContext.state.pendingQuestion.target.workload.amount = 99;
    expect((await execute('new', 'canary', body)).status).toBe(200);
    expect(jevBodies).toHaveLength(0); expect(lunaBodies).toHaveLength(1);
  });
  it('exposes the complete tuple but no formal IDs/private provenance to Jev or ordinary logs', async () => {
    await execute('new', 'canary', payload());
    expect(jevBodies).toHaveLength(1);
    expect(jevBodies[0].state).toMatchObject({ pendingQuestion: { target: {
      task: { title: '数学' }, componentChain: [{ label: '青チャート' }, { label: '第1章' }],
      workload: { amount: 20, unitCode: 'problem', unitLabel: '問' },
    } } });
    const serialized = JSON.stringify(jevBodies[0]);
    expect(serialized).not.toContain('private-id');
    expect(serialized).not.toContain('fixture-private-provenance');
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('青チャート');
  });
  it('excludes unrelated tasks, siblings and their private provenance from actual Jev bytes', async () => {
    const graph = createFocusedContextualBindingGraphFixtureV5();
    const unrelated = { ...graph.tasks[0], id: 'unrelated-private-id', title: 'UNRELATED_TASK_SENTINEL' };
    const sibling = { ...graph.components[1], id: 'sibling-private-id', label: 'SIBLING_COMPONENT_SENTINEL' };
    graph.tasks.push(unrelated); graph.components.push(sibling);
    for (const fact of [unrelated, sibling]) graph.factLifecycles.push({ factId: fact.id, status: 'active',
      createdRevision: 8, terminalRevision: null, supersededByFactId: null });
    expect((await execute('new', 'canary', payload('new', graph))).status).toBe(200);
    expect(jevBodies).toHaveLength(1);
    const bytes = JSON.stringify(jevBodies[0]);
    for (const privateValue of ['UNRELATED_TASK_SENTINEL', 'SIBLING_COMPONENT_SENTINEL', 'private-id', 'fixture-private-provenance']) {
      expect(bytes).not.toContain(privateValue);
      expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(privateValue);
    }
    expect(bytes).toContain('青チャート'); expect(bytes).toContain('第1章');
  });
  it.each([
    ['amount', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].amount = 30; }],
    ['unit', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].unitCode = 'page'; graph.workloads[0].unitLabel = 'ページ'; }],
    ['custom unit label', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].unitLabel = '問題'; }],
    ['target', (graph: WeeklyPlanningFactGraphV5) => { graph.components[1].label = '第2章'; }],
    ['role', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].quantityRole = 'unknown'; }],
    ['period', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].perOccurrence = true; graph.workloads[0].periodExpression = '毎日'; }],
    ['opaque range', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].rangeStart = 'A'; graph.workloads[0].rangeEnd = 'K'; }],
    ['task', (graph: WeeklyPlanningFactGraphV5) => { graph.tasks[0].title = '物理'; }],
    ['parent', (graph: WeeklyPlanningFactGraphV5) => { graph.components[0].label = '赤チャート'; }],
    ['range', (graph: WeeklyPlanningFactGraphV5) => { graph.workloads[0].rangeStart = '21'; graph.workloads[0].rangeEnd = '40'; }],
  ] as const)('keeps %s minimal pair distinct through actual serialized provider fetch', async (_axis, change) => {
    await execute('new', 'canary', payload());
    const graph = createFocusedContextualBindingGraphFixtureV5(); change(graph);
    await execute('new', 'canary', payload('new', graph));
    expect(jevBodies).toHaveLength(2);
    expect(jevBodies[0].state).not.toEqual(jevBodies[1].state);
  });
  it('retains exactly one original Luna request after Jev provider failure', async () => {
    failJev = true; const body = payload();
    expect((await execute('new', 'canary', body)).status).toBe(200);
    expect(jevBodies).toHaveLength(1); expect(lunaBodies).toHaveLength(1);
    expect(lunaBodies[0].messages).toEqual(body.messages);
  });
  it('retains the existing total HTTP body limit before either provider', async () => {
    const body = payload(); body.messages.push({ role: 'user', content: 'あ'.repeat(90_000) });
    expect((await execute('new', 'canary', body)).status).toBe(413);
    expect(jevBodies).toHaveLength(0); expect(lunaBodies).toHaveLength(0);
  });
});
