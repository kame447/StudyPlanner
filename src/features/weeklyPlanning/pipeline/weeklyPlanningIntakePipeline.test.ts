import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';
import { runWeeklyPlanningIntakePipeline } from './weeklyPlanningIntakePipeline';

const defaultPipelineInput = {
  planningStartDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  planningDayCount: 7,
  sessionPolicy: {
    firstDayStartTime: '19:00',
    dayStartTime: '09:00',
    dayEndTime: '22:00',
    breakMinutes: 0,
  },
};

function runTurn(previousState: PlanningIntakeState | undefined, userText: string) {
  return runWeeklyPlanningIntakePipeline({
    ...defaultPipelineInput,
    previousState,
    userText,
  });
}

function runWeekendExamSequence() {
  const turns = [
    WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
    WP_RP_001_WEEKEND_EXAM_TURNS.yearRangeProgressAndUnitRate,
    WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
    WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
    WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
  ];
  const outputs = [];
  let previousState: PlanningIntakeState | undefined;

  for (const userText of turns) {
    const output = runTurn(previousState, userText);
    outputs.push(output);
    previousState = output.state;
  }

  return outputs;
}

describe('weekly planning intake pipeline', () => {
  it('returns ask_missing_info for an under-specified first utterance', () => {
    const output = runTurn(undefined, WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly);

    expect(output.state.missing.length).toBeGreaterThan(0);
    expect(output.draftRequest).toBeNull();
    expect(output.remainingWorkItems).toBeNull();
    expect(output.draftCandidates).toBeNull();
    expect(output.diagnostics).toBeNull();
    expect(output.decision).toMatchObject({
      kind: 'ask_missing_info',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('returns confirm_ambiguity when fieldless completedYears would otherwise reach planning', () => {
    const outputs = runWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    const fieldlessState: PlanningIntakeState = {
      ...finalOutput.state,
      progress: finalOutput.state.progress.map((progress) => ({
        ...progress,
        field: undefined,
      })),
    };
    const output = runTurn(fieldlessState, 'この条件で進めて');

    expect(output.state.missing).toEqual([]);
    expect(output.draftRequest).not.toBeNull();
    expect(output.remainingWorkItems?.ambiguities).toContain(
      'completed_years_without_field_scope',
    );
    expect(output.decision).toMatchObject({
      kind: 'confirm_ambiguity',
      ambiguities: ['completed_years_without_field_scope'],
      shouldSavePlan: false,
    });
  });

  it('runs the WP-RP-001 sequence through dry-run preview without saving', () => {
    const outputs = runWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    expect(finalOutput.state.status).toBe('draft_ready');
    expect(finalOutput.draftRequest).not.toBeNull();
    expect(finalOutput.remainingWorkItems?.items.length).toBeGreaterThan(0);
    expect(finalOutput.draftCandidates?.length).toBeGreaterThan(0);
    expect(finalOutput.diagnostics?.shouldSavePlan).toBe(false);
    expect(finalOutput.decision).toMatchObject({
      kind: 'offer_dry_run_preview',
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
  });

  it('keeps draftRequest null while fixed events are still unconfirmed', () => {
    const outputs = runWeekendExamSequence();
    const beforeNoFixedEvents = outputs[4];

    expect(beforeNoFixedEvents.state.missing).toContain('fixed_events');
    expect(beforeNoFixedEvents.draftRequest).toBeNull();
    expect(beforeNoFixedEvents.remainingWorkItems).toBeNull();
    expect(beforeNoFixedEvents.draftCandidates).toBeNull();
    expect(beforeNoFixedEvents.diagnostics).toBeNull();
    expect(beforeNoFixedEvents.decision.kind).toBe('ask_missing_info');
  });

  it('creates draftRequest after explicit no-fixed-events confirmation', () => {
    const outputs = runWeekendExamSequence();
    const finalOutput = outputs[outputs.length - 1];

    if (!finalOutput) {
      throw new Error('expected final output');
    }

    expect(finalOutput.state.missing).not.toContain('fixed_events');
    expect(finalOutput.draftRequest?.fixedEvents).toEqual([]);
    expect(finalOutput.draftRequest?.shouldSavePlan).toBe(false);
  });

  it('returns ask_relax_constraints when dry-run leaves unscheduled items', () => {
    const outputs = runWeekendExamSequence();
    const finalState = outputs[outputs.length - 1]?.state;

    if (!finalState) {
      throw new Error('expected final state');
    }

    const output = runWeeklyPlanningIntakePipeline({
      ...defaultPipelineInput,
      previousState: finalState,
      userText: 'この条件で進めて',
      planningDayCount: 1,
      sessionPolicy: {
        firstDayStartTime: '19:00',
        dayStartTime: '19:00',
        dayEndTime: '20:00',
        breakMinutes: 0,
      },
    });

    expect(output.diagnostics?.unscheduledItems.length).toBeGreaterThan(0);
    expect(output.decision).toMatchObject({
      kind: 'ask_relax_constraints',
      shouldCreateDraft: false,
      shouldSavePlan: false,
    });
  });

  it('is deterministic for the same input sequence', () => {
    expect(runWeekendExamSequence()).toEqual(runWeekendExamSequence());
  });
});