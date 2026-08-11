import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { GenericSchedulerInputCompilationResult } from './weeklyPlanningGenericSchedulerInput';
import {
  decideWeeklyPlanningStableRepairPolicyV5,
  type WeeklyPlanningRepairObligationV5,
} from './weeklyPlanningStableRepairPolicyV5';

function source(id: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: 'できれば夜の方がいい',
    origin: 'user' as const,
  };
}

function graphWithSoftPreferenceUncertainty() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 3;
  graph.tasks = [{
    id: 'task-math', category: 'study', title: '数学', source: source('task'), createdRevision: 1,
  }];
  graph.temporalConstraints = [{
    id: 'preference-night',
    taskId: 'task-math',
    targetFactId: 'task-math',
    kind: 'preferred_window',
    constraintLevel: 'soft',
    dateExpression: null,
    namedTimePeriod: 'night',
    startTime: null,
    endTime: null,
    precision: 'unspecified',
    source: source('preference'),
    createdRevision: 2,
  }];
  graph.uncertainties = [{
    id: 'uncertainty-preference',
    targetFactId: 'preference-night',
    field: 'preferred_time_precision',
    reason: 'The user expressed a soft preference without exact bounds.',
    source: source('uncertainty'),
    createdRevision: 3,
  }];
  graph.factLifecycles = [
    { factId: 'task-math', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
    { factId: 'preference-night', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    { factId: 'uncertainty-preference', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
  ];
  return graph;
}

function compilation(issues: GenericSchedulerInputCompilationResult['issues']): GenericSchedulerInputCompilationResult {
  return { status: issues.some((issue) => issue.blocking) ? 'needs_resolution' : 'ready', input: null, issues };
}

const softUncertaintyIssue: GenericSchedulerInputCompilationResult['issues'][number] = {
  domain: 'semantic_uncertainty',
  code: 'semantic_uncertainty',
  blocking: true,
  factId: 'uncertainty-preference',
  details: {
    targetFactId: 'preference-night',
    field: 'preferred_time_precision',
    reason: 'soft preference without exact bounds',
    sourceText: 'できれば夜の方がいい',
  },
};

const missingEffortIssue: GenericSchedulerInputCompilationResult['issues'][number] = {
  domain: 'work_item',
  code: 'missing_effort_estimate',
  blocking: true,
  factId: 'workload-english',
  details: { taskId: 'task-english' },
};

describe('Stable V5 repair / pass-over policy', () => {
  it('defers a low-risk soft preference while repairing a more important independent issue', () => {
    const result = decideWeeklyPlanningStableRepairPolicyV5({
      graph: graphWithSoftPreferenceUncertainty(),
      compilation: compilation([softUncertaintyIssue, missingEffortIssue]),
      previousAgenda: [],
      graphRevision: 3,
      turnId: 'request-3',
    });

    expect(result.mode).toBe('explicit_repair');
    expect(result.question).toMatchObject({
      domain: 'work_item',
      code: 'missing_effort_estimate',
      factId: 'workload-english',
    });
    expect(result.deferredIssueIds).toEqual(['uncertainty-preference']);
    expect(result.agenda).toEqual([
      expect.objectContaining({
        issueFactId: 'uncertainty-preference',
        impact: 'low',
        status: 'deferred',
        reopenBefore: 'preview',
      }),
    ]);
  });

  it('reopens a deferred soft preference before preview when it is the only unresolved issue left', () => {
    const previousAgenda: WeeklyPlanningRepairObligationV5[] = [{
      id: 'repair:uncertainty-preference',
      issueFactId: 'uncertainty-preference',
      targetFactId: 'preference-night',
      domain: 'semantic_uncertainty',
      code: 'semantic_uncertainty',
      impact: 'low',
      status: 'deferred',
      createdRevision: 3,
      sourceTurnId: 'request-3',
      reopenBefore: 'preview',
    }];

    const result = decideWeeklyPlanningStableRepairPolicyV5({
      graph: graphWithSoftPreferenceUncertainty(),
      compilation: compilation([softUncertaintyIssue]),
      previousAgenda,
      graphRevision: 4,
      turnId: 'request-4',
    });

    expect(result.mode).toBe('explicit_repair');
    expect(result.reopenedIssueIds).toEqual(['uncertainty-preference']);
    expect(result.question).toMatchObject({
      domain: 'semantic_uncertainty',
      factId: 'uncertainty-preference',
    });
    expect(result.agenda[0]).toMatchObject({ status: 'open' });
  });

  it('never passes over semantic uncertainty unless its exact target is a soft preference constraint', () => {
    const graph = graphWithSoftPreferenceUncertainty();
    graph.uncertainties[0] = {
      ...graph.uncertainties[0],
      targetFactId: 'task-math',
      field: 'quantityRole',
      reason: 'target amount is unclear',
    };
    const highImpactIssue = {
      ...softUncertaintyIssue,
      details: {
        ...softUncertaintyIssue.details,
        targetFactId: 'task-math',
        field: 'quantityRole',
        reason: 'target amount is unclear',
      },
    } as GenericSchedulerInputCompilationResult['issues'][number];

    const result = decideWeeklyPlanningStableRepairPolicyV5({
      graph,
      compilation: compilation([highImpactIssue, missingEffortIssue]),
      previousAgenda: [],
      graphRevision: 3,
      turnId: 'request-3',
    });

    expect(result.question).toMatchObject({
      domain: 'semantic_uncertainty',
      factId: 'uncertainty-preference',
    });
    expect(result.deferredIssueIds).toEqual([]);
  });

  it('marks a deferred obligation resolved once the uncertainty fact is no longer active', () => {
    const graph = graphWithSoftPreferenceUncertainty();
    graph.factLifecycles = graph.factLifecycles.map((entry) =>
      entry.factId === 'uncertainty-preference'
        ? { ...entry, status: 'removed' as const, terminalRevision: 4 }
        : entry);
    const previousAgenda: WeeklyPlanningRepairObligationV5[] = [{
      id: 'repair:uncertainty-preference', issueFactId: 'uncertainty-preference',
      targetFactId: 'preference-night', domain: 'semantic_uncertainty', code: 'semantic_uncertainty',
      impact: 'low', status: 'deferred', createdRevision: 3, sourceTurnId: 'request-3', reopenBefore: 'preview',
    }];

    const result = decideWeeklyPlanningStableRepairPolicyV5({
      graph,
      compilation: compilation([]),
      previousAgenda,
      graphRevision: 4,
      turnId: 'request-4',
    });

    expect(result.mode).toBe('continue');
    expect(result.agenda).toEqual([
      expect.objectContaining({ issueFactId: 'uncertainty-preference', status: 'resolved' }),
    ]);
  });
});
