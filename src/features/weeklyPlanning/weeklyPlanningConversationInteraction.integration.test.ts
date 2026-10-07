import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from './application/weeklyPlanningStableV5SessionCodec';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './application/weeklyPlanningStableV5RuntimeSession';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from './intake/weeklyPlanningQuestionPresentation';
import { WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT } from './application/weeklyPlanningTurnDispatchBudget';
import { createDeferred } from './testUtils/weeklyPlanningApplicationTestHarness';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedConversation,
  type ScriptedProviderCall,
  type ScriptedProviderReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import { cancelWeeklyPlanningControlledTurn } from './weeklyPlanningTurnController';

const MATH_SETUP = '来週、数学の問題集を20問進めたい';
const TWO_TASK_SETUP = '来週、英語の長文を10ページと、数学の問題を20問やりたい。数学は1問5分';
const SENTINEL = 'SENTINEL-488-INVALID-OUTPUT';
/** Internal system/process vocabulary that must never reach an ordinary assistant reply. */
const INTERNAL_PROCESS_WORDING = /予定条件|安全に整理|反映していません|確認中の質問|保留中|構造化|正規化|validation|pending|provider|retry|処理結果/u;

type Json = Record<string, unknown>;

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

function workload(localId: string, amount: number, unitCode: string, unitLabel: string, sourceText: string): Json {
  return {
    localId, quantityRole: 'target', amount, unitCode, unitLabel,
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText,
  };
}

function studyTask(params: {
  localId: string;
  title: string;
  activityKind: string;
  workloads: Json[];
  effortEstimates?: Json[];
  sourceText: string;
}): Json {
  return {
    localId: params.localId,
    existingPublicId: null,
    decompositionStatus: 'atomic',
    category: 'study',
    title: params.title,
    study: { purpose: 'self_study', activityKind: params.activityKind, contextLabel: null, components: [] },
    workloads: params.workloads,
    effortEstimates: params.effortEstimates ?? [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.sourceText,
  };
}

function mathSetupDocument(): Json {
  return emptyDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [studyTask({
      localId: 't-math',
      title: '数学の問題集',
      activityKind: 'problem_solving',
      workloads: [workload('wl-math', 20, 'problem', '問', '数学の問題集を20問')],
      sourceText: '数学の問題集を20問進めたい',
    })],
  });
}

function twoTaskSetupDocument(): Json {
  return emptyDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [
      studyTask({
        localId: 't-english',
        title: '英語の長文',
        activityKind: 'reading',
        workloads: [workload('wl-english', 10, 'page', 'ページ', '英語の長文を10ページ')],
        sourceText: '英語の長文を10ページ',
      }),
      studyTask({
        localId: 't-math',
        title: '数学の問題',
        activityKind: 'problem_solving',
        workloads: [workload('wl-math', 20, 'problem', '問', '数学の問題を20問')],
        effortEstimates: [{
          localId: 'e-math', targetLocalId: 'wl-math', kind: 'duration_per_unit', minutes: 5,
          unitCode: 'problem', precision: 'exact', sourceText: '数学は1問5分',
        }],
        sourceText: '数学の問題を20問',
      }),
    ],
  });
}

/** A typed conversation act: discourse metadata of the current turn (no quoted evidence). */
function act(kind: string, targetPublicId: string | null = null): Json {
  return { kind, targetPublicId };
}

function focusedFallback(): string {
  return JSON.stringify({
    decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null,
  });
}

function focusedEffort(minutes: number, measurement = 'duration_per_unit'): string {
  return JSON.stringify({
    decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: measurement,
    minutes, precision: 'approximate', quantityRole: null,
  });
}

function userTextOf(call: ScriptedProviderCall): string {
  const payload = call.payload ?? {};
  return String(payload.userText ?? payload.currentUserText ?? '');
}

function summaryOf(call: ScriptedProviderCall): Json {
  const summary = call.payload?.publicStateSummary;
  return typeof summary === 'object' && summary !== null ? summary as Json : {};
}

function taskId(call: ScriptedProviderCall, title: string): string {
  const tasks = summaryOf(call).tasks;
  const task = Array.isArray(tasks)
    ? tasks.find((entry) => (entry as Json).title === title) as Json | undefined
    : undefined;
  if (!task || typeof task.publicId !== 'string') throw new Error(`missing task ${title}`);
  return task.publicId;
}

