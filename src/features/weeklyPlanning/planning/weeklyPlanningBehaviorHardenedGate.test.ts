import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  runHardenedBehaviorAwarePlanningPreviewBridge,
} from './weeklyPlanningBehaviorAwarePreviewBridgeHardened';

function state(overrides: Partial<PlanningIntakeState> = {}): PlanningIntakeState {
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
      unit: 'minutes',
      amount: 30,
      rawText: '英語ワークを30分進める',
      requiresTimeEstimate: false,
      source: 'command',
    }],
    progress: [],
    unitRates: [],
    constraints: [{
      kind: 'commute',
      studyAvailableStart: '17:30',
      hardness: 'hard',
    }],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    draftGenerationIntent: 'user_authorized',
    draftGenerationAuthorizedAtRevision: 1,
    sourceTurns: ['条件を確認した'],
    ...overrides,
  };
}

function run(value: PlanningIntakeState) {
  return runHardenedBehaviorAwarePlanningPreviewBridge({
    state: value,
    currentUserText: '仮の予定を組んで',
    planningStartDate: '2026-07-13',
    planningDayCount: 7,
    sessionPolicy: {
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
  });
}

describe('hardened behavior-aware preview gate', () => {
  it('rejects authorization from an older state revision', () => {
    const output = run(state({
      sourceTurns: ['条件を確認した', 'その後に条件を変更した'],
      draftGenerationAuthorizedAtRevision: 1,
    }));

    expect(output.snapshot.readiness.draftGenerationIntent).toBe('not_requested');
    expect(output.gate).toEqual({ allowed: false, reason: 'not_user_authorized' });
  });

  it('does not trust a timetable ref when no matching timetable data exists', () => {
    const output = run(state({
      constraints: [],
      constraintSourcesInUse: [{ kind: 'timetable', selector: 'active' }],
    }));

    expect(output.snapshot.readiness.blockingDimensions).toContain('availability_basis');
    expect(output.gate.allowed).toBe(false);
  });

  it('does not trust an existing-plans ref when the pipeline has no plans', () => {
    const output = run(state({
      constraints: [],
      constraintSourcesInUse: [{ kind: 'existing_plans', selector: 'active' }],
    }));

    expect(output.snapshot.readiness.blockingDimensions).toContain('availability_basis');
    expect(output.gate.allowed).toBe(false);
  });
});
