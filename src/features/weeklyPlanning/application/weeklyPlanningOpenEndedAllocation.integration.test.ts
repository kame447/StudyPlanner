import { afterEach, describe, expect, it } from 'vitest';
import { executeIsolatedWeeklyPlanningTurn } from './weeklyPlanningIsolatedTurn';
import { durableReceipt } from './weeklyPlanningDurableTurn.testUtils';
import { bindWeeklyPlanningQuestionPresentation } from '../intake/weeklyPlanningQuestionPresentation';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningMessage } from '../types';

function initialDocument() {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'today', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' },
    tasks: ['研究', '掃除'].map((title, i) => ({ localId: `task-${i}`, category: i === 0 ? 'study' : 'non_study', title,
      study: i === 0 ? { purpose: 'unknown', activityKind: 'other', contextLabel: null, components: [] } : null,
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: title })),
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
}
function provider(requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][]): OpenAiCompatibleClient {
  return { async createChatCompletion(input) {
    requests.push(structuredClone(input));
    if (input.responseFormat?.json_schema.name === 'weekly_planning_provisional_allocation') return '{"decision":"provisional_timebox"}';
    if (input.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify(initialDocument());
    const value = JSON.parse([...input.messages].reverse().find(m => m.role === 'user')!.content);
    return JSON.stringify({ actionId: value.actionId, actionKind: value.applicationDecision.actionKind,
      questionCode: value.applicationDecision.questionCode, groundingAcknowledgement: null,
      text: value.applicationDecision.actionKind === 'preview_ready' ? '研究と掃除の仮予定を作りました。' : '研究と掃除は、今日はいつ取り組めそうですか？' });
  } };
}
afterEach(() => resetWeeklyPlanningStableV5DebugTraceForTest());

describe('open-ended allocation through the real semantic, planning and renderer runtime', () => {
  it.each([false, true])('reaches a preview without a completion estimate (persisted old need=%s)', async legacy => {
    const payload = durableReceipt().payload;
    payload.input.userText = '今日、研究と掃除を進めたい';
    const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
    const client = provider(requests);
    const first = (await executeIsolatedWeeklyPlanningTurn(payload, client)).result;
    expect(first.failure, JSON.stringify(first)).toBeUndefined();
    expect(first.state.lastQuestionContext?.intent).toBe('open_ended_session');
    expect(first.draftCandidates).toEqual([]);
    expect(first.dialogueRendererTrace?.response.status).toBe('rendered');
    const graph = structuredClone(first.stableV5Graph!);
    let state = first.state;
    let previousText = first.message;
    if (legacy) {
      graph.revision += 1;
      const research = graph.tasks.find(task => task.title === '研究')!;
      const source = { ...research.source, turnId: 'legacy-progress', sourceText: '95ぐらい。全体の時間はわからない' };
      for (const [id, quantityRole, amount] of [['past-work', 'completed', 95], ['remaining-work', 'remaining', 5]] as const) {
        graph.workloads.push({ id, taskId: research.id, componentId: null, quantityRole, amount, unitCode: 'custom', unitLabel: '%',
          rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source, createdRevision: graph.revision });
      }
      graph.uncertainties.push({ id: 'unknown-total', targetFactId: research.id, field: 'total_duration', reason: '見積もり不明', source, createdRevision: graph.revision });
      for (const id of ['past-work', 'remaining-work', 'unknown-total']) graph.factLifecycles.push({ factId: id, status: 'active',
        createdRevision: graph.revision, terminalRevision: null, supersededByFactId: null });
      state = { ...state, lastQuestionContext: { ...state.lastQuestionContext!, topicId: 'unknown-total', targetSlot: 'stable_v5:semantic_uncertainty' } };
      previousText = '全体の作業時間は見積もりなしとして扱えばよいですか？';
    }
    const assistant: WeeklyPlanningMessage = { id: 'shown-question', role: 'assistant', content: previousText, createdAt: '2026-10-14T00:00:00.000Z' };
    payload.graph = graph;
    payload.input.previousState = bindWeeklyPlanningQuestionPresentation({ state, content: first.questionPresentationContent,
      turnId: 'first', assistantMessageId: assistant.id, planningStateRevision: 1, graphRevision: graph.revision });
    payload.input.inputStateRevision = 1;
    payload.input.messages = [assistant];
    payload.input.traceRequestId = 'allocate-current-plan';
    payload.input.userText = '全体の時間はわからないので、今ある空き時間でこの計画の仮予定を決めて';
    const before = structuredClone(graph);
    const next = (await executeIsolatedWeeklyPlanningTurn(payload, client)).result;
    expect(next.failure, JSON.stringify(next)).toBeUndefined();
    expect(next.draftCandidates.length, JSON.stringify(next)).toBeGreaterThan(0);
    expect(next.state.status).toBe('draft_ready');
    expect(next.state.shouldSavePlan).toBe(false);
    expect(next.stableV5Graph?.effortEstimates).toEqual(before.effortEstimates);
    expect(next.stableV5Graph?.workloads).toEqual(before.workloads);
    expect(next.stableV5Graph?.uncertainties).toEqual(before.uncertainties);
    expect(requests.filter(r => r.responseFormat?.json_schema.name === 'weekly_planning_provisional_allocation')).toHaveLength(1);
  });
});
