import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './application/weeklyPlanningStableV5RuntimeSession';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from './intake/weeklyPlanningQuestionPresentation';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedConversation,
  type ScriptedProviderCall,
  type ScriptedProviderReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

/*
 * Issue #488 natural conversation repair. Full turns over the real controller, Stable V5
 * runtime, validators, renderer client and reducer; only the HTTP transport is scripted.
 *
 * These tests protect contracts, not Japanese sentences: which typed goal / purpose the
 * renderer receives, that an explanation is a successful non-mutating turn, that invalid
 * planning content is never applied, and that internal vocabulary never reaches a reply.
 */

type Json = Record<string, unknown>;

/** The measured Computer Use utterances (2026-10-07). */
const SETUP = '来週、数学の問題集を20問進めたい';
const WHY = 'なんで時間が必要なの？';
const STORED_REASON = 'task constituents are not yet identified for planning';
const INTERNAL_PROCESS_WORDING = /予定条件|安全に整理|反映していません|確認中の質問|保留中|構造化|正規化|validation|pending|provider|retry|処理結果/u;

function emptyDocument(overrides: Json = {}): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    conversationActs: [],
    ...overrides,
  };
}

/**
 * The measured setup state: one task with a single material component and a work-breakdown
 * uncertainty, so the fresh pending question is `semantic_uncertainty` (work_breakdown) whose
 * target id is the uncertainty, and whose typed text is the material-progress question that
 * the measured recovery message re-presented.
 */
function breakdownSetupDocument(): Json {
  return emptyDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [{
      localId: 't-math',
      existingPublicId: null,
      decompositionStatus: 'needs_breakdown',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        activityKind: 'problem_solving',
        contextLabel: null,
        components: [{
          localId: 'c-book',
          existingPublicId: null,
          parentLocalId: null,
          role: 'material',
          label: '数学の問題集',
          workloads: [{
            localId: 'wl', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
            rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学の問題集を20問',
          }],
          durableContextSignals: [],
          sourceText: '数学の問題集',
        }],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: SETUP,
    }],
    uncertainties: [{
      localId: 'u', targetLocalId: 't-math', field: 'work_breakdown', reason: STORED_REASON, sourceText: SETUP,
    }],
  });
}

