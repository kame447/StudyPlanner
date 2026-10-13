import { describe, expect, it } from 'vitest';
import { consultationCommunicationForPlanning, evaluatedWeeklyPlanningConsultationDates } from './weeklyPlanningConsultationCommunication';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION } from '../semantic/weeklyPlanningStableV5PreviewScheduler';

const ready: GenericSchedulerInputCompilationResult = {
  status: 'ready', issues: [], input: {
    version: 'weekly-planning-generic-scheduler-input-v2', graphRevision: 1, ownerId: 'owner',
    horizon: { startDate: '2026-10-12', endDate: '2026-10-18', timeZone: 'Asia/Tokyo', planningWindowFactIds: [] },
    movableWorkItems: [], fixedTaskReservations: [], taskDateEligibilities: [], availabilityWindows: [],
    dailyCapacityLimits: [{ date: '2026-10-17', maxMinutes: 90, sourceFactIds: ['limit'] }],
    sourceSelections: [], relations: [], hardDateBounds: [], preferredPlacements: [], sourceFactRefs: [],
  },
};
const evaluated = (status: 'ready' | 'insufficient_capacity') => ({
  schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION, status,
  candidates: [], unscheduledWorkItemIds: status === 'ready' ? [] : ['work'],
});

describe('consultation evidence boundaries', () => {
  it('does not treat compiler readiness or daily limits as proof of free time or feasibility', () => {
    const before = structuredClone(ready);
    const context = consultationCommunicationForPlanning({ compilation: ready, preserveExistingPreview: false });
    expect(context).toMatchObject({
      mode: 'advisory_only', assessmentScope: 'accepted_plan_only',
      feasibility: { status: 'not_evaluated', reason: 'preview_required' },
      dailyLimits: [{ date: '2026-10-17', maxMinutes: 90 }], nextAction: 'offer_preview',
    });
    expect(context).not.toHaveProperty('availableMinutes');
    expect(ready).toEqual(before);
  });

  it.each(['ready', 'insufficient_capacity'] as const)('reports the current scheduler result %s only for accepted conditions', (status) => {
    const context = consultationCommunicationForPlanning({
      compilation: ready, preview: evaluated(status), preserveExistingPreview: false,
    });
    expect(context.feasibility).toEqual({
      status: status === 'ready' ? 'fits' : 'does_not_fit', basis: 'current_turn_scheduler',
    });
    expect(context.assessmentScope).toBe('accepted_plan_only');
    expect(context.nextAction).toBe(status === 'ready' ? 'review_preview' : 'offer_preference_change');
  });

  it('withholds even a successful scheduler result when routing preserved an older preview', () => {
    expect(consultationCommunicationForPlanning({
      compilation: ready, preview: evaluated('ready'), preserveExistingPreview: true,
    }).feasibility).toEqual({ status: 'not_evaluated', reason: 'existing_preview_not_rechecked' });
  });

  it('carries missing planning reasons without declaring a capacity failure', () => {
    const context = consultationCommunicationForPlanning({
      compilation: { status: 'needs_resolution', input: null, issues: [{
        domain: 'work_item', code: 'missing_effort_estimate', blocking: true, factId: 'work',
      }] },
      preserveExistingPreview: false,
    });
    expect(context).toMatchObject({
      feasibility: { status: 'not_evaluated', reason: 'planning_details_missing' },
      missingQuestionCodes: ['missing_effort_estimate'], nextAction: 'clarify_planning_details',
    });
  });
});

describe('hypothetical evidence is distinct from the retained real preview', () => {
  it.each(['fits', 'does_not_fit'] as const)('projects %s from the trial scheduler even when the original preview is kept', status => {
    const context = consultationCommunicationForPlanning({ compilation: ready, preserveExistingPreview: true,
      alternativeEvidence: { alternative: { scope: 'task', taskIds: ['task'], taskLabels: ['研究メモ'], dates: ['2026-10-17'] },
        feasibility: { status, basis: 'alternative_scheduler' } },
    });
    expect(context.assessmentScope).toBe('proposed_days');
    expect(context.feasibility).toEqual({ status, basis: 'alternative_scheduler' });
    expect(context.nextAction).toBe(status === 'fits' ? 'offer_alternative_adoption' : 'offer_preference_change');
    expect(context.alternative?.dates).toEqual(['2026-10-17']);
  });
});

it('grounds only dates actually evaluated for this alternative, never the old preview or missing details', () => {
  const accepted = consultationCommunicationForPlanning({ compilation: ready, preview: evaluated('ready'), preserveExistingPreview: false });
  expect(evaluatedWeeklyPlanningConsultationDates({ ...accepted, alternative: { scope: 'plan', taskIds: [], taskLabels: [], dates: ['2026-10-17'] } })).toEqual([]);
  const evidence = { alternative: { scope: 'task' as const, taskIds: ['task'], taskLabels: ['研究メモ'], dates: ['2026-10-17'] },
    feasibility: { status: 'fits' as const, basis: 'alternative_scheduler' as const } };
  const tested = consultationCommunicationForPlanning({ compilation: ready, preserveExistingPreview: true, alternativeEvidence: evidence });
  expect(evaluatedWeeklyPlanningConsultationDates(tested)).toEqual(['2026-10-17']);
  expect(evaluatedWeeklyPlanningConsultationDates({ ...tested, feasibility: { status: 'not_evaluated', reason: 'planning_details_missing' } })).toEqual([]);
  expect(evaluatedWeeklyPlanningConsultationDates(null)).toEqual([]);
});
