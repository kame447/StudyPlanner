import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import {
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
  type BehaviorAwareDialoguePlanner,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  removeWeeklyPlanningPreviewBlock,
} from '../preview/weeklyPlanningPreviewBlocks';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import {
  runHardenedBehaviorAwarePlanningPreviewBridge,
} from './weeklyPlanningBehaviorAwarePreviewBridgeHardened';
import {
  validateBehaviorAwareDialogueResponseStrict,
} from './weeklyPlanningBehaviorSafety';
import type { AllowedDialogueAction } from './weeklyPlanningBehaviorTypes';
import {
  applyDraftGenerationAuthorizationTurn,
} from './weeklyPlanningDraftGenerationAuthorization';

function completeState(overrides: Partial<PlanningIntakeState> = {}): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
      calendarDayCount: 7,
      confidence: 'explicit',
      sourceText: '今週',
    },
    tasks: [{
      title: '英単語',
      subject: '英語',
      unit: 'minutes',
      amount: 30,
      rawText: '金曜日に英単語の小テストがある',
      deadlineDeclared: true,
      deadlineDate: '2026-07-17',
      executionProfile: {
        activityKind: 'memorization',
        distributionPolicy: 'spaced',
        cognitiveLoad: 'light',
      },
      requiresTimeEstimate: false,
      source: 'command',
    }],
    progress: [],
    unitRates: [],
    constraints: [
      { kind: 'commute', end: '17:30', hardness: 'soft' },
      { kind: 'meal', start: '19:00', end: '20:00', hardness: 'hard' },
    ],
    fixedEventsDeclaredNone: true,
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns: [
      '今週、金曜日に英単語の小テストがある',
      '帰宅は17時30分で、夕食は19時',
    ],
    ...overrides,
  };
}

