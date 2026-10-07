import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { campaignRendererReply } from './testUtils/weeklyPlanningRealE2ECampaignFixture';

// Live B T3 on 48a42eec: the first document failed parse-stage checks (empty task fields), which
// hid a workload id sent as a second task's existingPublicId; the one repair fixed only what it
// was shown and the turn was rejected. Interaction gives each validation stage one repair.
type Json = Record<string, unknown>;
type Shape = 'staged_recovers' | 'staged_fails' | 'post_parse_only';
const SETUP = '来週、数学の問題集を20問進めたい';
const RATE = '1問3分くらい';
const base = (overrides: Json): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], conversationActs: [],
  uncertainties: [], corrections: [], decisions: [], ...overrides });
const work = (localId: string): Json => ({ localId, quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null,
  rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '20問' });
const task = (localId: string, existingPublicId: string | null, overrides: Json = {}): Json => ({ localId, existingPublicId, decompositionStatus: 'atomic',
  category: 'study', title: '数学の問題集を進める', study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
  workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: RATE, ...overrides });
const rate = (targetLocalId: string): Json => ({ localId: 'rate', targetLocalId, kind: 'duration_per_unit', minutes: 3, unitCode: 'problem',
  precision: 'approximate', sourceText: RATE });

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); provider = undefined; resetScriptedConversationRuntime(); });

function start(shape: Shape, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  resetScriptedConversationRuntime();
  let conversation: ScriptedConversation;
  const attempts: string[] = [];
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return campaignRendererReply(call.payload ?? {});
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null,
      effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    const payload = call.messages.map((message) => { try { return JSON.parse(message.content) as Json; } catch { return {}; } })
      .find((value) => typeof value.userText === 'string')!;
    let document: Json;
    if (payload.userText === SETUP) document = base({ planningIntent: 'create_plan',
      planningWindow: { localId: 'window-1', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
      tasks: [task('task-1', null, { workloads: [work('workload-1')], sourceText: '数学の問題集を20問進めたい' })],
      uncertainties: [{ localId: 'which', targetLocalId: 'task-1', field: 'material', reason: '登録教材を特定できない', sourceText: '数学の問題集' }] });
    else {
      const graph = conversation.graph()!;
      const taskId = graph.tasks[0].id;
      const workloadId = graph.workloads[0].id;
      // Semantic calls of this turn, in order: initial, repair, staged repair.
      const attempt = (['initial', 'repair', 'staged'] as const)[attempts.length];
      attempts.push(attempt);
      const act = { conversationActs: [{ kind: 'answer_pending_question', targetPublicId: taskId }] };
      // The workload's public id sent as a second "task" (post-parse error) ...
      const workloadAsTask = task('workload-as-task', workloadId, { category: 'unknown', effortEstimates: [rate('workload-as-task')] });
      if (attempt === 'initial') document = base({ ...act, tasks: shape === 'post_parse_only'
        ? [task('task', taskId), workloadAsTask]
        // ... hidden behind parse-stage errors (empty task title/sourceText).
        : [task('task', taskId, { title: '', sourceText: '' }), { ...workloadAsTask, title: '', sourceText: '' }] });
      else if (attempt === 'repair' || shape === 'staged_fails') document = base({ ...act, tasks: [task('task', taskId), workloadAsTask] });
      else document = base({ ...act, tasks: [task('task', taskId, { workloads: [work('workload')], effortEstimates: [rate('workload')] })] });
    }
    if (!call.schemaProperties.includes('conversationActs')) delete document.conversationActs;
    return JSON.stringify(document);
  });
  conversation = createScriptedConversation({ provider, architecture });
  return { conversation: () => conversation, attempts };
}

describe('staged semantic repair (live B on 48a42eec)', () => {
  it('repairs errors the first validation could not see once, and keeps the pending material question', async () => {
    const run = start('staged_recovers');
    const conversation = run.conversation();
    expect((await conversation.submit(SETUP)).result?.failure).toBeUndefined();
    const turn = await conversation.submit(RATE);
    expect(turn.result?.failure).toBeUndefined();
    expect(run.attempts).toEqual(['initial', 'repair', 'staged']);
    expect(JSON.stringify(turn.debugTrace)).toContain('generic_semantic_staged_repair');
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, kind: 'duration_per_unit' }));
    expect(active.workloads).toHaveLength(1);
    // The material question still blocks the preview.
    expect(active.uncertainties).toHaveLength(1);
    expect(turn.result!.draftCandidates).toHaveLength(0);
  });

  it('is bounded: a failing staged repair rejects the turn without a fourth semantic call', async () => {
    const run = start('staged_fails');
    const conversation = run.conversation();
    await conversation.submit(SETUP);
    const before = structuredClone(conversation.graph());
    const turn = await conversation.submit(RATE);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(run.attempts).toEqual(['initial', 'repair', 'staged']);
    expect(conversation.graph()!.effortEstimates).toEqual(before!.effortEstimates);
  });

  it('never repairs twice a post-parse failure the first repair already saw', async () => {
    const run = start('post_parse_only');
    const conversation = run.conversation();
    await conversation.submit(SETUP);
    const turn = await conversation.submit(RATE);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(run.attempts).toEqual(['initial', 'repair']);
  });

  it('keeps legacy at one repair', async () => {
    const run = start('staged_recovers', 'legacy_v5');
    const conversation = run.conversation();
    await conversation.submit(SETUP);
    const turn = await conversation.submit(RATE);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(run.attempts).toEqual(['initial', 'repair']);
  });
});