function rendererDecision(call: ScriptedProviderCall | undefined): Json {
  const decision = call?.payload?.applicationDecision;
  return typeof decision === 'object' && decision !== null ? decision as Json : {};
}

type Script = (call: ScriptedProviderCall) => ScriptedProviderReply | Promise<ScriptedProviderReply> | undefined;

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let script: Script;

function defaultReply(call: ScriptedProviderCall): ScriptedProviderReply {
  if (call.kind === 'renderer') return 'renderer unavailable in fixture';
  if (call.kind === 'semantic_focused_contextual') return focusedFallback();
  if (call.kind === 'semantic_generic') {
    if (userTextOf(call) === MATH_SETUP) return JSON.stringify(mathSetupDocument());
    if (userTextOf(call) === TWO_TASK_SETUP) return JSON.stringify(twoTaskSetupDocument());
    return JSON.stringify(emptyDocument());
  }
  return 'unexpected fixture call';
}

beforeEach(() => {
  resetScriptedConversationRuntime();
  script = () => undefined;
  provider = installScriptedWeeklyPlanningProvider((call) => script(call) ?? defaultReply(call));
});

afterEach(() => {
  provider.restore();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

function latestAssistant(conversation: ScriptedConversation) {
  const messages = conversation.getState().messages;
  const latest = messages[messages.length - 1];
  expect(latest?.role).toBe('assistant');
  return latest!;
}

function freshness(conversation: ScriptedConversation) {
  const state = conversation.getState();
  return resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: state.intakeState,
    inputStateRevision: state.revision,
    messages: state.messages,
    graphRevision: conversation.graph()?.revision ?? -1,
  });
}

function pendingTarget(conversation: ScriptedConversation) {
  const context = conversation.getState().intakeState?.lastQuestionContext;
  return { targetSlot: context?.targetSlot, topicId: context?.topicId, actionId: context?.actionId };
}

function effortMinutesFor(conversation: ScriptedConversation, workloadId: string | undefined): number[] {
  const graph = conversation.graph();
  if (!graph || !workloadId) return [];
  const active = new Set(graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  return graph.effortEstimates
    .filter((estimate) => active.has(estimate.id) && estimate.targetFactId === workloadId)
    .map((estimate) => estimate.minutes);
}

describe('Issue #488 A: explanation of the pending question', () => {
  it('explains without mutation or completeness retries, re-presents the same question, then binds the short answer', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    expect(pending.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(freshness(conversation).status).toBe('fresh');
    const graphBefore = structuredClone(conversation.graph());

    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          conversationActs: [act('ask_about_pending_question')],
        }));
      }
      if (call.kind === 'renderer') {
        return scriptedRendererReply(call, '時間が分かると、空き時間に無理なく配分できます。1問あたり何分くらいかかりますか？');
      }
      return undefined;
    };
    const explanation = await conversation.submit('なんで時間が必要？');

    expect(explanation.calls.map((call) => call.kind)).toEqual([
      'semantic_focused_contextual',
      'semantic_generic',
      'renderer',
    ]);
    // Only the idempotency ledger records that this turn was seen; no fact, lifecycle or revision moved.
    const graphAfter = conversation.graph()!;
    expect(graphAfter.revision).toBe(graphBefore!.revision);
    expect({ ...graphAfter, appliedTurnKeys: [] }).toEqual({ ...graphBefore, appliedTurnKeys: [] });
    expect(graphAfter.appliedTurnKeys).toEqual([
      ...graphBefore!.appliedTurnKeys,
      expect.stringContaining(explanation.requestId!),
    ]);
    expect(pendingTarget(conversation)).toEqual(pending);
    const renderer = explanation.calls.find((call) => call.kind === 'renderer');
    expect(rendererDecision(renderer)).toMatchObject({
      actionKind: 'question',
      questionCode: 'missing_effort_estimate',
      communication: {
        goal: 'explain_question',
        askQuestion: true,
        questionPurposes: ['estimate_time_to_fit_available_time'],
        planningDetailsNotApplied: false,
      },
      purposeMeanings: { estimate_time_to_fit_available_time: expect.any(String) },
    });
    expect(explanation.result?.interactionOutcome).toMatchObject({ kind: 'explain_pending_question' });
    expect(latestAssistant(conversation).content).toContain('何分くらい');
    const presentation = conversation.getState().intakeState?.lastQuestionContext?.presentation;
    expect(presentation?.assistantMessageId).toBe(latestAssistant(conversation).id);
    expect(freshness(conversation).status).toBe('fresh');

    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(3) : undefined);
    const answer = await conversation.submit('1問3分くらい');

    expect(answer.calls.some((call) => call.kind === 'semantic_generic')).toBe(false);
    expect(effortMinutesFor(conversation, pending.topicId)).toEqual([3]);
  });

  it('keeps a bounded completeness retry only for a contradictory answer act with no planning delta', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);

    let generic = 0;
    script = (call) => {
      if (call.kind !== 'semantic_generic') return undefined;
      generic += 1;
      return JSON.stringify(emptyDocument({
        conversationActs: [act('answer_pending_question')],
      }));
    };
    const turn = await conversation.submit('たぶんそれくらい');

    expect(generic).toBeGreaterThan(1);
    expect(turn.calls.length).toBeLessThanOrEqual(WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT);
  });
});

