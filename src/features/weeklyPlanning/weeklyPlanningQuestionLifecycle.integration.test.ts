import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedConversation,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import type { WeeklyPlanningConversationArchitecture } from './weeklyPlanningConversationArchitecture';

/*
 * Issue #488 round-4 blockers X1/X2/X3/H: a question the user never has to answer, or one no
 * structural answer can resolve, must not loop or hold the preview. The live typed shapes are
 * replayed through the production controller with a scripted transport and synthetic titles.
 */
type Json = Record<string, unknown>;

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

function emptyDocument(overrides: Json = {}, architecture: WeeklyPlanningConversationArchitecture = 'interaction_v1'): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
    ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}), ...overrides,
  };
}

const nextWeek = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };

function workload(localId: string, amount: number, unitCode: string, unitLabel: string, sourceText: string, quantityRole = 'target'): Json {
  return { localId, quantityRole, amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText };
}

function perUnit(localId: string, target: string, minutes: number, unitCode: string, sourceText: string): Json {
  return { localId, targetLocalId: target, kind: 'duration_per_unit', minutes, unitCode, precision: 'approximate', sourceText };
}

function studyTask(params: {
  localId: string; existingPublicId?: string | null; title: string; activityKind: string; sourceText: string;
  components?: Json[]; workloads?: Json[]; effortEstimates?: Json[]; temporalConstraints?: Json[]; decompositionStatus?: string;
}): Json {
  return {
    localId: params.localId, existingPublicId: params.existingPublicId ?? null,
    decompositionStatus: params.decompositionStatus ?? 'atomic', category: 'study', title: params.title,
    study: { purpose: 'self_study', activityKind: params.activityKind, contextLabel: null, components: params.components ?? [] },
    workloads: params.workloads ?? [], effortEstimates: params.effortEstimates ?? [],
    temporalConstraints: params.temporalConstraints ?? [], recurrence: [], durableContextSignals: [], sourceText: params.sourceText,
  };
}

function preferredNight(localId: string, target: string, sourceText: string): Json {
  return {
    localId, targetLocalId: target, kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null,
    namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'unspecified', sourceText,
  };
}

function summaryTaskIds(call: ScriptedProviderCall): string[] {
  const summary = (call.payload?.publicStateSummary ?? {}) as Json;
  return ((summary.tasks ?? []) as Json[]).map(task => String(task.publicId));
}

function renderer(call: ScriptedProviderCall): string {
  return scriptedRendererReply(call, 'わかりました。');
}

function install(script: (text: string, call: ScriptedProviderCall) => Json): void {
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return renderer(call);
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') {
      return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    }
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') {
      return JSON.stringify({
        decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null,
        minutes: null, precision: null, sourceText: null, effortSourceText: null,
      });
    }
    return JSON.stringify(script(String(call.payload?.userText ?? ''), call));
  });
}

