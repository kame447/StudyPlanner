// Critic probe 20 (read-only scratch copies; not part of the repository).
// Question: a quantity-role contextual answer supersedes a workload that already has a pace
// estimate. Does the pace dangle (baseline 9622bbf9), and does EV v1's whole-graph write
// invariant then reject the answer or later turns?
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

type Json = Record<string, unknown>;
const T1 = '来週、数学の問題集を20問、1問3分くらい';
const T2 = 'これからやる20問です';
const T3 = '夜にやりたい';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const doc = (values: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...values });
const task = (existingPublicId: string | null, sourceText: string, values: Json = {}): Json => ({ localId: 'task', existingPublicId, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集を進める',
  study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] }, sourceText,
  workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], ...values });
const workload = (localId: string, role: string, sourceText: string) => ({ localId, quantityRole: role, amount: 20, unitCode: 'problem', unitLabel: '問',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });

function summarize(conversation: ReturnType<typeof createScriptedConversation>) {
  const graph = conversation.graph()!;
  const active = new Set(graph.factLifecycles.filter((e) => e.status === 'active').map((e) => e.factId));
  return {
    workloads: graph.workloads.filter((w) => active.has(w.id)).map((w) => `${w.quantityRole}:${w.amount}`),
    efforts: graph.effortEstimates.filter((e) => active.has(e.id)).map((e) => `${e.kind}:${e.minutes}->target_active=${active.has(e.targetFactId)}`),
    pending: (conversation.getState() as { pendingQuestion?: { questionCode?: string } }).pendingQuestion?.questionCode ?? null,
  };
}

describe.each(['interaction_v1', 'legacy_v5'] as const)('quantity-role pace carry is an approved shared fix (%s)', architecture => {
  it('role answer, then one more turn', async () => {
    provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
      if (call.kind === 'renderer') return 'renderer unavailable in fixture';
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'quantity_role_answer', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: 'target' });
      if (call.kind !== 'semantic_generic') return JSON.stringify({ decision: 'fallback' });
      const text = String(call.payload?.userText ?? '');
      const graph = conversation.graph();
      let result: Json;
      if (text === T1) result = doc({ planningIntent: 'create_plan',
        planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
        tasks: [task(null, '数学の問題集を20問', { workloads: [workload('work', 'unknown', '20問')],
          effortEstimates: [{ localId: 'pace', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', sourceText: '1問3分くらい' }] })] });
      else if (text === T2) result = doc({ tasks: [task(graph!.tasks[0].id, T2, { workloads: [workload('work2', 'target', '20問')] })],
        conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] });
      else result = doc({ tasks: [task(graph!.tasks[0].id, T3, { temporalConstraints: [{ localId: 'night', targetLocalId: 'task', kind: 'preferred_window', constraintLevel: 'soft',
        dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText: '夜にやりたい' }] })] });
      if (!call.schemaProperties.includes('conversationActs')) delete result.conversationActs;
      return JSON.stringify(result);
    });
    const conversation = createScriptedConversation({ provider, architecture });
    const t1 = await conversation.submit(T1);
    const s1 = summarize(conversation);
    const t2 = await conversation.submit(T2);
    const s2 = summarize(conversation);
    const t3 = await conversation.submit(T3);
    const s3 = summarize(conversation);
    const errs = (turn: typeof t1) => turn.debugTrace.filter((e) => JSON.stringify(e.data ?? {}).includes('active-reference-invariant')).length;
    console.log('PROBE20', JSON.stringify({
      t1: { failure: t1.result?.failure?.code ?? null, ...s1 },
      t2: { failure: t2.result?.failure?.code ?? null, invariantEvents: errs(t2), ...s2 },
      t3: { failure: t3.result?.failure?.code ?? null, invariantEvents: errs(t3), ...s3 },
    }, null, 1));
    expect.soft(t2.result?.failure).toBeUndefined();
    expect.soft(s2.workloads).toEqual(['target:20']);
    expect.soft(s2.efforts).toEqual(['duration_per_unit:3->target_active=true']);
    expect.soft(errs(t2)).toBe(0);
    expect.soft(t2.result?.state.lastQuestionContext?.targetSlot).not.toBe('stable_v5:quantity_role_unresolved');
    expect.soft(t2.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(t3.result?.failure).toBeUndefined();
    expect(t3.result?.state.lastQuestionContext?.targetSlot).not.toBe('stable_v5:quantity_role_unresolved');
  });
});