describe('Issue #488 B: aside and resume', () => {
  it('does not rebind an old question on an aside, does not bind a later short reply to it, and re-presents on resume', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(TWO_TASK_SETUP);
    const english = pendingTarget(conversation);
    expect(english.targetSlot).toBe('stable_v5:missing_effort_estimate');

    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          conversationActs: [act('topic_shift', taskId(call, '数学の問題'))],
        }));
      }
      return undefined;
    };
    const aside = await conversation.submit('ちょっと数学の話をしたい');
    expect(aside.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(aside.result?.interactionOutcome).toMatchObject({ kind: 'aside' });
    expect(rendererDecision(aside.calls.find((call) => call.kind === 'renderer'))).toMatchObject({
      actionKind: 'status',
      questionCode: null,
      communication: { goal: 'acknowledge_aside', askQuestion: false },
    });
    expect(pendingTarget(conversation)).toEqual(english);
    expect(conversation.getState().intakeState?.lastQuestionContext).not.toHaveProperty('presentation');
    expect(freshness(conversation).status).toBe('unbound');

    script = () => undefined;
    const shortReply = await conversation.submit('うん');
    expect(shortReply.calls.some((call) => call.kind === 'semantic_focused_contextual')).toBe(false);
    const generic = shortReply.calls.find((call) => call.kind === 'semantic_generic');
    expect(summaryOf(generic!).pendingQuestion).toBeNull();
    expect(shortReply.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(effortMinutesFor(conversation, english.topicId)).toEqual([]);
    // An ordinary act-free turn: the reply still carries no app-internal wording.
    expect(latestAssistant(conversation).content).not.toMatch(INTERNAL_PROCESS_WORDING);

    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          conversationActs: [act('resume_topic', taskId(call, '英語の長文'))],
        }));
      }
      return undefined;
    };
    const resume = await conversation.submit('英語に戻ろう');
    expect(resume.result?.interactionOutcome).toMatchObject({ kind: 'resume_pending_question' });
    expect(rendererDecision(resume.calls.find((call) => call.kind === 'renderer'))).toMatchObject({
      actionKind: 'question',
      questionCode: 'missing_effort_estimate',
      communication: { goal: 'resume_question', askQuestion: true },
    });
    expect(pendingTarget(conversation)).toEqual(english);
    expect(freshness(conversation).status).toBe('fresh');

    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(6) : undefined);
    await conversation.submit('1ページ6分');
    expect(effortMinutesFor(conversation, english.topicId)).toEqual([6]);
  });

  it('resumes the named topic even when another topic has a higher-priority open question', async () => {
    const conversation = createScriptedConversation({ provider });
    script = (call) => {
      if (call.kind === 'semantic_generic' && userTextOf(call) === '来週、英語の長文を10ページと数学の問題を20問やりたい') {
        const document = twoTaskSetupDocument();
        const tasks = document.tasks as Json[];
        (tasks[1] as Json).effortEstimates = [];
        (tasks[0] as Json).sourceText = '英語の長文を10ページ';
        return JSON.stringify(document);
      }
      return undefined;
    };
    await conversation.submit('来週、英語の長文を10ページと数学の問題を20問やりたい');
    const first = pendingTarget(conversation);
    expect(first.targetSlot).toBe('stable_v5:missing_effort_estimate');
    const graph = conversation.graph()!;
    const firstTaskTitle = graph.tasks.find((task) =>
      graph.workloads.find((entry) => entry.id === first.topicId)?.taskId === task.id)!.title;
    const otherTitle = firstTaskTitle === '英語の長文' ? '数学の問題' : '英語の長文';

    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          conversationActs: [act('topic_shift', taskId(call, otherTitle))],
        }));
      }
      return undefined;
    };
    await conversation.submit('そっちの話をしたい');
    const shifted = pendingTarget(conversation);
    expect(shifted.topicId).not.toBe(first.topicId);
    expect(freshness(conversation).status).toBe('fresh');

    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          conversationActs: [act('resume_topic', taskId(call, firstTaskTitle))],
        }));
      }
      return undefined;
    };
    const resume = await conversation.submit('さっきのに戻ろう');
    expect(resume.result?.interactionOutcome).toMatchObject({ kind: 'resume_pending_question' });
    expect(pendingTarget(conversation)).toEqual(first);
    expect(freshness(conversation).status).toBe('fresh');
  });
});