function open(architecture: WeeklyPlanningConversationArchitecture = 'interaction_v1'): ScriptedConversation {
  return createScriptedConversation({ provider, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-08T00:00:00.000Z' });
}

function questionSlot(conversation: ScriptedConversation): string | undefined {
  return conversation.getState().intakeState?.lastQuestionContext?.targetSlot;
}

const X2 = {
  T1: '来週、英単語を毎日30分ずつと、物理の問題集を15問やりたい。物理は1問6分くらい',
  T2: '英単語は夜にやることにしたい',
  T3: '物理は木曜日までに終わらせたい',
};

function x2Script(text: string, call: ScriptedProviderCall, architecture: WeeklyPlanningConversationArchitecture = 'interaction_v1'): Json {
  const [vocab, physics] = summaryTaskIds(call);
  if (text === X2.T1) {
    return emptyDocument({
      planningIntent: 'create_plan', planningWindow: nextWeek,
      tasks: [
        studyTask({ localId: 'vocab', title: '英単語', activityKind: 'memorization_retrieval', sourceText: '英単語を毎日30分ずつ',
          workloads: [workload('vocab-amount', 210, 'minute', '分', '毎日30分ずつ')] }),
        studyTask({ localId: 'phys', title: '物理の問題集', activityKind: 'problem_solving', sourceText: '物理の問題集を15問',
          workloads: [workload('phys-amount', 15, 'problem', '問', '15問')],
          effortEstimates: [perUnit('phys-rate', 'phys-amount', 6, 'problem', '1問6分')] }),
      ],
    }, architecture);
  }
  if (text === X2.T2) {
    return emptyDocument({ tasks: [studyTask({ localId: 'vocab', existingPublicId: vocab, title: '英単語', activityKind: 'memorization_retrieval',
      sourceText: '英単語は夜に', temporalConstraints: [preferredNight('vocab-night', 'vocab', '夜に')] })] }, architecture);
  }
  return emptyDocument({ tasks: [studyTask({ localId: 'phys', existingPublicId: physics, title: '物理の問題集', activityKind: 'problem_solving',
    sourceText: '物理は木曜日までに', temporalConstraints: [preferredNight('phys-night', 'phys', '木曜日までに')] })] }, architecture);
}

describe('X2: an optional learning-strategy proposal that the user does not take up ends', () => {
  it('reaches a preview within the turn after the proposal was presented', async () => {
    install((text, call) => x2Script(text, call));
    const conversation = open();
    const first = await conversation.submit(X2.T1);
    expect(first.result?.failure).toBeUndefined();
    expect(questionSlot(conversation)).toBe('stable_v5:learning_strategy_proposal');
    expect(first.result?.draftCandidates).toEqual([]);

    const second = await conversation.submit(X2.T2);
    expect(second.result?.failure).toBeUndefined();
    expect(questionSlot(conversation)).not.toBe('stable_v5:learning_strategy_proposal');
    expect(second.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(second.result?.state.shouldSavePlan).not.toBe(true);
  });
});

const X3 = {
  T1: '来週、化学の参考書を進めたいんだけど、どのくらい時間がかかるか見当がつかない',
  T2: 'ふつう1章ってどれくらいかかるもの？',
  T3: 'じゃあ3章ぶん、1章40分で見ておく',
};

describe('X3: work_breakdown is answered by a content quantity on the existing material component', () => {
  it('retires the question and reaches a preview', async () => {
    install((text, call) => {
      const [taskId] = summaryTaskIds(call);
      const summary = (call.payload?.publicStateSummary ?? {}) as Json;
      const componentId = String((((summary.components ?? []) as Json[])[0]?.publicId) ?? '');
      const material = (workloads: Json[]): Json => ({
        localId: 'chem-material', existingPublicId: componentId, parentLocalId: null, role: 'material', label: '化学の参考書',
        workloads, durableContextSignals: [], sourceText: '化学の参考書',
      });
      if (text === X3.T1) {
        return emptyDocument({
          planningIntent: 'create_plan', planningWindow: nextWeek,
          tasks: [studyTask({ localId: 'chem', title: '化学の参考書', activityKind: 'other', sourceText: '化学の参考書を進めたい',
            decompositionStatus: 'needs_breakdown', components: [{ ...material([]), existingPublicId: null }] })],
          uncertainties: [
            { localId: 'u-effort', targetLocalId: 'chem', field: 'workload_and_effort', reason: '作業量と所要時間が未確定', sourceText: 'どのくらい時間がかかるか' },
            { localId: 'u-breakdown', targetLocalId: 'chem', field: 'work_breakdown', reason: 'task constituents are not yet identified for planning', sourceText: '化学の参考書を進めたい' },
          ],
        });
      }
      if (text === X3.T2) return emptyDocument({ conversationActs: [{ kind: 'consultation_request', targetPublicId: null }] });
      return emptyDocument({
        tasks: [studyTask({ localId: 'chem', existingPublicId: taskId, title: '化学の参考書', activityKind: 'other', sourceText: '3章ぶん、1章40分',
          decompositionStatus: 'needs_breakdown',
          components: [material([workload('chapters', 3, 'chapter', '章', '3章ぶん')])],
          effortEstimates: [perUnit('chapter-rate', 'chapters', 40, 'chapter', '1章40分')] })],
        conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }],
      });
    });
    const conversation = open();
    await conversation.submit(X3.T1);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties.some(u => u.field === 'work_breakdown')).toBe(true);
    await conversation.submit(X3.T2);
    const third = await conversation.submit(X3.T3);
    expect(third.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties.filter(u => u.field === 'work_breakdown')).toEqual([]);
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
  });
});

describe('X3 negatives: only the matching dimension retires a required question (B lesson)', () => {
  it.each([
    { field: 'work_breakdown', answer: 'rate_only' },
    { field: 'material_identity', answer: 'content_quantity' },
    { field: 'work_breakdown', answer: 'replayed_workload' },
  ] as const)('$answer does not retire $field', async ({ field, answer }) => {
    install((text, call) => {
      const [taskId] = summaryTaskIds(call);
      const summary = (call.payload?.publicStateSummary ?? {}) as Json;
      const componentId = String((((summary.components ?? []) as Json[])[0]?.publicId) ?? '');
      const material = (workloads: Json[]): Json => ({
        localId: 'chem-material', existingPublicId: componentId, parentLocalId: null, role: 'material', label: '化学の参考書',
        workloads, durableContextSignals: [], sourceText: '化学の参考書',
      });
      if (text !== X3.T3) {
        return emptyDocument({
          planningIntent: 'create_plan', planningWindow: nextWeek,
          tasks: [studyTask({ localId: 'chem', title: '化学の参考書', activityKind: 'other', sourceText: '化学の参考書',
            decompositionStatus: 'needs_breakdown',
            components: [{ ...material(answer === 'replayed_workload' ? [workload('chapters', 3, 'chapter', '章', '3章ぶん')] : []), existingPublicId: null }] })],
          uncertainties: [{ localId: 'u', targetLocalId: 'chem', field, reason: '未確定', sourceText: '化学の参考書' }],
        });
      }
      return emptyDocument({
        tasks: [studyTask({ localId: 'chem', existingPublicId: taskId, title: '化学の参考書', activityKind: 'other',
          sourceText: answer === 'rate_only' ? '1章40分' : '3章ぶん', decompositionStatus: 'needs_breakdown',
          // The identical workload restated without any existing id is a replay, not new structure.
          components: answer !== 'rate_only' ? [material([workload('chapters', 3, 'chapter', '章', '3章ぶん')])] : [],
          effortEstimates: answer === 'rate_only' ? [perUnit('rate', 'chem', 40, 'chapter', '1章40分')] : [] })],
      });
    });
    const conversation = open();
    await conversation.submit(answer === 'replayed_workload' ? '来週、化学の参考書を3章ぶん進めたいけど、どう分けるか決めていない' : X3.T1);
    const turn = await conversation.submit(X3.T3);
    expect(turn.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties.filter(u => u.field === field)).toHaveLength(1);
    expect(turn.result?.draftCandidates).toEqual([]);
  });
});

