import { describe, expect, it } from 'vitest';
import type {
  PlanningIntakeState,
  WeeklyPlanningLearningStrategyProposalRecord,
  WeeklyPlanningQuestionPresentationContent,
} from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningMessage } from '../types';
import { resolveWeeklyPlanningProposalResponseEligibilityV5 } from './weeklyPlanningStableV5ProposalResponseEligibility';

const PRESENTED = '英単語は1回15〜30分の分散学習にしますか？';

function graph(options: { taskActive?: boolean; workloadActive?: boolean } = {}) {
  const base = createEmptyWeeklyPlanningFactGraphV5();
  const source = {
    conversationId: 'conversation-1', turnId: 'turn-1', semanticLocalId: 'l', sourceText: '英単語', origin: 'user' as const,
  };
  return {
    ...base,
    revision: 3,
    tasks: [{ id: 'task-1', category: 'study', title: '英単語', source, createdRevision: 1 }],
    workloads: [{
      id: 'workload-1', taskId: 'task-1', componentId: null, quantityRole: 'target', amount: 100,
      unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false,
      periodExpression: null, source, createdRevision: 1,
    }],
    factLifecycles: [
      { factId: 'task-1', status: options.taskActive === false ? 'superseded' : 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'workload-1', status: options.workloadActive === false ? 'superseded' : 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
    ],
  } as ReturnType<typeof createEmptyWeeklyPlanningFactGraphV5>;
}

function proposal(
  overrides: Partial<WeeklyPlanningLearningStrategyProposalRecord> = {},
): WeeklyPlanningLearningStrategyProposalRecord {
  return {
    id: 'wpp_memory_abc',
    kind: 'spaced_memory_practice',
    taskId: 'task-1',
    workloadFactId: 'workload-1',
    scope: 'week',
    status: 'pending',
    suggestedSessionMinutes: { min: 15, max: 30 },
    selectedSessionMinutes: null,
    createdRevision: 3,
    proposedAtTurnId: 'turn-3',
    decidedAtTurnId: null,
    ...overrides,
  } as WeeklyPlanningLearningStrategyProposalRecord;
}

const CONTENT: WeeklyPlanningQuestionPresentationContent = {
  responseSource: 'ai',
  currentTurnGrounding: 'none',
  selfRepairNotice: false,
  groundingContext: { proposed: 0, contested: 0 },
  previewPromotionControl: false,
};

function state(options: {
  records?: WeeklyPlanningLearningStrategyProposalRecord[];
  content?: WeeklyPlanningQuestionPresentationContent;
  targetSlot?: string;
  actionId?: string;
  bound?: boolean;
} = {}): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [PRESENTED],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
    learningStrategyProposalRecords: options.records ?? [proposal()],
    lastQuestionContext: {
      kind: 'options',
      targetSlot: options.targetSlot ?? 'stable_v5:learning_strategy_proposal',
      intent: 'learning_strategy_proposal',
      topicId: 'workload-1',
      actionId: options.actionId ?? 'wpp_memory_abc',
      ...(options.bound === false ? {} : {
        presentation: {
          version: 1,
          turnId: 'turn-3',
          assistantMessageId: 'turn-3:assistant',
          planningStateRevision: 8,
          graphRevision: 3,
          content: options.content ?? CONTENT,
        },
      }),
    },
  };
}

const messages: WeeklyPlanningMessage[] = [
  { id: 'turn-3:user', role: 'user', content: '英単語を100語覚えたい', createdAt: '2026-09-28T00:00:00.000Z' },
  { id: 'turn-3:assistant', role: 'assistant', content: PRESENTED, createdAt: '2026-09-28T00:00:01.000Z' },
];

function resolve(overrides: Partial<Parameters<typeof resolveWeeklyPlanningProposalResponseEligibilityV5>[0]> = {}) {
  return resolveWeeklyPlanningProposalResponseEligibilityV5({
    previousState: state(),
    inputStateRevision: 8,
    messages,
    graph: graph(),
    userText: 'いいえ、今回はやめておきます',
    hasSelectedStarterTarget: false,
    ...overrides,
  });
}

describe('Stable V5 proposal-response eligibility', () => {
  it('is eligible for a fresh, unaccompanied presentation of the single pending proposal', () => {
    expect(resolve()).toEqual({
      status: 'eligible',
      candidate: {
        proposalPublicId: 'wpp_memory_abc',
        inputRevision: 8,
        presentedAssistantText: PRESENTED,
        proposal: {
          kind: 'spaced_memory_practice',
          taskTitle: '英単語',
          sessionMinutes: { min: 15, max: 30 },
        },
      },
    });
  });

  it.each([
    ['supplemental evidence', { supplementalContext: '画像の予定' }, 'supplemental_context'],
    ['a selected starter target', { hasSelectedStarterTarget: true }, 'selected_starter_target'],
    ['an empty reply', { userText: '   ' }, 'user_text_size'],
    ['an oversized reply', { userText: 'あ'.repeat(201) }, 'user_text_size'],
    ['a session saved before binding', { previousState: state({ bound: false }) }, 'presentation_unbound'],
    ['a later mutation', { inputStateRevision: 9 }, 'presentation_stale'],
    ['a moved graph', { graph: { ...graph(), revision: 4 } }, 'presentation_stale'],
    ['a presentation with grounding', {
      previousState: state({ content: { ...CONTENT, currentTurnGrounding: 'recommended' } }),
    }, 'presentation_accompanied'],
    ['a presentation with a proposed interpretation', {
      previousState: state({ content: { ...CONTENT, groundingContext: { proposed: 1, contested: 0 } } }),
    }, 'presentation_accompanied'],
    ['another pending question', {
      previousState: state({ targetSlot: 'stable_v5:missing_effort_estimate' }),
    }, 'question_code'],
    ['two pending proposals', {
      previousState: state({ records: [proposal(), proposal({ id: 'wpp_memory_def', workloadFactId: 'workload-2' })] }),
    }, 'pending_proposal_count'],
    ['an already decided proposal', {
      previousState: state({ records: [proposal({ status: 'rejected' })] }),
    }, 'pending_proposal_count'],
    ['a binding to another proposal', {
      previousState: state({ actionId: 'wpp_memory_other' }),
    }, 'bound_proposal_mismatch'],
    ['an unsupported proposal kind', {
      previousState: state({ records: [proposal({ kind: 'calibrate_memory_pace' })] }),
    }, 'proposal_kind'],
    ['an inactive task', { graph: graph({ taskActive: false }) }, 'proposal_task_inactive'],
    ['an inactive workload', { graph: graph({ workloadActive: false }) }, 'proposal_workload_inactive'],
  ] as const)('is ineligible with %s', (_label, overrides, reason) => {
    expect(resolve(overrides as never)).toEqual({ status: 'ineligible', reason });
  });
});
