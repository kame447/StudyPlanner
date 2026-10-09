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

function proposals(conversation: ScriptedConversation) {
  return conversation.getState().intakeState?.learningStrategyProposalRecords ?? [];
}

describe('X2 boundaries', () => {
  it('a consultation turn without planning content keeps the presented proposal held', async () => {
    install((text, call) => text === X2.T1 ? x2Script(text, call)
      : emptyDocument({ conversationActs: [{ kind: 'consultation_request', targetPublicId: null }] }));
    const conversation = open();
    await conversation.submit(X2.T1);
    await conversation.submit(X2.T2);
    expect(proposals(conversation)[0]).toMatchObject({ status: 'pending', decidedAtTurnId: null });
  });

  it.each(['empty_reading', 'ack_shell', 'ack_shell_with_answer_act'] as const)('%s leaves the presented proposal open and re-presented', async shape => {
    install((text, call) => {
      if (text === X2.T1) return x2Script(text, call);
      const [vocab] = summaryTaskIds(call);
      return shape === 'empty_reading' ? emptyDocument()
        : emptyDocument({
          tasks: [studyTask({ localId: 'vocab', existingPublicId: vocab, title: '英単語', activityKind: 'memorization_retrieval', sourceText: 'うん、それでお願い' })],
          ...(shape === 'ack_shell_with_answer_act' ? { conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] } : {}),
        });
    });
    const conversation = open();
    await conversation.submit(X2.T1);
    // A shell may be recovered as an unusable turn; either way the machine state stays held.
    const second = await conversation.submit('うん、それでお願い');
    expect(proposals(conversation)[0]).toMatchObject({ status: 'pending', decidedAtTurnId: null });
    expect(second.result?.draftCandidates).toEqual([]);
  });

  it('after a lapse the required question that the proposal was hiding is asked, and the preview stays blocked', async () => {
    install((text, call) => {
      if (text !== X2.T1) return x2Script(text, call);
      const document = x2Script(text, call);
      // 物理 without its per-problem rate: a required effort question coexists with the proposal.
      (document.tasks as Json[])[1].effortEstimates = [];
      return document;
    });
    const conversation = open();
    await conversation.submit(X2.T1);
    expect(questionSlot(conversation)).toBe('stable_v5:learning_strategy_proposal');
    const second = await conversation.submit(X2.T2);
    expect(second.result?.failure).toBeUndefined();
    expect(questionSlot(conversation)).toBe('stable_v5:missing_effort_estimate');
    expect(second.result?.draftCandidates).toEqual([]);
  });

  it('a later accept of the lapsed proposal is neither a silent acceptance nor a decline, and the model is not shown it', async () => {
    let lapsedId = '';
    install((text, call) => {
      if (text === X2.T1 || text === X2.T2) return x2Script(text, call);
      return emptyDocument({ decisions: [{ localId: 'd', target: { kind: 'proposal', publicId: lapsedId, localId: null, mention: null },
        decision: 'accept', sourceText: X2.T3 }] });
    });
    const conversation = open();
    await conversation.submit(X2.T1);
    lapsedId = proposals(conversation)[0].id;
    await conversation.submit(X2.T2);
    const third = await conversation.submit(X2.T3);
    const generic = third.calls.filter(call => call.kind === 'semantic_generic');
    expect(generic.length).toBeGreaterThan(0);
    // The first request is the model context; a later repair request only echoes the model's own answer.
    expect(JSON.stringify(generic[0].messages)).not.toContain(lapsedId);
    expect(proposals(conversation)[0]).toMatchObject({ status: 'pending', decidedAtTurnId: expect.any(String) });
    // The scripted accept is not applied: no record is accepted, and no state or draft reports acceptance.
    expect(proposals(conversation).every(record => record.status !== 'accepted')).toBe(true);
    expect(third.result?.state.learningStrategyProposalRecords?.every(record => record.status !== 'accepted')).toBe(true);
  });

  it('legacy_v5 keeps the pending gate (no lapse)', async () => {
    install((text, call) => x2Script(text, call, 'legacy_v5'));
    const conversation = open('legacy_v5');
    await conversation.submit(X2.T1);
    await conversation.submit(X2.T2);
    expect(questionSlot(conversation)).toBe('stable_v5:learning_strategy_proposal');
    expect(proposals(conversation)[0]).toMatchObject({ status: 'pending', decidedAtTurnId: null });
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
  T2: 'あ、やっぱり25ページで、1ページ3分のまま。あとこれって1日でまとめて読んでも平気？',
  T3: 'じゃあ水曜の夜にまとめて',
};

describe('known structural fields ignore blocksPlanning (readiness is deterministic)', () => {
  it.each([
    { field: 'material_identity', flag: false }, { field: 'material_identity', flag: true },
    { field: 'work_breakdown', flag: false }, { field: 'work_breakdown', flag: true },
  ] as const)('$field with blocksPlanning=$flag keeps the question and shows no preview', async ({ field, flag }) => {
    install(() => emptyDocument({
      planningIntent: 'create_plan', planningWindow: nextWeek,
      tasks: [studyTask({ localId: 'chem', title: '化学の参考書', activityKind: 'other', sourceText: '化学の参考書を進めたい',
        decompositionStatus: 'needs_breakdown', components: [] })],
      uncertainties: [{ localId: 'u', targetLocalId: 'chem', field, reason: '未確定', sourceText: '化学の参考書', blocksPlanning: flag }],
    }));
    const conversation = open();
    const turn = await conversation.submit('来週、化学の参考書を進めたい');
    expect(turn.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties.filter(u => u.field === field)).toHaveLength(1);
    expect(questionSlot(conversation)).toBe('stable_v5:semantic_uncertainty');
    expect(turn.result?.draftCandidates).toEqual([]);
  });
});

describe('H: a consultation is not a blocking uncertainty unless the model declares that it blocks', () => {
  function installH(blocksPlanning: boolean | undefined, architecture: WeeklyPlanningConversationArchitecture = 'interaction_v1') {
    install((text, call) => {
      const [taskId] = summaryTaskIds(call);
      if (text === H.T1) {
        return emptyDocument({
          planningIntent: 'create_plan', planningWindow: nextWeek,
          tasks: [studyTask({ localId: 'paper', title: 'レポートの文献', activityKind: 'reading', sourceText: '文献を30ページ読む',
            workloads: [workload('paper-amount', 30, 'page', 'ページ', '30ページ')],
            effortEstimates: [perUnit('paper-rate', 'paper-amount', 3, 'page', '1ページ3分')] })],
        }, architecture);
      }
      if (text === H.T2) {
        return emptyDocument({
          tasks: [studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: 'やっぱり25ページで',
            workloads: [workload('paper-amount-2', 25, 'page', 'ページ', '25ページ')],
            effortEstimates: [perUnit('paper-rate-2', 'paper-amount-2', 3, 'page', '1ページ3分')] })],
          uncertainties: [{ localId: 'u-one-day', targetLocalId: 'paper', field: 'one_day_completion_feasibility',
            reason: '1日でまとめて読めるか', sourceText: 'あとこれって1日でまとめて読んでも平気？',
            ...(blocksPlanning === undefined ? {} : { blocksPlanning }) }],
          conversationActs: [{ kind: 'consultation_request', targetPublicId: taskId }],
        }, architecture);
      }
      return emptyDocument({
        tasks: [studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: '水曜の夜にまとめて',
          temporalConstraints: [preferredNight('paper-night', 'paper', '水曜の夜にまとめて')] })],
        conversationActs: [{ kind: 'answer_pending_question', targetPublicId: taskId }],
      }, architecture);
    });
  }

  it('blocksPlanning:false creates no question or block: the consultation is honoured and the preview is updated', async () => {
    installH(false);
    const conversation = open();
    const first = await conversation.submit(H.T1);
    expect(first.result?.draftCandidates.length).toBeGreaterThan(0);
    const second = await conversation.submit(H.T2);
    expect(second.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties).toEqual([]);
    expect(questionSlot(conversation)).not.toBe('stable_v5:semantic_uncertainty');
    expect(second.result?.draftCandidates.length).toBeGreaterThan(0);
    const third = await conversation.submit(H.T3);
    expect(third.result?.failure).toBeUndefined();
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
  });

  it.each([true, undefined])('control: blocksPlanning=%s keeps the uncertainty blocking (the flag is the switch)', async flag => {
    installH(flag);
    const conversation = open();
    await conversation.submit(H.T1);
    const second = await conversation.submit(H.T2);
    expect(second.result?.failure).toBeUndefined();
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties).toHaveLength(1);
    expect(questionSlot(conversation)).toBe('stable_v5:semantic_uncertainty');
    expect(second.result?.draftCandidates).toEqual([]);
  });
});

