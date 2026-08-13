import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import { createWeeklyPlanningTestDraftBlock } from './testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';

function repairPendingState(): PlanningIntakeState {
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
    questions: ['英単語80語を覚えるのにどれくらい時間がかかりますか？'],
    lastQuestionContext: {
      kind: 'missing',
      targetSlot: 'stable_v5:missing_effort_estimate',
      intent: 'missing_effort_estimate',
      topicId: 'workload-english',
    },
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'user_authorized',
    sourceTurns: [],
  };
}

describe('weekly planning repair preview gate', () => {
  it('keeps preview candidates but refuses promotion to draft blocks until repair is resolved', () => {
    const previewCandidate = {
      stableKey: 'stable-v5:1:math:0',
      date: '2026-08-18',
      startTime: '19:00',
      endTime: '20:00',
      durationMinutes: 60,
      title: '数学 10ページ',
      field: '数学',
      year: 0,
      estimatedMinutes: 60,
      source: 'weekly_exam_prep' as const,
      approvalStatus: 'unapproved' as const,
      workItemKey: 'math-work',
    };
    const state = {
      ...createInitialPlanningState('2026-08-17'),
      mode: 'collecting_tasks' as const,
      previewCandidates: [previewCandidate],
      intakeState: repairPendingState(),
    };
    const draft = createWeeklyPlanningTestDraftBlock({ id: 'stale-preview-draft' });

    const next = weeklyPlanningReducer(state, {
      type: 'add_draft_blocks',
      blocks: [draft],
    });

    expect(next).toBe(state);
    expect(next.previewCandidates).toEqual([previewCandidate]);
    expect(next.draftBlocks).toEqual([]);
  });
});