describe('Issue #488 C/D: failures become conversational recovery', () => {
  it('re-presents the same fresh machine question after a semantic failure and keeps state unchanged', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    const graphBefore = structuredClone(conversation.graph());
    const previewBefore = structuredClone(conversation.getState().previewCandidates);
    const pendingQuestionText = latestAssistant(conversation).content;

    script = (call) => (call.kind === 'semantic_generic' ? 'not a semantic document' : undefined);
    const failed = await conversation.submit('えっと、それは');

    expect(failed.submission.accepted).toBe(true);
    expect(failed.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(failed.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic', representedQuestion: true });
    expect(conversation.graph()).toEqual(graphBefore);
    expect(conversation.getState().previewCandidates).toEqual(previewBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    // The reply is a normal rendered turn: the typed recovery goal and the retained question.
    const renderer = failed.calls.find((call) => call.kind === 'renderer');
    expect(rendererDecision(renderer)).toMatchObject({
      actionKind: 'question',
      questionCode: 'missing_effort_estimate',
      communication: { goal: 'clarify_turn', askQuestion: true },
    });
    const message = latestAssistant(conversation).content;
    expect(message).not.toContain('いつの予定を作るか');
    expect(message).not.toMatch(INTERNAL_PROCESS_WORDING);
    // The fixture renderer is unavailable, so the emergency wording carries the same question.
    expect(message).toContain(pendingQuestionText.replace(/^.*?(1問あたり)/, '$1'));
    expect(freshness(conversation).status).toBe('fresh');
    expect(failed.result?.state.lastQuestionContext?.targetSlot).toBe(pending.targetSlot);
    const projected = failed.debugTrace.find((event) => event.stage === 'turn_executor_result_projected');
    expect(JSON.stringify(projected?.data)).not.toContain('"questionsCleared":true');

    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(4) : undefined);
    await conversation.submit('1問4分');
    expect(effortMinutesFor(conversation, pending.topicId)).toEqual([4]);
  });

  it('commits a successfully rendered recovery as an AI reply and still binds the next short answer', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    const graphBefore = structuredClone(conversation.graph());
    const RECOVERY_MARKER = 'ごめんなさい、うまくつかめませんでした。数学は1問あたり何分くらいかかりそうですか？';
    script = (call) => {
      if (call.kind === 'semantic_generic') return 'not a semantic document';
      if (call.kind === 'renderer') return scriptedRendererReply(call, RECOVERY_MARKER);
      return undefined;
    };
    const failed = await conversation.submit('えっと、それは');

    expect(failed.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(failed.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic', representedQuestion: true });
    expect(failed.result?.responseSource).toBe('ai');
    // The committed reply is the rendered recovery, and it is what the failure carries.
    expect(latestAssistant(conversation).content).toBe(RECOVERY_MARKER);
    expect(failed.result?.failure?.userMessage).toBe(RECOVERY_MARKER);
    expect(failed.result?.questionPresentationContent).toMatchObject({ responseSource: 'ai' });
    expect(conversation.graph()).toEqual(graphBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation).status).toBe('fresh');

    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(4) : undefined);
    await conversation.submit('1問4分');
    expect(effortMinutesFor(conversation, pending.topicId)).toEqual([4]);
  });

  it('re-asks the retained question (one request) without inventing a content clarification on provider failure', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    const graphBefore = structuredClone(conversation.graph());

    script = () => ({ failure: 'network' });
    const failed = await conversation.submit('1問3分');

    expect(failed.result?.failure?.code).toBe('stable_v5_provider_failure');
    expect(failed.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'provider' });
    // The provider just failed: no renderer call; the short emergency wording asks only the
    // retained question again (one request, no separate resend request).
    expect(failed.calls.some((call) => call.kind === 'renderer')).toBe(false);
    const message = latestAssistant(conversation).content;
    expect(message).toContain('1問あたり');
    expect(message).not.toMatch(/送って/u);
    expect(message).not.toContain('いつの予定を作るか');
    expect(message).not.toMatch(INTERNAL_PROCESS_WORDING);
    expect(conversation.graph()).toEqual(graphBefore);
    expect(pendingTarget(conversation)).toEqual(pending);
    expect(freshness(conversation).status).toBe('fresh');

    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(3) : undefined);
    await conversation.submit('1問3分');
    expect(effortMinutesFor(conversation, pending.topicId)).toEqual([3]);
  });

  it('does not ask an unrelated question when no question was pending', async () => {
    const conversation = createScriptedConversation({ provider });
    script = (call) => (call.kind === 'semantic_generic' ? 'not a semantic document' : undefined);
    const failed = await conversation.submit('こんにちは');
    expect(failed.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic', representedQuestion: false });
    expect(rendererDecision(failed.calls.find((call) => call.kind === 'renderer'))).toMatchObject({
      actionKind: 'status',
      communication: { goal: 'clarify_turn', askQuestion: false },
    });
    const message = latestAssistant(conversation).content;
    expect(message).not.toContain('いつの予定を作るか');
    expect(message).not.toMatch(INTERNAL_PROCESS_WORDING);
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeUndefined();
  });
});