function runBridge(state: PlanningIntakeState) {
  return runHardenedBehaviorAwarePlanningPreviewBridge({
    state,
    planningStartDate: '2026-07-13',
    planningDayCount: 7,
    sessionPolicy: {
      firstDayStartTime: '17:30',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
  });
}

const allowedAction: AllowedDialogueAction = {
  actionId: 'ask:deadline:2',
  kind: 'ask_required_fact',
  topicId: 'deadline',
  sourceFactRefs: [],
  allowedProposalRefs: [],
  allowedOptionIds: [],
  maxItems: 1,
};

describe('behavior-aware planning safety boundary', () => {
  it('does not authorize preview from raw text without the typed authorization reducer', () => {
    const output = runBridge(completeState());

    expect(output.snapshot.readiness.draftGenerationIntent).toBe('not_requested');
    expect(output.gate).toEqual({ allowed: false, reason: 'not_user_authorized' });
    expect(output.draftRun).toBeNull();
  });

  it('authorizes only the validated command at the current state revision', () => {
    const state = completeState();
    const authorized = applyDraftGenerationAuthorizationTurn({
      state,
      userText: 'この条件で仮の予定を組んで',
    });
    const output = runBridge(authorized);

    expect(authorized.draftGenerationIntent).toBe('user_authorized');
    expect(authorized.draftGenerationAuthorizedAtRevision).toBe(state.sourceTurns.length);
    expect(output.snapshot.readiness.draftGenerationIntent).toBe('user_authorized');
    expect(output.gate).toEqual({ allowed: true, reason: 'allowed' });
    expect(output.draftRun?.candidates.length).toBeGreaterThan(0);
  });

  it('does not treat fixedEventsDeclaredNone alone as availability', () => {
    const state = applyDraftGenerationAuthorizationTurn({
      state: completeState({
        constraints: [],
        constraintSourcesInUse: undefined,
      }),
      userText: '仮の予定を組んで',
    });
    const output = runBridge(state);

    expect(output.snapshot.readiness.blockingDimensions).toContain('availability_basis');
    expect(output.gate.allowed).toBe(false);
    expect(output.draftRun).toBeNull();
  });

  it('keeps a test deadline unresolved until a concrete date or linked weekday exists', () => {
    const state = applyDraftGenerationAuthorizationTurn({
      state: completeState({
        tasks: [{
          title: '英単語',
          subject: '英語',
          unit: 'minutes',
          amount: 30,
          rawText: '英単語の小テストがある',
          deadlineDeclared: true,
          deadlineTime: '12:00',
          executionProfile: {
            activityKind: 'memorization',
            distributionPolicy: 'spaced',
            cognitiveLoad: 'light',
          },
          requiresTimeEstimate: false,
          source: 'command',
        }],
        sourceTurns: ['英単語の小テストがある'],
      }),
      userText: '仮の予定を組んで',
    });
    const output = runBridge(state);

    expect(output.snapshot.readiness.blockingDimensions).toContain('deadline');
    expect(output.snapshot.resolutionOpportunities).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'deadline', mode: 'must_confirm' }),
    ]));
    expect(output.gate.allowed).toBe(false);
  });

  it('does not reuse an unrelated event weekday as the task deadline', () => {
    const state = applyDraftGenerationAuthorizationTurn({
      state: completeState({
        tasks: [{
          title: '英単語',
          subject: '英語',
          unit: 'minutes',
          amount: 30,
          rawText: '英単語の小テストがある',
          deadlineDeclared: true,
          deadlineTime: '12:00',
          executionProfile: {
            activityKind: 'memorization',
            distributionPolicy: 'spaced',
            cognitiveLoad: 'light',
          },
          requiresTimeEstimate: false,
          source: 'command',
        }],
        sourceTurns: ['英単語の小テストがある', '金曜日はバイト'],
      }),
      userText: '仮の予定を組んで',
    });
    const output = runBridge(state);

    expect(output.snapshot.readiness.blockingDimensions).toContain('deadline');
    expect(output.gate.allowed).toBe(false);
  });

  it('rejects save claims and internal names in every user-visible AI field', () => {
    expect(validateBehaviorAwareDialogueResponseStrict({
      actions: [allowedAction],
      previewAllowed: false,
      response: {
        acknowledgement: '予定を保存しました。',
        selectedActionIds: [allowedAction.actionId],
        items: [{ actionId: allowedAction.actionId, text: '期限を教えてください。' }],
      },
    })).toBeNull();

    expect(validateBehaviorAwareDialogueResponseStrict({
      actions: [allowedAction],
      previewAllowed: false,
      response: {
        selectedActionIds: [allowedAction.actionId],
        items: [{ actionId: allowedAction.actionId, text: '期限を教えてください。' }],
        reasoningSummary: 'blockingDimensionsを確認しました。',
      },
    })).toBeNull();
  });

  it('preserves behavior metadata through preview creation, deletion, and draft promotion', () => {
    const candidates = [0, 1].map((index) => ({
      stableKey: `task:${index}:chunk-0`,
      date: `2026-07-${13 + index}`,
      startTime: '18:00',
      endTime: '18:30',
      durationMinutes: 30,
      title: index === 0 ? '英単語' : '英語ワーク',
      field: '英語',
      year: 0,
      estimatedMinutes: 30,
      source: 'weekly_exam_prep' as const,
      approvalStatus: 'unapproved' as const,
      workItemKey: `task:${index}`,
      behaviorMetadata: {
        stateRevision: 4,
        sourceFactRefs: [`task:${index}`],
        usedAssumptionProposalRefs: [],
        taskRef: `task:${index}`,
        opportunityTags: ['after_commute'] as const,
        reasoningKey: 'explicit-duration' as const,
      },
    })) as Array<WeeklyDraftCandidate & { behaviorMetadata: Record<string, unknown> }>;

    const previewBlocks = createWeeklyPlanningPreviewBlocks(candidates);
    expect(previewBlocks[0].behaviorMetadata).toMatchObject({
      taskRef: 'task:0',
      compatibility: { workItemSemantic: 'behavior_aware_task' },
    });

    const removed = removeWeeklyPlanningPreviewBlock({
      previewBlocks,
      candidates,
      blockId: candidates[0].stableKey,
    });
    expect(removed.previewBlocks).toHaveLength(1);
    expect(removed.candidates).toHaveLength(1);
    expect(removed.previewBlocks[0].behaviorMetadata?.taskRef).toBe('task:1');

    const drafts = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: removed.candidates,
      userId: 'user-1',
      createdAt: '2026-07-14T00:00:00',
    });
    expect(drafts[0].behaviorMetadata?.taskRef).toBe('task:1');
  });

  it('passes recent conversation and derived opportunity annotations to the dialogue planner', async () => {
    let capturedRecentConversation: Array<{ role: 'user' | 'assistant'; content: string }> | undefined;
    const dialoguePlanner: BehaviorAwareDialoguePlanner = {
      async plan(input) {
        capturedRecentConversation = input.recentConversation;
        return {
          message: '確認しました。',
          response: null,
          source: 'deterministic_fallback',
        };
      },
    };
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn({ userText }) {
        return {
          candidates: [{
            command: {
              type: 'begin_weekly_planning',
              sourceText: userText,
              confidence: 'high',
            },
            origin: 'ai_interpreter',
            needsConfirmation: false,
          }],
          parseRejections: [],
        };
      },
    };
    const recentTurns = [
      { role: 'user' as const, content: '英単語を進めたい' },
      { role: 'assistant' as const, content: '期限を確認します' },
    ];

    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      previousState: completeState(),
      userText: 'この条件で仮の予定を組んで',
      recentTurns,
      planningStartDate: '2026-07-13',
      planningDayCount: 7,
      sessionPolicy: {
        firstDayStartTime: '17:30',
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 10,
      },
      interpreter,
    }, { dialoguePlanner });

    expect(capturedRecentConversation).toEqual(recentTurns);
    expect(output.behavior.snapshot.opportunityAnnotations.length).toBeGreaterThan(0);
  });
});
