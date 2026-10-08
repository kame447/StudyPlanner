import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningConsultationCommunication } from '../application/weeklyPlanningConsultationCommunication';
import type { WeeklyPlanningTurnExecutionInput } from '../weeklyPlanningTurnExecutionTypes';
import { retainedPreviewCommunicationForStableV5Dialogue } from './weeklyPlanningRetainedPreviewCommunication';

const alternative: WeeklyPlanningConsultationCommunication = { mode: 'advisory_only', assessmentScope: 'proposed_days',
  alternative: { scope: 'task', taskIds: ['math'], taskLabels: ['数学'], dates: ['2030-01-12', '2030-01-13'] },
  feasibility: { status: 'fits', basis: 'alternative_scheduler' }, missingQuestionCodes: [], workEstimates: [], dailyLimits: [], nextAction: 'offer_alternative_adoption' };
const preview = (...placements: Array<{ taskId: string; date: string }>): NonNullable<WeeklyPlanningTurnExecutionInput['currentPreview']> => ({ candidateCount: placements.length, placements });
const project = (current: WeeklyPlanningTurnExecutionInput['currentPreview'], consultation = alternative) =>
  retainedPreviewCommunicationForStableV5Dialogue({ preview: current, consultation, outcome: undefined });

describe('typed retained-preview presentation evidence', () => {
  it('requires adoption when the tested task is still scheduled on different days', () => {
    expect(project(preview({ taskId: 'math', date: '2030-01-07' }))).toEqual({ alternativeRequiresAdoption: true });
  });
  it('keeps a preview already inside the alternative days available, even with other tasks elsewhere', () => {
    expect(project(preview({ taskId: 'math', date: '2030-01-12' }, { taskId: 'english', date: '2030-01-07' }))).toEqual({});
  });
  it('checks every placement of the selected task', () => {
    expect(project(preview({ taskId: 'math', date: '2030-01-12' }, { taskId: 'math', date: '2030-01-07' }))).toEqual({ alternativeRequiresAdoption: true });
  });
  it('does not require a completed task to appear in a plan-wide alternative preview', () => {
    expect(project(preview({ taskId: 'math', date: '2030-01-12' }), { ...alternative,
      alternative: { ...alternative.alternative!, scope: 'plan', taskIds: ['math', 'finished'] },
      workEstimates: [{ taskId: 'math', minutes: 20 }] })).toEqual({});
  });
  it('requires adoption if a selected task is absent from the current preview', () => {
    expect(project(preview({ taskId: 'english', date: '2030-01-12' }))).toEqual({ alternativeRequiresAdoption: true });
    expect(project(preview({ taskId: 'math', date: '2030-01-12' }), { ...alternative,
      alternative: { ...alternative.alternative!, scope: 'plan', taskIds: ['math', 'english'] } })).toEqual({ alternativeRequiresAdoption: true });
  });
  it('fails toward adoption when candidate placement provenance is incomplete', () => {
    expect(project({ candidateCount: 2, placements: [{ taskId: 'math', date: '2030-01-12' }] })).toEqual({ alternativeRequiresAdoption: true });
  });
  it('does not pretend there is a current preview, a tested alternative or resolved days', () => {
    expect(project(undefined)).toEqual({});
    expect(project(preview())).toEqual({});
    expect(project(preview({ taskId: 'math', date: '2030-01-07' }), { ...alternative, assessmentScope: 'accepted_plan_only' })).toEqual({});
    expect(project(preview({ taskId: 'math', date: '2030-01-07' }), { ...alternative, alternative: undefined })).toEqual({});
    expect(project(preview({ taskId: 'math', date: '2030-01-07' }), { ...alternative,
      alternative: { ...alternative.alternative!, dates: [] } })).toEqual({});
  });
  it('records unchanged preview only for semantic recovery with an actual preview', () => {
    const params = { preview: preview({ taskId: 'math', date: '2030-01-07' }), consultation: undefined };
    expect(retainedPreviewCommunicationForStableV5Dialogue({ ...params, outcome: { kind: 'recover', failure: 'semantic', representedQuestion: false } }))
      .toEqual({ retainedPreviewUnchanged: true });
    expect(retainedPreviewCommunicationForStableV5Dialogue({ ...params, outcome: { kind: 'recover', failure: 'provider', representedQuestion: false } })).toEqual({});
    expect(retainedPreviewCommunicationForStableV5Dialogue({ ...params, preview: undefined, outcome: { kind: 'recover', failure: 'semantic', representedQuestion: false } })).toEqual({});
  });
});