describe('Issue #488 E: reload keeps identity and freshness', () => {
  /** What the chat store would persist for this conversation (graph + planning state). */
  function snapshotOf(conversation: ScriptedConversation) {
    const graph = conversation.graph()!;
    const preparation = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
      conversationId: conversation.conversationId,
      graph,
      planningState: conversation.getState(),
    });
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') throw new Error('checkpoint not ready');
    const restored = parseWeeklyPlanningStableV5PersistedSession({
      raw: JSON.stringify({
        version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
        ownerId: conversation.ownerId,
        weekStartDate: conversation.weekStartDate,
        conversationId: conversation.conversationId,
        graph,
        planningState: preparation.planningState,
        savedAt: '2026-10-07T09:30:00.000Z',
      }),
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
    });
    expect(restored).not.toBeNull();
    return restored!;
  }

  /** Imports a snapshot the way the chat session does: hydrate the runtime graph, load the state. */
  function restore(
    restored: ReturnType<typeof snapshotOf>,
    conversation: ScriptedConversation,
  ): ScriptedConversation {
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
      conversationId: conversation.conversationId,
      graph: restored.graph,
    });
    return createScriptedConversation({
      provider,
      ownerId: conversation.ownerId,
      conversationId: conversation.conversationId,
      weekStartDate: conversation.weekStartDate,
      initialState: restored.planningState,
    });
  }

  async function reload(conversation: ScriptedConversation): Promise<ScriptedConversation> {
    const restored = snapshotOf(conversation);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    return restore(restored, conversation);
  }

  it('keeps each chat\'s question identity and freshness across A -> B -> A', async () => {
    const chatA = createScriptedConversation({ provider, conversationId: 'issue488-chat-a' });
    await chatA.submit(MATH_SETUP);
    const pendingA = pendingTarget(chatA);
    const snapshotA = snapshotOf(chatA);

    // Switch to chat B (its own conversation id, graph and question), answer there.
    const chatB = createScriptedConversation({ provider, conversationId: 'issue488-chat-b' });
    await chatB.submit(MATH_SETUP);
    const pendingB = pendingTarget(chatB);
    expect(pendingB.topicId).not.toBe(pendingA.topicId);
    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(7) : undefined);
    await chatB.submit('1問7分');
    expect(effortMinutesFor(chatB, pendingB.topicId)).toEqual([7]);
    const snapshotB = snapshotOf(chatB);

    // Switch back to A: the persisted question is still the latest presented one for A.
    const backInA = restore(snapshotA, chatA);
    expect(freshness(backInA).status).toBe('fresh');
    expect(pendingTarget(backInA)).toEqual(pendingA);
    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(3) : undefined);
    const answer = await backInA.submit('1問3分');
    expect(answer.calls[0]?.kind).toBe('semantic_focused_contextual');
    expect(effortMinutesFor(backInA, pendingA.topicId)).toEqual([3]);
    // B's accepted state is untouched by A's turn, and B's own snapshot is still consistent.
    expect(effortMinutesFor(chatB, pendingB.topicId)).toEqual([7]);
    expect(snapshotOf(chatB).graph).toEqual(snapshotB.graph);
    expect(effortMinutesFor(backInA, pendingB.topicId)).toEqual([]);
  });

  it('does not treat a restored chat A question as fresh once chat A moved on without it', async () => {
    const chatA = createScriptedConversation({ provider, conversationId: 'issue488-chat-a' });
    await chatA.submit(MATH_SETUP);
    const staleSnapshot = snapshotOf(chatA);
    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(3) : undefined);
    await chatA.submit('1問3分');

    // A's runtime graph moved on (effort answered); the older planning state must not bind.
    const restoredOldState = createScriptedConversation({
      provider,
      conversationId: 'issue488-chat-a',
      initialState: staleSnapshot.planningState,
    });
    expect(freshness(restoredOldState).status).not.toBe('fresh');
  });

  it('binds the short answer after reloading an explanation turn', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    script = (call) => (call.kind === 'semantic_generic'
      ? JSON.stringify(emptyDocument({ conversationActs: [act('ask_about_pending_question')] }))
      : undefined);
    await conversation.submit('なんで？');

    const reloaded = await reload(conversation);
    expect(freshness(reloaded).status).toBe('fresh');
    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(2) : undefined);
    const answer = await reloaded.submit('1問2分');
    expect(answer.calls[0]?.kind).toBe('semantic_focused_contextual');
    expect(effortMinutesFor(reloaded, pending.topicId)).toEqual([2]);
  });

  it('binds the short answer after reloading a recovery turn', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const pending = pendingTarget(conversation);
    script = (call) => (call.kind === 'semantic_generic' ? 'not a semantic document' : undefined);
    await conversation.submit('えっと');

    const reloaded = await reload(conversation);
    expect(freshness(reloaded).status).toBe('fresh');
    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedEffort(5) : undefined);
    await reloaded.submit('1問5分');
    expect(effortMinutesFor(reloaded, pending.topicId)).toEqual([5]);
  });
});