describe('H-release: a blocking free-form question has a deterministic end state', () => {
  const Q = 'あとこれって1日でまとめて読んでも平気？';
  const L1 = `${H.T1}。英語の本も10ページ読む。1ページ3分`;
  type Variant = 'placement_task' | 'placement_uncertainty' | 'ack_task' | 'ack_uncertainty' | 'other_target' | 'rate_only'
    | 'unbound' | 're_declare' | 'two_uncertainties' | 'replayed_constraint' | 'capacity';
  const uncertaintyOf = (extra: Json = {}): Json => ({ localId: 'u-one-day', targetLocalId: 'paper', field: 'one_day_completion_feasibility',
    reason: '1日でまとめて読めるか', sourceText: Q, ...extra });
  function installLoop(variant: Variant, o: { flag?: boolean; field?: string; architecture?: WeeklyPlanningConversationArchitecture } = {}) {
    const architecture = o.architecture ?? 'interaction_v1';
    const script = (text: string, call: ScriptedProviderCall): Json => {
      const [taskId, vocabId] = summaryTaskIds(call);
      const summary = (call.payload?.publicStateSummary ?? {}) as Json;
      const uncertaintyId = String(((summary.uncertainties ?? []) as Json[])[0]?.publicId ?? 'none');
      const paperShell = (extra: Json = {}) => studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: text, ...extra });
      if (text === L1) {
        return emptyDocument({
          planningIntent: 'create_plan', planningWindow: nextWeek,
          tasks: [
            studyTask({ localId: 'paper', title: 'レポートの文献', activityKind: 'reading', sourceText: '文献を30ページ読む',
              workloads: [workload('paper-amount', 30, 'page', 'ページ', '30ページ')], effortEstimates: [perUnit('paper-rate', 'paper-amount', 3, 'page', '1ページ3分')] }),
            studyTask({ localId: 'vocab', title: '英語の本', activityKind: 'reading', sourceText: '英語の本も10ページ読む',
              workloads: [workload('vocab-amount', 10, 'page', 'ページ', '10ページ')], effortEstimates: [perUnit('vocab-rate', 'vocab-amount', 3, 'page', '1ページ3分')] }),
          ],
        }, architecture);
      }
      if (text === H.T2) {
        return emptyDocument({
          tasks: [studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: 'やっぱり25ページで',
            workloads: [workload('paper-amount-2', variant === 'capacity' ? 5000 : 25, 'page', 'ページ', '25ページ')],
            effortEstimates: [perUnit('paper-rate-2', 'paper-amount-2', 3, 'page', '1ページ3分')],
            ...(variant === 'replayed_constraint' ? { temporalConstraints: [preferredNight('paper-night-old', 'paper', 'まとめて読んでも')] } : {}) })],
          uncertainties: [
            uncertaintyOf({ field: o.field ?? 'one_day_completion_feasibility', ...(o.flag === undefined ? {} : { blocksPlanning: o.flag }) }),
            ...(variant === 'two_uncertainties' ? [uncertaintyOf({ localId: 'u-second', field: 'second_free_form_point', sourceText: 'まとめて読んでも平気' })] : []),
          ],
          conversationActs: [{ kind: 'consultation_request', targetPublicId: taskId }],
        }, architecture);
      }
      if (text === T4) {
        return emptyDocument({
          tasks: [
            studyTask({ localId: 'vocab', existingPublicId: vocabId, title: '英語の本', activityKind: 'reading', sourceText: text, temporalConstraints: [preferredNight('vocab-thu', 'vocab', text)] }),
            studyTask({ localId: 'paper', existingPublicId: taskId, title: 'レポートの文献', activityKind: 'reading', sourceText: text }),
          ],
          // The model recalls the released point from history: the quote is T2's, not this turn's.
          uncertainties: [uncertaintyOf({ targetLocalId: 'paper' })],
        }, architecture);
      }
      const answer = (target: string | null) => ({ kind: 'answer_pending_question', targetPublicId: target });
      switch (variant) {
        case 'ack_task': return emptyDocument({ conversationActs: [answer(taskId)] }, architecture);
        case 'ack_uncertainty': return emptyDocument({ conversationActs: [answer(uncertaintyId)] }, architecture);
        case 'placement_uncertainty': return emptyDocument({ tasks: [paperShell({ temporalConstraints: [preferredNight('paper-night', 'paper', text)] })], conversationActs: [answer(uncertaintyId)] }, architecture);
        case 'other_target': return emptyDocument({ tasks: [studyTask({ localId: 'vocab', existingPublicId: vocabId, title: '英単語', activityKind: 'memorization_retrieval', sourceText: text, temporalConstraints: [preferredNight('vocab-night', 'vocab', text)] })], conversationActs: [answer(taskId)] }, architecture);
        case 'rate_only': return emptyDocument({ tasks: [paperShell({ effortEstimates: [{ localId: 'paper-session', targetLocalId: 'paper', kind: 'session_duration', minutes: 60, unitCode: 'session', precision: 'approximate', sourceText: text }] })], conversationActs: [answer(taskId)] }, architecture);
        case 'unbound': return emptyDocument({ tasks: [paperShell({ temporalConstraints: [preferredNight('paper-night', 'paper', text)] })], conversationActs: [answer(null)] }, architecture);
        case 're_declare': return emptyDocument({ tasks: [paperShell({ temporalConstraints: [preferredNight('paper-night', 'paper', text)] })], uncertainties: [uncertaintyOf()], conversationActs: [answer(taskId)] }, architecture);
        default: return emptyDocument({ tasks: [paperShell({ temporalConstraints: [preferredNight('paper-night', 'paper', text)] })], conversationActs: [answer(taskId)] }, architecture);
      }
    };
    install((text, call) => {
      const doc = script(text, call);
      if (architecture === 'legacy_v5') delete doc.conversationActs;
      return doc;
    });
  }
  const uncertainties = (c: ScriptedConversation) => createWeeklyPlanningActiveSchedulerGraphViewV5(c.graph()!).uncertainties;
  const T4 = '英語の本は木曜の夜に';
  const RELEASED = `「${Q}」については未確定のまま進めます。`;
  const NOTHING_READ = 'この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。';
  async function toThirdTurn(variant: Variant, o: Parameters<typeof installLoop>[1] = {}, t3 = '水曜の夜にまとめて') {
    installLoop(variant, o);
    const conversation = open(o.architecture);
    await conversation.submit(L1);
    const second = await conversation.submit(H.T2);
    const third = await conversation.submit(t3);
    return { conversation, second, third };
  }

  it.each([undefined, true])('flag=%s: a typed answer bound to the presented question releases it and the preview returns', async flag => {
    const { conversation, second, third } = await toThirdTurn('placement_task', { flag });
    expect(second.result?.draftCandidates).toEqual([]);
    expect(third.result?.failure).toBeUndefined();
    expect(uncertainties(conversation)).toEqual([]);
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
  });
  it.each(['ack_task'] as const)('%s (「うん、それで」: no delta anywhere) releases, discloses the point in the user\'s own words, and the decision carries the fact', async variant => {
    const { conversation, third } = await toThirdTurn(variant, {}, variant.startsWith('ack') ? 'うん、それで' : '水曜の夜にまとめて');
    expect(uncertainties(conversation)).toEqual([]);
    expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
    expect(third.result?.message).toContain(`${RELEASED}${NOTHING_READ}`);
    expect(third.result?.message).not.toContain('仮予定を作りました');
    expect(third.result?.communicationFacts?.uncertaintyReleased).toMatchObject({ quote: Q, count: 1, nothingRead: true });
    const decision = third.calls.filter(call => call.kind === 'renderer').pop()?.payload?.applicationDecision as Json;
    expect((decision.communication as Json).uncertaintyReleased).toEqual({ quote: Q, nothingRead: true });
    expect(JSON.stringify(third.calls.filter(call => call.kind === 'renderer').pop()?.messages)).toContain('uncertaintyReleased: The app states');
  });
  it('the no-delta release rides the existing bounded no-op retry (3 semantic reads, no extra call)', async () => {
    const { third } = await toThirdTurn('ack_task', {}, 'うん、それで');
    expect(third.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(3);
    expect(third.calls.filter(call => call.kind === 'renderer')).toHaveLength(1);
  });
  it('a release turn is the only one with the sentence; the lifecycle key is a release, not a resolution', async () => {
    const { second, third, conversation } = await toThirdTurn('placement_task');
    expect(second.result?.message).not.toContain('未確定のまま進めます');
    expect(third.result?.message).toContain(RELEASED);
    expect(third.result?.message).not.toContain(NOTHING_READ);
    const keys = conversation.graph()!.appliedLifecycleOperationKeys;
    expect(keys.some(key => key.includes(':released-free-form-uncertainty:'))).toBe(true);
    expect(keys.some(key => key.includes(':resolved-work-breakdown:'))).toBe(false);
    expect(third.result?.communicationFacts?.uncertaintyReleased?.count).toBe(1);
  });

  describe('stays open', () => {
    it.each(['other_target', 'rate_only', 'unbound', 're_declare', 'placement_uncertainty', 'ack_uncertainty', 'replayed_constraint'] as const)('%s: no release, no preview', async variant => {
      // An act binds only to a task/component: an uncertainty id degrades to an unbound act by contract (live: all acts task-bound).
      const { conversation, third } = await toThirdTurn(variant, {}, variant === 'rate_only' ? '1回1時間で' : variant.startsWith('ack') ? 'うん、それで' : '水曜の夜にまとめて');
      expect(uncertainties(conversation).length).toBeGreaterThanOrEqual(1);
      expect(third.result?.draftCandidates).toEqual([]);
      expect(third.result?.message ?? '').not.toContain('未確定のまま進めます');
      expect(third.result?.communicationFacts?.uncertaintyReleased).toBeUndefined();
    });
    it.each(['material_identity', 'work_breakdown'])('known field %s with a bound placement answer keeps the question', async field => {
      const { conversation, third } = await toThirdTurn('placement_task', { field });
      expect(uncertainties(conversation).filter(u => u.field === field)).toHaveLength(1);
      expect(third.result?.draftCandidates).toEqual([]);
      expect(third.result?.communicationFacts?.uncertaintyReleased).toBeUndefined();
    });
    it('two free-form uncertainties on one task: only the presented one is released', async () => {
      const { conversation, third } = await toThirdTurn('two_uncertainties');
      const remaining = uncertainties(conversation);
      expect(remaining).toHaveLength(1);
      expect(third.result?.communicationFacts?.uncertaintyReleased?.count ?? 0).toBeLessThanOrEqual(1);
    });
    it('legacy_v5 is untouched: no release operation, no release fact (the legacy resolution path is unchanged)', async () => {
      const { conversation, third } = await toThirdTurn('placement_task', { architecture: 'legacy_v5' });
      expect(conversation.graph()!.appliedLifecycleOperationKeys.some(key => key.includes('released-free-form-uncertainty'))).toBe(false);
      expect(third.result?.communicationFacts).toBeUndefined();
      expect(third.result?.message ?? '').not.toContain('未確定のまま進めます');
    });
    it('re-raise (the user): a later turn whose own text carries the quote blocks again as today', async () => {
      installLoop('placement_task');
      const conversation = open();
      await conversation.submit(L1);
      await conversation.submit(H.T2);
      await conversation.submit('水曜の夜にまとめて');
      expect(uncertainties(conversation)).toEqual([]);
      await conversation.submit(H.T2);
      expect(uncertainties(conversation)).toHaveLength(1);
    });
    it('re-raise (the model, from history): an unrelated turn whose reading re-declares the released point from the old quote stays released and the update applies', async () => {
      installLoop('placement_task');
      const conversation = open();
      await conversation.submit(L1);
      await conversation.submit(H.T2);
      await conversation.submit('水曜の夜にまとめて');
      const fourth = await conversation.submit(T4);
      expect(fourth.result?.failure).toBeUndefined();
      expect(uncertainties(conversation)).toEqual([]);
      expect(questionSlot(conversation)).not.toBe('stable_v5:semantic_uncertainty');
      expect(fourth.result?.draftCandidates.length).toBeGreaterThan(0);
      expect(fourth.result?.message).not.toContain('意味を一つに決められませんでした');
      expect(JSON.stringify(fourth.debugTrace)).toContain('released-uncertainty-not-reraised:1');
      const view = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
      expect(view.temporalConstraints.some(constraint => constraint.taskId !== view.tasks.find(t => t.title === 'レポートの文献')?.id)).toBe(true);
    });
  });

  describe('the sentence states the release, never a plan (both outcomes pinned)', () => {
    it('another question follows: the release is stated, no plan is claimed', async () => {
      const { third } = await toThirdTurn('two_uncertainties');
      expect(third.result?.draftCandidates).toEqual([]);
      expect(third.result?.message).toContain(RELEASED);
      expect(third.result?.message).not.toContain('仮予定を作りました');
      expect(third.result?.message).toContain('意味を一つに決められませんでした');
    });
    it('no capacity follows: the release is stated beside the shortfall, no plan is claimed', async () => {
      const { third } = await toThirdTurn('capacity');
      expect(third.result?.draftCandidates).toEqual([]);
      expect(third.result?.message).toContain(RELEASED);
      expect(third.result?.message).not.toContain('仮予定を作りました');
      expect(third.result?.communicationFacts?.uncertaintyReleased).toBeDefined();
    });
  });

  describe('a no-delta release never hides a dropped condition (critic 33a)', () => {
    it('「うん、それで。あと金曜は無理」 with every read dropping the condition: released, the plan applies, and the reply says nothing new was read', async () => {
      const { conversation, third } = await toThirdTurn('ack_task', {}, 'うん、それで。あと金曜は無理');
      expect(uncertainties(conversation)).toEqual([]);
      expect(third.result?.draftCandidates.length).toBeGreaterThan(0);
      expect(third.result?.message).toContain(`${RELEASED}${NOTHING_READ}`);
      expect(third.result?.communicationFacts?.uncertaintyReleased?.nothingRead).toBe(true);
    });
    it('a placement-delta release does not claim that nothing was read', async () => {
      const { third } = await toThirdTurn('placement_task');
      expect(third.result?.communicationFacts?.uncertaintyReleased?.nothingRead).toBe(false);
    });
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