/** An effort-question setup (target workload without effort). */
function effortSetupDocument(planningIntent: 'create_plan' | 'update_plan' = 'create_plan'): Json {
  return emptyDocument({
    planningIntent,
    planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [{
      localId: 't-math',
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'study',
      title: '数学の問題集',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
      workloads: [{
        localId: 'wl-math', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学の問題集を20問',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '数学の問題集を20問進めたい',
    }],
  });
}

function act(kind: string, targetPublicId: string | null = null): Json {
  return { kind, targetPublicId };
}

/** The provider payload of the first user message (the base semantic request), also on repairs. */
function basePayload(call: ScriptedProviderCall): Json {
  const firstUser = call.messages.find((message) => message.role === 'user');
  try {
    return JSON.parse(firstUser?.content ?? '{}') as Json;
  } catch {
    return {};
  }
}

function summaryOf(call: ScriptedProviderCall): Json {
  const summary = basePayload(call).publicStateSummary;
  return typeof summary === 'object' && summary !== null ? summary as Json : {};
}

/**
 * Echoes the renderer contract of the base request. Unlike `scriptedRendererReply`, it also
 * works for a renderer repair call, whose last user message is the repair instruction.
 */
function rendererReplyForBaseRequest(call: ScriptedProviderCall, text: string): string {
  const base = basePayload(call);
  const decision = (base.applicationDecision ?? {}) as Json;
  return JSON.stringify({
    actionId: base.actionId ?? null,
    actionKind: decision.actionKind ?? 'status',
    questionCode: decision.questionCode ?? null,
    groundingAcknowledgement: null,
    text,
  });
}

/** Like `rendererReplyForBaseRequest`, acknowledging every fact accepted in this turn first. */
function acknowledgingRendererReply(call: ScriptedProviderCall, acknowledgement: string, rest: string): string {
  const base = basePayload(call);
  const decision = (base.applicationDecision ?? {}) as Json;
  const grounding = (base.currentTurnGrounding ?? {}) as Json;
  return JSON.stringify({
    actionId: base.actionId ?? null,
    actionKind: decision.actionKind ?? 'status',
    questionCode: decision.questionCode ?? null,
    groundingAcknowledgement: {
      factIds: ((grounding.acceptedFacts ?? []) as Json[]).map((fact) => String(fact.factId)),
      text: acknowledgement,
    },
    text: `${acknowledgement}${rest}`,
  });
}

function englishReadingTask(): Json {
  return {
    localId: 't-english',
    existingPublicId: null,
    decompositionStatus: 'atomic',
    category: 'study',
    title: '英語の長文',
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [{
      localId: 'wl-english', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '英語の長文も10ページ',
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: '英語の長文も10ページやりたい',
  };
}

function rendererDecision(call: ScriptedProviderCall | undefined): Json {
  const decision = call?.payload?.applicationDecision;
  return typeof decision === 'object' && decision !== null ? decision as Json : {};
}

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let script: (call: ScriptedProviderCall) => ScriptedProviderReply | undefined;
let setupDocument: Json;

beforeEach(() => {
  resetScriptedConversationRuntime();
  script = () => undefined;
  setupDocument = breakdownSetupDocument();
  provider = installScriptedWeeklyPlanningProvider((call) => {
    const scripted = script(call);
    if (scripted !== undefined) return scripted;
    if (call.kind === 'renderer') return 'renderer unavailable in fixture';
    if (call.kind === 'semantic_focused_contextual') {
      return JSON.stringify({
        decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null,
      });
    }
    if (call.kind === 'semantic_generic' && basePayload(call).userText === SETUP) return JSON.stringify(setupDocument);
    return JSON.stringify(emptyDocument());
  });
});

afterEach(() => {
  provider.restore();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

function freshness(conversation: ScriptedConversation) {
  const state = conversation.getState();
  return resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: state.intakeState,
    inputStateRevision: state.revision,
    messages: state.messages,
    graphRevision: conversation.graph()?.revision ?? -1,
  }).status;
}

function pendingTarget(conversation: ScriptedConversation) {
  const context = conversation.getState().intakeState?.lastQuestionContext;
  return { targetSlot: context?.targetSlot, topicId: context?.topicId, actionId: context?.actionId };
}

function lastMessage(conversation: ScriptedConversation): string {
  const messages = conversation.getState().messages;
  return messages[messages.length - 1]?.content ?? '';
}

function withoutTurnLedger(conversation: ScriptedConversation) {
  return { ...conversation.graph()!, appliedTurnKeys: [] };
}

async function measuredSetup(): Promise<ScriptedConversation> {
  const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
  await conversation.submit(SETUP);
  expect(pendingTarget(conversation).targetSlot).toBe('stable_v5:semantic_uncertainty');
  expect(freshness(conversation)).toBe('fresh');
  return conversation;
}

describe('Issue #488 naturalness: the measured explanation turn is a normal successful turn', () => {
  it('answers the explanation request under the work-breakdown question with one semantic call and the renderer', async () => {
    const conversation = await measuredSetup();
    const pending = pendingTarget(conversation);
    const graphBefore = withoutTurnLedger(conversation);
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({ conversationActs: [act('ask_about_pending_question')] }));
      }
      if (call.kind === 'renderer') {
        return scriptedRendererReply(call, 'いまは時間より先に、20問がどの問題集のどこなのかを確かめたいんです。どの問題集の、どのあたりの20問ですか？');
      }
      return undefined;
    };
    const why = await conversation.submit(WHY);

    // Not a semantic failure: no repair, no completeness retry, no recovery template.
    expect(why.result?.failure).toBeUndefined();
    expect(why.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(why.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    expect(why.result?.responseSource).toBe('ai');
    // Deterministic WHAT for the renderer: explain why this question is needed, then re-ask it.
    expect(rendererDecision(why.calls[1])).toMatchObject({
      actionKind: 'question',
      questionCode: 'semantic_uncertainty',
      communication: {
        goal: 'explain_question',
        askQuestion: true,
        questionPurposes: ['identify_which_work_and_how_much'],
        planningDetailsNotApplied: false,
      },
      purposeMeanings: { identify_which_work_and_how_much: expect.any(String) },
    });
    // Nothing authoritative changed; the same question stays presented and fresh.
    expect(withoutTurnLedger(conversation)).toEqual(graphBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation)).toBe('fresh');
  });

  it('keeps the act when its topic reference is the pending uncertainty id (degraded, never a rejection)', async () => {
    const conversation = await measuredSetup();
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        const pending = summaryOf(call).pendingQuestion as Json;
        return JSON.stringify(emptyDocument({
          conversationActs: [act('ask_about_pending_question', String(pending.targetFactId))],
        }));
      }
      return undefined;
    };
    const why = await conversation.submit(WHY);

    expect(why.result?.failure).toBeUndefined();
    expect(why.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(why.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    const validation = why.debugTrace.find((event) => event.stage === 'semantic_validation_result');
    expect(validation?.data).toMatchObject({
      accepted: true,
      errors: [],
      conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null }],
      conversationActDiagnostics: ['conversationActs[0].targetPublicId:degraded-unknown-topic'],
    });
  });

  it('continues through a valid explanation act when the planning part stays unusable after the one repair', async () => {
    const conversation = await measuredSetup();
    const pending = pendingTarget(conversation);
    const graphBefore = withoutTurnLedger(conversation);
    script = (call) => {
      if (call.kind !== 'semantic_generic') return undefined;
      const task = (summaryOf(call).tasks as Json[])[0];
      // A restated breakdown uncertainty that copies the stored reason: invalid every time.
      return JSON.stringify(emptyDocument({
        planningIntent: 'update_plan',
        tasks: [{
          localId: 't', existingPublicId: task.publicId, decompositionStatus: 'needs_breakdown', category: 'study',
          title: task.title, study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
          workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: WHY,
        }],
        uncertainties: [{ localId: 'u2', targetLocalId: 't', field: 'work_breakdown', reason: STORED_REASON, sourceText: WHY }],
        conversationActs: [act('ask_about_pending_question')],
      }));
    };
    const why = await conversation.submit(WHY);

    expect(why.result?.failure).toBeUndefined();
    expect(why.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'semantic_generic', 'renderer']);
    expect(why.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    expect(rendererDecision(why.calls[2])).toMatchObject({
      communication: { goal: 'explain_question', planningDetailsNotApplied: true },
    });
    // The invalid planning content was never applied. The pending question is the unclear-detail
    // (semantic_uncertainty) one, whose contextual-answer path also sees this empty rescued turn:
    // the committed graph (revision included) and that uncertainty stay exactly as they were, and
    // the explained question stays the presented, fresh one.
    expect(withoutTurnLedger(conversation)).toEqual(graphBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation)).toBe('fresh');
    const decision = why.debugTrace.find((event) => event.stage === 'semantic_normalizer_decision'
      && (event.data as Json).orchestrationRoute === 'conversation_acts_without_planning_delta');
    expect(decision?.data).toMatchObject({
      status: 'accepted',
      conversationOnly: { planningDelta: 'rejected', planningContentPresent: true },
    });
  });

  it('does not call the renderer after the repair dispatch hit a provider outage; the rescued turn still answers', async () => {
    const conversation = await measuredSetup();
    const pending = pendingTarget(conversation);
    const graphBefore = withoutTurnLedger(conversation);
    let generic = 0;
    script = (call) => {
      if (call.kind !== 'semantic_generic') return undefined;
      generic += 1;
      if (generic > 1) return { failure: 'network' };
      return JSON.stringify(emptyDocument({
        planningIntent: 'update_plan',
        relations: [{ localId: 'r', kind: 'before', fromLocalId: 'x', toLocalId: 'y', sourceText: WHY }],
        conversationActs: [act('ask_about_pending_question')],
      }));
    };
    const why = await conversation.submit(WHY);

    // The same provider just failed: no futile renderer dispatch, the emergency explanation instead.
    expect(why.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'semantic_generic']);
    expect(why.result?.failure).toBeUndefined();
    expect(why.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    expect(why.result?.responseSource).toBe('deterministic_fallback');
    expect(why.result?.dialogueRendererTrace).toMatchObject({
      response: { status: 'fallback', reason: 'dispatch_refused' },
      decision: { branch: 'deterministic_fallback' },
    });
    const message = lastMessage(conversation);
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(INTERNAL_PROCESS_WORDING);
    // Nothing from the rejected planning part was applied; the question stays presented and fresh.
    expect(withoutTurnLedger(conversation)).toEqual(graphBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation)).toBe('fresh');
  });

  it('fails closed on a malformed act: it is dropped and the turn is handled as an ordinary reply', async () => {
    const conversation = await measuredSetup();
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ conversationActs: [{ kind: 'explain_everything', targetPublicId: null }] }))
      : undefined);
    const why = await conversation.submit(WHY);

    expect(why.result?.failure).toBeUndefined();
    expect(why.result?.interactionOutcome).toMatchObject({ kind: 'apply' });
    expect(rendererDecision(why.calls.find((call) => call.kind === 'renderer'))).toMatchObject({
      communication: { goal: 'ask_question' },
    });
    // The empty delta under a pending question gets the bounded completeness retries instead.
    expect(why.calls.filter((call) => call.kind === 'semantic_generic').length).toBeGreaterThan(1);
  });

  it('never lets an explanation act authorize a preview or a save', async () => {
    setupDocument = effortSetupDocument('update_plan');
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ conversationActs: [act('ask_about_pending_question'), act('consultation_request')] }))
      : undefined);
    const turn = await conversation.submit(WHY);

    const state = conversation.getState();
    expect(turn.result?.draftCandidates).toEqual([]);
    expect(state.intakeState?.draftGenerationIntent).toBe('not_requested');
    expect(state.intakeState?.shouldSavePlan).toBe(false);
    expect(state.previewCandidates ?? []).toEqual([]);
    expect(state.pendingApproval).toBeUndefined();
  });
});