describe('Issue #488 F: stale responses and double submit', () => {
  it('discards an explanation result that arrives after the turn was cancelled', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const stateBefore = structuredClone(conversation.getState());
    const gate = createDeferred<ScriptedProviderReply>();
    script = (call) => (call.kind === 'semantic_generic' ? gate.promise : undefined);

    const running = conversation.submit('なんで？');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const duplicate = await conversation.submit('なんで？');
    expect(duplicate.submission.accepted).toBe(false);
    expect(cancelWeeklyPlanningControlledTurn({
      getState: conversation.getState,
      dispatch: conversation.dispatch,
    })).toBe(true);
    gate.resolve(JSON.stringify(emptyDocument({
      conversationActs: [act('ask_about_pending_question')],
    })));
    const stale = await running;

    expect(stale.submission.accepted).toBe(false);
    const state = conversation.getState();
    expect(state.messages.filter((message) => message.role === 'assistant')).toEqual(
      stateBefore.messages.filter((message) => message.role === 'assistant'),
    );
    expect(state.intakeState).toEqual(stateBefore.intakeState);
  });

  it('discards a recovery result that arrives after the turn was cancelled', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    const stateBefore = structuredClone(conversation.getState());
    const gate = createDeferred<ScriptedProviderReply>();
    script = (call) => (call.kind === 'semantic_generic' ? gate.promise : undefined);

    const running = conversation.submit('えっと');
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelWeeklyPlanningControlledTurn({ getState: conversation.getState, dispatch: conversation.dispatch });
    gate.resolve({ failure: 'network' });
    const stale = await running;

    expect(stale.submission.accepted).toBe(false);
    expect(conversation.getState().intakeState).toEqual(stateBefore.intakeState);
    expect(conversation.getState().messages.filter((message) => message.role === 'assistant')).toEqual(
      stateBefore.messages.filter((message) => message.role === 'assistant'),
    );
  });
});

