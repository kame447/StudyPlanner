import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from './intake/weeklyPlanningQuestionPresentation';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedConversation,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

type Json = Record<string, unknown>;
const SETUP = '来週、数学の問題集を20問進めたい';
const RATE = '1問3分くらい';
const MATERIAL = '青チャートです';
const TOTAL = '合計1時間くらい';
const SESSION = '1回30分くらい';

function document(overrides: Json = {}): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides,
  };
}

function task(existingPublicId: string | null, sourceText: string, overrides: Json = {}): Json {
  return {
    localId: 't', existingPublicId, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
    sourceText, ...overrides,
  };
}

function workload(sourceText: string): Json {
  return {
    localId: 'wl', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText,
  };
}

function summary(call: ScriptedProviderCall): Json {
  return (call.payload?.publicStateSummary ?? {}) as Json;
}

function currentTaskId(call: ScriptedProviderCall): string {
  return ((summary(call).tasks as Json[])[0].publicId as string);
}

function freshness(conversation: ScriptedConversation) {
  const state = conversation.getState();
  return resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: state.intakeState, inputStateRevision: state.revision, messages: state.messages,
    graphRevision: conversation.graph()!.revision,
  });
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let uncertaintyField: string;
let liveTaskShape = false;

beforeEach(() => {
  resetScriptedConversationRuntime();
  liveTaskShape = false;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'どの教材を使いますか？');
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({
      decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null,
    });
    if (call.kind !== 'semantic_generic') return 'unexpected provider call';
    const text = String(call.payload?.userText ?? '');
    if (text === SETUP) return JSON.stringify(document({
      planningIntent: 'create_plan',
      planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
      tasks: [task(null, '数学の問題集を20問進めたい', {
        decompositionStatus: liveTaskShape ? 'needs_breakdown' : 'atomic', workloads: [workload('数学の問題集を20問')],
      })],
      uncertainties: [{ localId: 'u', targetLocalId: 't', field: uncertaintyField, reason: '教材が未確定', sourceText: '数学の問題集' }],
    }));
    if (text === RATE || text === TOTAL || text === SESSION) return JSON.stringify(document({
      planningIntent: 'update_plan',
      // The accepted task/workload identities are context; the only new detail is the rate.
      tasks: [task(currentTaskId(call), text, {
        ...(liveTaskShape ? { study: null } : {}),
        workloads: liveTaskShape ? [] : [workload(text)],
        effortEstimates: [{ localId: `e-${text === RATE ? 'rate' : 'other'}`, targetLocalId: liveTaskShape || text === SESSION ? 't' : 'wl',
          kind: text === RATE ? 'duration_per_unit' : text === TOTAL ? 'total_duration' : 'session_duration',
          minutes: text === RATE ? 3 : text === TOTAL ? 60 : 30,
          unitCode: text === RATE ? 'problem' : null, precision: 'approximate', sourceText: text }],
      })],
      // Even an answer act is only discourse metadata; it cannot close the requirement.
      conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }],
    }));
    if (text === MATERIAL) return JSON.stringify(document({
      planningIntent: 'update_plan',
      tasks: [task(currentTaskId(call), MATERIAL, {
        decompositionStatus: 'decomposed',
        study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [{
          localId: 'material', existingPublicId: null, parentLocalId: null, role: 'material', label: '青チャート',
          workloads: [], durableContextSignals: [], sourceText: '青チャート',
        }] },
      })],
      conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }],
    }));
    return JSON.stringify(document({ conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }] }));
  });
});

afterEach(() => {
  provider.restore();
  resetScriptedConversationRuntime();
});

describe('required clarification remains authoritative across explanation and another detail', () => {
  it.each([
    ...['work_breakdown', 'material_identity', 'material', '教材選択の自由な項目名'].flatMap((field) => [
      { field, otherDetail: null, liveShape: false }, { field, otherDetail: TOTAL, liveShape: false }, { field, otherDetail: SESSION, liveShape: false },
    ]),
    { field: 'material', otherDetail: null, liveShape: true },
  ])('blocks preview until $field is answered (extra detail: $otherDetail, live shape: $liveShape)', async ({ field, otherDetail, liveShape }) => {
    uncertaintyField = field;
    liveTaskShape = liveShape;
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const setup = await conversation.submit(SETUP);
    expect(setup.result?.failure).toBeUndefined();
    const context = conversation.getState().intakeState!.lastQuestionContext!;
    expect(context.targetSlot).toBe('stable_v5:semantic_uncertainty');
    expect(freshness(conversation).status).toBe('fresh');
    const graphBefore = structuredClone(conversation.graph()!);
    const requiredUncertaintyId = graphBefore.uncertainties.find((uncertainty) => uncertainty.field === field)!.id;

    const explanation = await conversation.submit('なんで時間が必要なの？');
    expect(explanation.result?.failure).toBeUndefined();
    expect(explanation.result?.interactionOutcome?.kind).toBe('explain_pending_question');
    const explainedGraph = conversation.graph()!;
    expect({ ...explainedGraph, appliedTurnKeys: [] }).toEqual({ ...graphBefore, appliedTurnKeys: [] });
    expect(explanation.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(conversation.getState().intakeState!.lastQuestionContext!.topicId).toBe(context.topicId);
    expect(freshness(conversation).status).toBe('fresh');

    if (otherDetail) {
      const detail = await conversation.submit(otherDetail);
      expect(detail.result?.failure).toBeUndefined();
      expect(detail.result?.draftCandidates).toHaveLength(0);
      expect(conversation.getState().intakeState!.lastQuestionContext!.topicId).toBe(context.topicId);
      expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).effortEstimates)
        .toContainEqual(expect.objectContaining({
          kind: otherDetail === TOTAL ? 'total_duration' : 'session_duration', minutes: otherDetail === TOTAL ? 60 : 30,
        }));
      expect(freshness(conversation).status).toBe('fresh');
    }

    const rate = await conversation.submit(RATE);
    expect(rate.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(active.uncertainties).toContainEqual(expect.objectContaining({ id: requiredUncertaintyId, field }));
    expect(active.uncertainties).toContainEqual(expect.objectContaining({ id: context.topicId }));
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({
      targetFactId: liveShape ? active.tasks[0].id : active.workloads[0].id, kind: 'duration_per_unit', minutes: 3,
    }));
    expect(active.workloads).toHaveLength(1);
    expect(rate.result?.draftCandidates).toHaveLength(0);
    expect(conversation.getState().draftBlocks).toHaveLength(0);
    expect(conversation.getState().intakeState!.lastQuestionContext!.topicId).toBe(context.topicId);
    expect(freshness(conversation).status).toBe('fresh');
    expect(rate.calls.some((call) => call.kind === 'semantic_focused_contextual')).toBe(false);
    const evaluation = rate.debugTrace.find((event) => event.stage === 'runtime_scheduler_dialogue_evaluated')!.data as Json;
    expect(evaluation.compilation).toMatchObject({ status: 'needs_resolution' });
    expect(evaluation.dialogue).toMatchObject({
      status: 'ask_question', selectedQuestion: { code: 'semantic_uncertainty', factId: context.topicId },
    });

    const material = await conversation.submit(MATERIAL);
    expect(material.result?.failure).toBeUndefined();
    const finalActive = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(finalActive.uncertainties).toHaveLength(0);
    expect(finalActive.components).toContainEqual(expect.objectContaining({ role: 'material', label: '青チャート' }));
    expect(finalActive.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    expect(material.result!.draftCandidates.length).toBeGreaterThan(0);
  });
});