describe('Issue #488 naturalness: mixed, stale and foreign references', () => {
  it('keeps both parts of a mixed turn: the new work is taken in and acknowledged before the explanation', async () => {
    setupDocument = effortSetupDocument();
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    const pending = pendingTarget(conversation);
    const acknowledgement = '英語の長文10ページですね。';
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          planningIntent: 'update_plan',
          tasks: [englishReadingTask()],
          conversationActs: [act('ask_about_pending_question')],
        }));
      }
      if (call.kind === 'renderer') {
        return acknowledgingRendererReply(call, acknowledgement,
          'それぞれにかかる時間が分かると、来週の空き時間に無理なく収まるか確かめられます。数学の問題集は1問あたりどれくらいかかりそうですか？');
      }
      return undefined;
    };
    const turn = await conversation.submit('あと英語の長文も10ページやりたい。なんで時間が必要なの？');

    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    const renderer = turn.calls.find((call) => call.kind === 'renderer');
    expect(rendererDecision(renderer)).toMatchObject({
      communication: { goal: 'explain_question', askQuestion: true, planningDetailsNotApplied: false },
    });
    // The planning part is applied and handed over as this turn's accepted facts, which the
    // reply must acknowledge first; the explanation follows.
    expect(conversation.graph()?.tasks.map((task) => task.title)).toEqual(['数学の問題集', '英語の長文']);
    expect(renderer?.payload?.currentTurnGrounding).toMatchObject({
      mode: 'required_before_resume',
      acceptedFacts: expect.arrayContaining([
        expect.objectContaining({ kind: 'task', data: expect.objectContaining({ title: '英語の長文' }) }),
      ]),
    });
    expect(String(renderer?.payload?.request)).toContain('required_before_resume');
    expect(turn.result?.responseSource).toBe('ai');
    expect(lastMessage(conversation).startsWith(acknowledgement)).toBe(true);
    // The question the user asked about stays the presented, fresh one...
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation)).toBe('fresh');

    // ...although, without the explanation request, the new work's question would come first.
    resetScriptedConversationRuntime();
    script = () => undefined;
    const plain = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await plain.submit(SETUP);
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ planningIntent: 'update_plan', tasks: [englishReadingTask()] }))
      : undefined);
    await plain.submit('あと英語の長文も10ページやりたい');
    expect(pendingTarget(plain).targetSlot).toBe(pending.targetSlot);
    expect(pendingTarget(plain).topicId).not.toBe(pending.topicId);
  });

  it('does not bind an explanation act to a question that is no longer on screen', async () => {
    const conversation = await measuredSetup();
    const graphBefore = withoutTurnLedger(conversation);
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ conversationActs: [act('topic_shift')] }))
      : undefined);
    const aside = await conversation.submit('ところで、英語の勉強ってどう進めたらいいかな');
    expect(aside.result?.interactionOutcome).toMatchObject({ kind: 'aside' });
    expect(freshness(conversation)).not.toBe('fresh');

    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ conversationActs: [act('ask_about_pending_question')] }))
      : undefined);
    const why = await conversation.submit(WHY);

    // The held question was not the last thing shown, so the act is not trusted to refer to it:
    // an ordinary turn that simply asks the open question again, which becomes the fresh one.
    expect(why.result?.failure).toBeUndefined();
    expect(why.result?.interactionOutcome).toMatchObject({ kind: 'apply' });
    expect(rendererDecision(why.calls.find((call) => call.kind === 'renderer'))).toMatchObject({
      communication: { goal: 'ask_question', askQuestion: true },
    });
    expect(withoutTurnLedger(conversation)).toEqual(graphBefore);
    expect(pendingTarget(conversation).targetSlot).toBe('stable_v5:semantic_uncertainty');
    expect(freshness(conversation)).toBe('fresh');
    expect(lastMessage(conversation)).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('drops a topic reference that only another conversation knows', async () => {
    const other = createScriptedConversation({ provider, architecture: 'interaction_v1', conversationId: 'issue488-other-chat' });
    await other.submit(SETUP);
    const otherGraph = withoutTurnLedger(other);
    const foreignTaskId = otherGraph.tasks[0].id;
    const conversation = await measuredSetup();
    expect(conversation.graph()?.tasks.map((task) => task.id)).not.toContain(foreignTaskId);
    const graphBefore = withoutTurnLedger(conversation);
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ conversationActs: [act('topic_shift', foreignTaskId)] }))
      : undefined);
    const turn = await conversation.submit('あっちの数学の話なんだけど');

    const validation = turn.debugTrace.find((event) => event.stage === 'semantic_validation_result');
    expect(validation?.data).toMatchObject({
      accepted: true,
      conversationActs: [{ kind: 'topic_shift', targetPublicId: null }],
      conversationActDiagnostics: ['conversationActs[0].targetPublicId:degraded-unknown-topic'],
    });
    // No topic of this conversation is targeted; neither conversation changes.
    expect(turn.result?.interactionOutcome).toMatchObject({ kind: 'aside' });
    expect(withoutTurnLedger(conversation)).toEqual(graphBefore);
    expect(withoutTurnLedger(other)).toEqual(otherGraph);
  });
});

