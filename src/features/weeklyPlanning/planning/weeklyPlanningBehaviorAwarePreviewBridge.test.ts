import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { runBehaviorAwarePlanningPreviewBridge } from './weeklyPlanningBehaviorAwarePreviewBridge';

function baseState(sourceTurns: string[]): PlanningIntakeState {
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
      title: '英語ワーク',
      subject: '英語',
      unit: 'pages',
      amount: 10,
      rawText: '英語ワーク10ページ',
      executionProfile: {
        activityKind: 'drill',
        distributionPolicy: 'sequential_units',
        cognitiveLoad: 'medium',
      },
      requiresTimeEstimate: true,
      source: 'command',
    }],
    progress: [],
    unitRates: [{
      unit: 'pages',
      minutesPerUnit: 12,
      source: 'user',
      rawText: '1ページ10分から15分',
    }],
    constraints: [
      {
        kind: 'commute',
        studyAvailableStart: '17:30',
        hardness: 'hard',
        rawText: '帰宅17時30分',
      },
      {
        kind: 'meal',
        start: '19:00',
        end: '20:00',
        hardness: 'hard',
        rawText: '夕食19時',
      },
    ],
    fixedEventsDeclaredNone: true,
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns,
  };
}

describe('behavior-aware non-exam preview bridge', () => {
  it('does not run the scheduler before explicit user authorization', () => {
    const result = runBehaviorAwarePlanningPreviewBridge({
      state: baseState(['今週は英語ワークを進めたい']),
      planningStartDate: '2026-07-13',
      planningDayCount: 7,
    });

    expect(result.gate).toEqual({ allowed: false, reason: 'not_user_authorized' });
    expect(result.draftRun).toBeNull();
  });

  it('uses the existing scheduler after authorization and attaches traceable metadata', () => {
    const authorizedState = baseState(['今週は英語ワークを進めたい', '予定作成を承認']);
    authorizedState.draftGenerationIntent = 'user_authorized';
    authorizedState.draftGenerationAuthorizedAtRevision = authorizedState.sourceTurns.length;
    const result = runBehaviorAwarePlanningPreviewBridge({
      state: authorizedState,
      planningStartDate: '2026-07-13',
      planningDayCount: 7,
      sessionPolicy: {
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        firstDayStartTime: '17:30',
        minSessionMinutes: 30,
        targetSessionMinutes: 60,
        maxSessionMinutes: 90,
        breakMinutes: 10,
      },
    });

    expect(result.gate).toEqual({ allowed: true, reason: 'allowed' });
    expect(result.draftRun?.candidates.length).toBeGreaterThan(0);
    expect(result.draftRun?.candidates[0]).toMatchObject({
      title: '英語ワーク',
      field: '英語',
      year: 0,
      approvalStatus: 'unapproved',
      behaviorMetadata: {
        stateRevision: 2,
        taskRef: 'task:0',
        reasoningKey: 'explicit-unit-rate',
        usedAssumptionProposalRefs: [],
      },
    });
    expect(result.draftRun?.diagnostics.shouldSavePlan).toBe(false);
  });

  it('does not infer workload from a profile when the unit estimate is missing', () => {
    const state = baseState(['予定作成を承認']);
    state.draftGenerationIntent = 'user_authorized';
    state.draftGenerationAuthorizedAtRevision = state.sourceTurns.length;
    state.unitRates = [];

    const result = runBehaviorAwarePlanningPreviewBridge({
      state,
      planningStartDate: '2026-07-13',
      planningDayCount: 7,
    });

    expect(result.gate.allowed).toBe(false);
    expect(result.snapshot.readiness.blockingDimensions).toContain('workload');
    expect(result.draftRun).toBeNull();
  });

  it('preserves hard meal constraints in generated candidates', () => {
    const authorizedState = baseState(['予定作成を承認']);
    authorizedState.draftGenerationIntent = 'user_authorized';
    authorizedState.draftGenerationAuthorizedAtRevision = authorizedState.sourceTurns.length;
    const result = runBehaviorAwarePlanningPreviewBridge({
      state: authorizedState,
      planningStartDate: '2026-07-13',
      planningDayCount: 7,
      sessionPolicy: {
        dayStartTime: '17:30',
        dayEndTime: '22:00',
        firstDayStartTime: '17:30',
        minSessionMinutes: 30,
        targetSessionMinutes: 60,
        maxSessionMinutes: 60,
        breakMinutes: 0,
      },
    });

    const onFirstDay = result.draftRun?.candidates.filter(
      (candidate) => candidate.date === '2026-07-13',
    ) ?? [];
    expect(onFirstDay.every((candidate) =>
      candidate.endTime <= '19:00' || candidate.startTime >= '20:00',
    )).toBe(true);
    expect(result.draftRun?.diagnostics.constraintConflicts).toEqual([]);
  });
});
