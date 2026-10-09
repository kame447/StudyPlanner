import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

// Live X2-T3 (round 4): 「物理は木曜日までに終わらせたい」 after a preview for next week. The first reading
// carried nothing, so the bounded retry ran; the retry emitted a hard deadline with the week-anchored
// token next_week:weekday:thursday, which failed the date grammar with no repair left, so the turn
// recovered and the deadline was lost. Today in the run is Thu 2026-10-08; next week is Mon 10/12-Sun 10/18.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const T1 = '来週、物理の問題集を15問やりたい。1問6分くらい';
const T2 = '物理は木曜日までに終わらせたい';
const task = (o: Json): Json => ({ localId: 'phys', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '物理の問題集',
  study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
  temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '物理の問題集', ...o });
const deadline = (dateExpression: string): Json => ({ localId: 'dl', targetLocalId: 'phys', kind: 'deadline', constraintLevel: 'hard', dateExpression,
  namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '木曜日までに' });

async function run(expression: string, repairedExpression: string, architecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') {
  let t2Calls = 0;
  let knownTaskId = '';
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    const summaryTask = (((call.payload?.publicStateSummary ?? {}) as Json).tasks as Json[] ?? [])[0]?.publicId;
    if (summaryTask) knownTaskId = String(summaryTask);
    const taskId = knownTaskId;
    if (text === T1) return JSON.stringify(empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [task({
      workloads: [{ localId: 'amt', quantityRole: 'target', amount: 15, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '15問' }],
      effortEstimates: [{ localId: 'rate', targetLocalId: 'amt', kind: 'duration_per_unit', minutes: 6, unitCode: 'problem', precision: 'approximate', sourceText: '1問6分くらい' }] })] }));
    t2Calls += 1;
    // first reading: the bound task, nothing captured; the retry carries the deadline
    return JSON.stringify(empty({ tasks: [task({ existingPublicId: taskId, sourceText: '物理は木曜日までに',
      temporalConstraints: t2Calls === 1 ? [] : [deadline(t2Calls === 2 ? expression : repairedExpression)] })] }));
  });
  const conversation = createScriptedConversation({ provider, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
  await conversation.submit(T1);
  const turn = await conversation.submit(T2);
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
  return { turn, graph, t2Calls };
}

describe('X2-T3: an invalid bounded re-read is repaired once instead of losing the turn', () => {
  it('an invalid retry gets the one repair; the repaired deadline and the preview are kept', async () => {
    const { turn, graph, t2Calls } = await run('next_week:weekday:thursday', 'weekday:thursday');
    expect(t2Calls).toBe(3);
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
    expect(turn.result?.interactionOutcome?.kind).not.toBe('recover');
    expect(graph.temporalConstraints.filter(c => c.kind === 'deadline')).toHaveLength(1);
    expect(turn.result?.draftCandidates.length).toBeGreaterThan(0);
  });

  it('control: a repair that is still invalid is rejected — one repair, no third dispatch', async () => {
    const { turn, graph, t2Calls } = await run('next_week:weekday:thursday', 'nextweek:thursday');
    expect(t2Calls).toBe(3);
    expect(turn.result?.interactionOutcome?.kind).toBe('recover');
    expect(graph.temporalConstraints.filter(c => c.kind === 'deadline')).toHaveLength(0);
  });

  it('legacy dispatch count is unchanged by the fix', async () => {
    const { t2Calls } = await run('next_week:weekday:thursday', 'weekday:thursday', 'legacy_v5');
    expect(t2Calls).toBe(3);
  });
});