const H = {
  T1: '来週、レポートの文献を30ページ読む。1ページ3分くらい',
  T2: 'あ、やっぱり25ページで。あとこれって1日でまとめて読んでも平気？',
  T3: 'じゃあ水曜の夜にまとめて',
};

describe('H: a consultation never becomes a blocking uncertainty that no answer can resolve', () => {
  it('a typed answer bound to the consultation target closes it and the preview returns', async () => {
    install((text, call) => {
      const [taskId] = summaryTaskIds(call);
      if (text === H.T1) {
        return emptyDocument({
          planningIntent: 'create_plan', planningWindow: nextWeek,
          tasks: [studyTask({ localId: 'paper', title: 'レポートの文献', activityKind: 'reading', sourceText: '文献を30ページ読む',
            workloads: [workload('paper-amount', 30, 'page', 'ページ', '30ページ')],
            effortEstimates: [perUnit('paper-rate', 'paper-amount', 3, 'page', '1ページ3分')] })],
        });
      }
      if (text === H.T2) {
        return emptyDocument({
          tasks: [studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: 'やっぱり25ページで',
            workloads: [workload('paper-amount-2', 25, 'page', 'ページ', '25ページ')] })],
          uncertainties: [{ localId: 'u-one-day', targetLocalId: 'paper', field: 'one_day_completion_feasibility',
            reason: '1日でまとめて読めるか', sourceText: 'あとこれって1日でまとめて読んでも平気？' }],
          conversationActs: [{ kind: 'consultation_request', targetPublicId: taskId }],
        });
      }
      return emptyDocument({
        tasks: [studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: '水曜の夜にまとめて',
          temporalConstraints: [preferredNight('paper-night', 'paper', '水曜の夜にまとめて')] })],
        conversationActs: [{ kind: 'answer_pending_question', targetPublicId: taskId }],
      });
    });
    const conversation = open();
    const first = await conversation.submit(H.T1);
    expect(first.result?.draftCandidates.length).toBeGreaterThan(0);
    await conversation.submit(H.T2);
    const third = await conversation.submit(H.T3);
    expect(third.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties).toEqual([]);
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
  });
});

const X1 = {
  T1: '来週の予定を整理したい。火曜と木曜は17時から20時までバイトが入ってる',
  T2: '勉強の予定は今回はいらない。それだけ',
  T3: '大丈夫',
};

function shift(localId: string, day: string): Json {
  return {
    localId, existingPublicId: null, decompositionStatus: 'atomic', category: 'non_study', title: 'バイト', study: null,
    workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: 'バイトが入ってる',
    temporalConstraints: [{ localId: `${localId}-time`, targetLocalId: localId, kind: 'fixed_interval', constraintLevel: 'hard',
      dateExpression: day, namedTimePeriod: null, startTime: '17:00', endTime: '20:00', precision: 'exact', sourceText: '17時から20時まで' }],
  };
}

describe('X1: a typed decline closes the optional invitation although fixed commitments were recorded', () => {
  it.each(['decline_additional_work', 'no_act'] as const)('%s ends the question loop', async shape => {
    install(text => text === X1.T1
      ? emptyDocument({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [shift('shift-tue', 'weekday:tuesday'), shift('shift-thu', 'weekday:thursday')] })
      : emptyDocument(shape === 'decline_additional_work' && text === X1.T2 ? { conversationActs: [{ kind: 'decline_additional_work', targetPublicId: null }] } : {}));
    const conversation = open();
    const first = await conversation.submit(X1.T1);
    expect(first.result?.failure).toBeUndefined();
    expect(questionSlot(conversation)).toBe('stable_v5:missing_schedulable_work');
    const second = await conversation.submit(X1.T2);
    expect(second.result?.failure).toBeUndefined();
    if (shape === 'decline_additional_work') {
      expect(questionSlot(conversation)).toBeUndefined();
      expect(second.result?.communicationFacts?.statusReason).not.toBe('fixed_event_manual_entry');
    } else {
      expect(questionSlot(conversation)).toBe('stable_v5:missing_schedulable_work');
    }
  });
});