describe('Issue #488 naturalness: typed communication context for ordinary turns', () => {
  it('hands the renderer the accepted numbers to acknowledge before continuing (「1問3分くらい」)', async () => {
    setupDocument = effortSetupDocument();
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    script = (call) => (call.kind === 'semantic_focused_contextual'
      ? JSON.stringify({
          decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
          minutes: 3, precision: 'approximate', quantityRole: null,
        })
      : undefined);
    const answer = await conversation.submit('1問3分くらい');

    const renderer = answer.calls.find((call) => call.kind === 'renderer');
    const grounding = renderer?.payload?.currentTurnGrounding as Json;
    expect(grounding.mode).not.toBe('none');
    expect(JSON.stringify(grounding.acceptedFacts)).toContain('"minutes":3');
    expect(rendererDecision(renderer)).toMatchObject({ communication: { goal: 'present_preview' } });
    // The renderer is no longer primed with a fixed "return to the previous question" phrase.
    expect(String(renderer?.payload?.request)).not.toContain('先ほどの確認に戻る');
  });

  it('reports a ready-to-create status with its typed reason instead of a fixed status sentence', async () => {
    setupDocument = effortSetupDocument('update_plan');
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(SETUP);
    script = (call) => (call.kind === 'semantic_focused_contextual'
      ? JSON.stringify({
          decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
          minutes: 3, precision: 'approximate', quantityRole: null,
        })
      : undefined);
    const answer = await conversation.submit('1問3分');

    expect(answer.result?.draftCandidates).toEqual([]);
    expect(rendererDecision(answer.calls.find((call) => call.kind === 'renderer'))).toMatchObject({
      actionKind: 'status',
      communication: { goal: 'report_status', statusReason: 'ready_to_create_preview' },
    });
    // The fixture renderer is unavailable: the short emergency wording, not the routing sentence.
    const message = lastMessage(conversation);
    expect(message).not.toContain('条件を整理できました');
    expect(message).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('rejects renderer text that talks about the app internals, repairs once, and never shows it', async () => {
    const conversation = await measuredSetup();
    let rendererCalls = 0;
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({ conversationActs: [act('ask_about_pending_question')] }));
      }
      if (call.kind === 'renderer') {
        rendererCalls += 1;
        return rendererReplyForBaseRequest(call, rendererCalls === 1
          ? '安全に整理できなかったため予定条件には反映していません。どの問題集ですか？'
          : 'まずどの問題集の20問かが分かると、来週のどこに入れるか決めやすくなります。どの問題集のどのあたりですか？');
      }
      return undefined;
    };
    const why = await conversation.submit(WHY);

    const renderers = why.calls.filter((call) => call.kind === 'renderer');
    expect(renderers).toHaveLength(2);
    expect(JSON.stringify(renderers[1].messages)).toContain('アプリ内部の仕組みや処理');
    const message = lastMessage(conversation);
    expect(message).toContain('来週のどこに入れるか');
    expect(message).not.toMatch(INTERNAL_PROCESS_WORDING);
  });
});
