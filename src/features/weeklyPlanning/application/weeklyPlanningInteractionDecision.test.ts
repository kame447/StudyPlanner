import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createWeeklyPlanningStableV5DialoguePrompt } from '../dialogue/weeklyPlanningStableV5DialoguePrompt';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  classifyWeeklyPlanningInteraction,
  planWeeklyPlanningInteraction,
  type WeeklyPlanningInteractionPlan,
} from './weeklyPlanningInteractionDecision';
import { resolveWeeklyPlanningConversationActTargetsV5 } from '../semantic/weeklyPlanningConversationActsV5';
import type { WeeklyPlanningStableV5PlanningEvaluation } from './weeklyPlanningStableV5PlanningEvaluation';

const question: WeeklyPlanningQuestionContext = {
  kind: 'missing',
  targetSlot: 'stable_v5:missing_effort_estimate',
  intent: 'duration_per_unit',
  topicId: 'wl-1',
};
const fresh: WeeklyPlanningQuestionPresentationFreshness = {
  status: 'fresh',
  questionContext: question,
  presentation: {
    version: 1, turnId: 't', assistantMessageId: 'a', planningStateRevision: 2, graphRevision: 1,
    content: {
      responseSource: 'deterministic_fallback', currentTurnGrounding: 'none', selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false,
    },
  },
};

function plan(
  overrides: Partial<WeeklyPlanningInteractionPlan['acts']> = {},
  targetQuestionOpen = false,
  targetResolved = targetQuestionOpen,
): WeeklyPlanningInteractionPlan {
  return {
    planningChanged: false,
    dialogueQuestionOverride: null,
    targetResolved,
    targetQuestionOpen,
    acts: { ask: false, shift: false, resume: false, consultation: false, ...overrides },
  };
}

function output(options: { question?: WeeklyPlanningQuestionContext; draft?: boolean } = {}): WeeklyPlanningTurnExecutionResult {
  return {
    state: { ...createInitialPlanningIntakeState(), lastQuestionContext: options.question },
    message: 'm',
    draftCandidates: options.draft ? [{} as never] : [],
  };
}

const classify = (
  p: WeeklyPlanningInteractionPlan,
  out: WeeklyPlanningTurnExecutionResult,
  presentation: WeeklyPlanningQuestionPresentationFreshness = fresh,
) => classifyWeeklyPlanningInteraction({ plan: p, output: out, previousQuestion: question, presentation });

describe('interaction outcome classification (typed acts + machine state only)', () => {
  it('explains only a fresh pending question that is unchanged', () => {
    expect(classify(plan({ ask: true }), output({ question })).kind).toBe('explain_pending_question');
    expect(classify(plan({ ask: true }), output({ question }), { status: 'unbound' }).kind).toBe('apply');
    expect(classify(plan({ ask: true }), output({ question: { ...question, topicId: 'wl-2' } })).kind).toBe('apply');
    expect(classify(plan({ ask: true }), output()).kind).toBe('apply');
  });

  it('treats a topic shift as an aside unless the named topic has an open question', () => {
    expect(classify(plan({ shift: true }), output({ question })).kind).toBe('aside');
    expect(classify(plan({ shift: true }, true), output({ question })).kind).toBe('resume_pending_question');
  });

  it('resumes only when there is a question to re-present', () => {
    expect(classify(plan({ resume: true }), output({ question })).kind).toBe('resume_pending_question');
    expect(classify(plan({ resume: true }), output()).kind).toBe('apply');
  });

  it('does not call it a resume when the named topic has no open question to present', () => {
    expect(classify(plan({ resume: true }, false, true), output({ question })).kind).toBe('apply');
    expect(classify(plan({ resume: true }, true, true), output({ question })).kind).toBe('resume_pending_question');
    expect(classify(plan({ resume: true }, false, false), output({ question })).kind).toBe('resume_pending_question');
  });

  it('never lets an act suppress a preview, and keeps the consultation marker', () => {
    const outcome = classify(plan({ shift: true, ask: true, consultation: true }), output({ question, draft: true }));
    expect(outcome).toEqual({ kind: 'apply', consultationDeferred: true });
  });

  it('holds the question on a consultation alone but keeps normal progression for mixed planning changes', () => {
    expect(classify(plan({ consultation: true }), output({ question })).kind).toBe('aside');
    expect(classify({ ...plan({ consultation: true }), planningChanged: true }, output({ question })).kind).toBe('apply');
  });

  it('keeps independent contributions: an explanation can carry a consultation marker', () => {
    expect(classify(plan({ ask: true, consultation: true }), output({ question }))).toEqual({
      kind: 'explain_pending_question',
      consultationDeferred: true,
    });
  });
});