describe('Issue #488 G: mixed turns keep independent planning contributions', () => {
  it('applies the planning contribution and records the consultation as a deferred handoff', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(TWO_TASK_SETUP);
    const graphRevision = conversation.graph()!.revision;

    const mixed = '火曜日の18時から20時は勉強できない。英語はこの量で間に合う？';
    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          planningIntent: 'update_plan',
          availabilityDeclarations: [{
            localId: 'a1', kind: 'unavailable', dateExpression: 'weekday:tuesday', namedTimePeriod: null,
            startTime: '18:00', endTime: '20:00', recurrenceKind: null, days: [], constraintLevel: 'hard',
            capacityMinutes: null, sourceText: '火曜日の18時から20時は勉強できない',
          }],
          conversationActs: [act('consultation_request', taskId(call, '英語の長文'))],
        }));
      }
      return undefined;
    };
    const turn = await conversation.submit(mixed);

    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(conversation.graph()!.revision).toBeGreaterThan(graphRevision);
    expect(conversation.graph()!.availabilityDeclarations).toEqual([
      expect.objectContaining({ kind: 'unavailable', startTime: '18:00', endTime: '20:00' }),
    ]);
    const renderer = turn.calls.find((call) => call.kind === 'renderer');
    expect(rendererDecision(renderer)).toMatchObject({ communication: { consultationDeferred: true } });
    expect(turn.result?.interactionOutcome).toMatchObject({ consultationDeferred: true });
  });
});

describe('Issue #488 H: invalid provider output never leaks', () => {
  it('keeps the invalid output out of message, state, checkpoint and the next prompts', async () => {
    const conversation = createScriptedConversation({ provider });
    await conversation.submit(MATH_SETUP);
    script = (call) => {
      if (call.kind === 'renderer') return undefined;
      return `{"schemaVersion":"weekly-planning-semantic-v5","tasks":[{"title":"${SENTINEL}"}],"note":"${SENTINEL}"`;
    };
    await conversation.submit('えっと');

    const state = conversation.getState();
    expect(JSON.stringify(state)).not.toContain(SENTINEL);
    const preparation = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: conversation.ownerId,
      weekStartDate: conversation.weekStartDate,
      conversationId: conversation.conversationId,
      graph: conversation.graph()!,
      planningState: state,
    });
    expect(JSON.stringify(preparation)).not.toContain(SENTINEL);
    expect(JSON.stringify(conversation.graph())).not.toContain(SENTINEL);

    script = (call) => (call.kind === 'semantic_focused_contextual' ? focusedFallback() : undefined);
    const next = await conversation.submit('やっぱりわからない');
    for (const call of next.calls) {
      expect(JSON.stringify(call.messages)).not.toContain(SENTINEL);
    }
  });
});

describe('Issue #488 I: conversational acts never authorize, approve or save', () => {
  it('keeps authorization, approval and save untouched for every act kind', async () => {
    const conversation = createScriptedConversation({ provider });
    script = (call) => {
      if (call.kind === 'semantic_generic' && userTextOf(call) === MATH_SETUP) {
        return JSON.stringify({ ...mathSetupDocument(), planningIntent: 'update_plan' });
      }
      return undefined;
    };
    await conversation.submit(MATH_SETUP);
    const before = conversation.getState();
    expect(before.intakeState?.draftGenerationIntent).toBe('not_requested');

    script = (call) => {
      if (call.kind === 'semantic_generic') {
        return JSON.stringify(emptyDocument({
          conversationActs: [
            act('answer_pending_question'),
            act('resume_topic', taskId(call, '数学の問題集')),
            act('consultation_request'),
          ],
        }));
      }
      return undefined;
    };
    const turn = await conversation.submit('いいよ、それで作って保存して');

    const state = conversation.getState();
    expect(state.intakeState?.draftGenerationIntent).toBe('not_requested');
    expect(state.intakeState?.shouldSavePlan).toBe(false);
    expect(state.previewCandidates ?? []).toEqual([]);
    expect(state.draftBlocks).toEqual([]);
    expect(state.pendingApproval).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([]);
  });
});