describe('renderer boundary', () => {
  it('receives the typed communication context and does not ask the model to infer it from the user message', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'a', currentUserMessage: 'なんで時間が必要？', recentConversation: [], planningInformation: null,
      actionKind: 'question', questionCode: 'missing_effort_estimate', requiredLabels: [], fallbackText: 'f', previewCount: 0,
      communication: {
        goal: 'explain_question',
        questionPurposes: ['estimate_time_to_fit_available_time'],
        askQuestion: true,
        laterNeeds: [],
        statusReason: null,
        planningDetailsNotApplied: false,
        consultationDeferred: true,
        previewDisclosure: null,
      },
    });
    const payload = JSON.parse(prompt.userPrompt) as { applicationDecision: Record<string, unknown>; request: string };
    expect(payload.applicationDecision).toMatchObject({
      communication: { goal: 'explain_question', consultationDeferred: true, askQuestion: true },
      purposeMeanings: { estimate_time_to_fit_available_time: expect.any(String) },
    });
    expect(payload.request).not.toContain('currentUserMessageが直前の質問の意味');
    expect(payload.request).toContain('currentUserMessageから目的を推測し直さないでください');
  });

  it('decision modules never read raw user text', () => {
    for (const file of ['./weeklyPlanningInteractionDecision.ts', './weeklyPlanningConversationRecovery.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\.userText\b(?!\s*,|\s*\}|\s*:)/);
      expect(source).not.toMatch(/RegExp|\.match\(|\.test\(/);
    }
  });
});

describe('naming a topic cannot override the repair policy', () => {
  const source = { conversationId: 'c', turnId: 't', semanticLocalId: 'x', sourceText: 'x', origin: 'user' as const };
  function twoTopicGraph() {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.revision = 2;
    graph.tasks = ['task-a', 'task-b'].map((id) => ({
      id, category: 'study' as const, title: id, source, createdRevision: 1,
    }));
    graph.workloads = [['wl-1', 'task-a'], ['wl-2', 'task-b']].map(([id, taskId]) => ({
      id, taskId, componentId: null, quantityRole: 'target' as const, amount: 10, unitCode: 'page' as const,
      unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      source, createdRevision: 1,
    }));
    graph.factLifecycles = ['task-a', 'task-b', 'wl-1', 'wl-2'].map((factId) => ({
      factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null,
    }));
    return graph;
  }
  const effortIssue = (factId: string) => ({
    domain: 'work_item' as const, code: 'missing_effort_estimate' as const, blocking: true as const, factId, details: {},
  });
  function evaluationFor(graph: ReturnType<typeof twoTopicGraph>, deferredIssueIds: string[]) {
    const issues = [effortIssue('wl-1'), effortIssue('wl-2')];
    return {
      compilation: { issues },
      activeGraph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
      dialogue: { status: 'ask_question', question: {
        domain: 'work_item', code: 'missing_effort_estimate', factId: 'wl-1', details: {}, effortMeasurement: 'duration_per_unit',
      } },
      repairDecision: { deferredIssueIds },
    } as unknown as WeeklyPlanningStableV5PlanningEvaluation;
  }
  const acts = (kind: 'topic_shift' | 'resume_topic') =>
    [{ kind, targetPublicId: 'task-b', sourceText: 'x' }] as never;

  it('redirects to the named topic when its question is askable now', () => {
    const graph = twoTopicGraph();
    const result = planWeeklyPlanningInteraction({ acts: acts('resume_topic'), graph, evaluation: evaluationFor(graph, []) });
    expect(result.dialogueQuestionOverride?.factId).toBe('wl-2');
    expect(result).toMatchObject({ targetResolved: true, targetQuestionOpen: true });
  });

  it('ignores a named topic that is not an active fact of this conversation', () => {
    const graph = twoTopicGraph();
    graph.factLifecycles = graph.factLifecycles.map((entry) => (entry.factId === 'task-b'
      ? { ...entry, status: 'removed' as const, terminalRevision: 2 }
      : entry));
    // A topic removed here, a topic only another conversation knows, and no topic at all.
    for (const targetPublicId of ['task-b', 'task-of-another-conversation', null]) {
      for (const kind of ['topic_shift', 'resume_topic'] as const) {
        const result = planWeeklyPlanningInteraction({
          acts: [{ kind, targetPublicId }] as never, graph, evaluation: evaluationFor(graph, []),
        });
        expect(result).toMatchObject({ dialogueQuestionOverride: null, targetResolved: false, targetQuestionOpen: false });
      }
    }
  });

  it.each(['topic_shift', 'resume_topic'] as const)('does not guess a target after %s is degraded to null', (kind) => {
    const graph = twoTopicGraph();
    const before = structuredClone(graph);
    const resolved = resolveWeeklyPlanningConversationActTargetsV5({
      acts: [{ kind, targetPublicId: 'invented-topic' }],
      publicStateSummary: { tasks: graph.tasks.map((task) => ({ publicId: task.id })) },
    });
    expect(resolved.acts).toEqual([{ kind, targetPublicId: null }]);
    expect(resolved.diagnostics).toEqual(['conversationActs[0].targetPublicId:degraded-unknown-topic']);
    expect(planWeeklyPlanningInteraction({ acts: resolved.acts, graph, evaluation: evaluationFor(graph, []) }))
      .toMatchObject({ dialogueQuestionOverride: null, targetResolved: false, targetQuestionOpen: false });
    expect(graph).toEqual(before);
  });

  it.each(['topic_shift', 'resume_topic'] as const)('revalidates a snapshot-valid %s target against the live graph', (kind) => {
    const graph = twoTopicGraph();
    const resolved = resolveWeeklyPlanningConversationActTargetsV5({
      acts: [{ kind, targetPublicId: 'task-b' }],
      publicStateSummary: { tasks: graph.tasks.map((task) => ({ publicId: task.id })) },
    });
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.acts[0].targetPublicId).toBe('task-b');
    // The semantic snapshot was correct, but the target disappeared before interaction planning.
    graph.factLifecycles = graph.factLifecycles.map((entry) => (entry.factId === 'task-b'
      ? { ...entry, status: 'removed' as const, terminalRevision: graph.revision }
      : entry));
    const before = structuredClone(graph);
    expect(planWeeklyPlanningInteraction({ acts: resolved.acts, graph, evaluation: evaluationFor(graph, []) }))
      .toMatchObject({ dialogueQuestionOverride: null, targetResolved: false, targetQuestionOpen: false });
    expect(graph).toEqual(before);
  });

  it('cannot route to a topic active only in another conversation, even when the snapshot accepts it', () => {
    const graph = twoTopicGraph();
    const foreign = createEmptyWeeklyPlanningFactGraphV5();
    foreign.revision = 1;
    foreign.tasks = [{ ...graph.tasks[1], id: 'foreign-task', source: { ...source, conversationId: 'other-chat' } }];
    foreign.factLifecycles = [{ ...graph.factLifecycles[1], factId: 'foreign-task' }];
    expect(foreign.factLifecycles).toContainEqual(expect.objectContaining({ factId: 'foreign-task', status: 'active' }));
    const resolved = resolveWeeklyPlanningConversationActTargetsV5({
      acts: [{ kind: 'resume_topic', targetPublicId: foreign.tasks[0].id }],
      publicStateSummary: { tasks: foreign.tasks.map((task) => ({ publicId: task.id })) },
    });
    expect(resolved.diagnostics).toEqual([]);
    const before = structuredClone(graph);
    expect(planWeeklyPlanningInteraction({ acts: resolved.acts, graph, evaluation: evaluationFor(graph, []) }))
      .toMatchObject({ dialogueQuestionOverride: null, targetResolved: false, targetQuestionOpen: false });
    expect(graph).toEqual(before);
  });

  const askedAbout = (factId: string): WeeklyPlanningQuestionContext => ({
    kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', intent: 'duration_per_unit', topicId: factId,
  });
  const ask = [{ kind: 'ask_about_pending_question', targetPublicId: null }] as never;

  it('keeps the fresh question the user asked about presented while it is still open (mixed turn)', () => {
    const graph = twoTopicGraph();
    // Other details of the turn made wl-1 the policy's top question; the user asked about wl-2.
    const kept = planWeeklyPlanningInteraction({
      acts: ask, graph, evaluation: evaluationFor(graph, []), explainedQuestion: askedAbout('wl-2'),
    });
    expect(kept.dialogueQuestionOverride?.factId).toBe('wl-2');
    expect(classifyWeeklyPlanningInteraction({
      plan: kept,
      output: output({ question: askedAbout('wl-2') }),
      previousQuestion: askedAbout('wl-2'),
      presentation: fresh,
    }).kind).toBe('explain_pending_question');
    // Already the top question: nothing to redirect.
    expect(planWeeklyPlanningInteraction({
      acts: ask, graph, evaluation: evaluationFor(graph, []), explainedQuestion: askedAbout('wl-1'),
    }).dialogueQuestionOverride).toBeNull();
  });

  it('does not keep an asked-about question that is closed, deferred, not fresh, or not asked about', () => {
    const graph = twoTopicGraph();
    const keeps = (params: { acts?: never; deferred?: string[]; explained: WeeklyPlanningQuestionContext | null }) =>
      planWeeklyPlanningInteraction({
        acts: params.acts ?? ask,
        graph,
        evaluation: evaluationFor(graph, params.deferred ?? []),
        explainedQuestion: params.explained,
      }).dialogueQuestionOverride;
    expect(keeps({ explained: askedAbout('wl-closed') })).toBeNull();
    expect(keeps({ explained: askedAbout('wl-2'), deferred: ['wl-2'] })).toBeNull();
    expect(keeps({ explained: null })).toBeNull();
    expect(keeps({ explained: askedAbout('wl-2'), acts: [] as never })).toBeNull();
  });

  it('does not pull a question the repair policy deferred this turn forward', () => {
    const graph = twoTopicGraph();
    for (const kind of ['topic_shift', 'resume_topic'] as const) {
      const result = planWeeklyPlanningInteraction({ acts: acts(kind), graph, evaluation: evaluationFor(graph, ['wl-2']) });
      expect(result.dialogueQuestionOverride).toBeNull();
      expect(result).toMatchObject({ targetResolved: true, targetQuestionOpen: false });
      const outcome = classifyWeeklyPlanningInteraction({
        plan: result, output: output({ question }), previousQuestion: question, presentation: fresh,
      });
      expect(outcome.kind).toBe(kind === 'topic_shift' ? 'aside' : 'apply');
    }
  });
});
