import { describe, expect, it } from 'vitest';
import { compileWithWeeklyPlanningWindowQuestionSuspension } from './weeklyPlanningWindowQuestionClosure';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { eventDocument, eventStudyTask, fixedEventTask } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';

const context = { ownerId: 'synthetic', currentDate: '2026-10-07', planningStartDate: '2026-10-07', planningEndDate: '2026-10-07', timeZone: 'Asia/Tokyo' };
function graphWithWindowNeed(tasks: unknown[] = [], targetLocalId = 'window') {
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ document: eventDocument({
    planningWindow: { localId: 'window', kind: 'relative_day', value: 'today', start: null, end: null, sourceText: '今日' },
    tasks, uncertainties: [{ localId: 'need', targetLocalId, field: 'opaque', reason: 'Synthetic unresolved detail', sourceText: '確認' }],
  }) as unknown as WeeklyPlanningSemanticDocumentV5, context: { conversationId: 'unit', turnId: 'one', expectedRevision: 0 } });
  expect(result.status).toBe('applied');
  return createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph);
}

describe('window question suspension is a read-only compiler projection', () => {
  it.each([{ tasks: [] }, { tasks: [fixedEventTask()] }])('suspends only window needs for empty/fixed-only work and retains source graph (%#)', ({ tasks }) => {
    const graph = graphWithWindowNeed(tasks);
    const before = JSON.stringify(graph);
    const raw = compileGenericSchedulerInput({ graph, context });
    expect(raw.status).toBe('needs_resolution');
    const result = compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'interaction_v1', compile: view => compileGenericSchedulerInput({ graph: view, context }) });
    expect(result.status).toBe(tasks.length ? 'ready' : 'empty');
    expect(result.input?.movableWorkItems ?? []).toEqual([]);
    expect(JSON.stringify(graph)).toBe(before);
    expect(graph.uncertainties).toHaveLength(1);
  });

  it.each(['study', 'non_study'] as const)('does not suspend a real date need for movable %s work', category => {
    const task = { ...eventStudyTask(), category, ...(category === 'non_study' ? { study: null } : {}) };
    const graph = graphWithWindowNeed([task]);
    const result = compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'interaction_v1', compile: view => compileGenericSchedulerInput({ graph: view, context }) });
    expect(result.status).toBe('needs_resolution');
    expect(result.issues.some(issue => issue.code === 'semantic_uncertainty')).toBe(true);
    expect(result.input).toBeNull();
  });

  it('leaves incomplete study work blocking even though a blocked input has no movable list', () => {
    const graph = graphWithWindowNeed([eventStudyTask('problem')]);
    const result = compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'interaction_v1', compile: view => compileGenericSchedulerInput({ graph: view, context }) });
    expect(result.status).toBe('needs_resolution');
    expect(result.issues.some(issue => issue.code === 'missing_effort_estimate')).toBe(true);
    expect(result.issues.some(issue => issue.code === 'semantic_uncertainty')).toBe(true);
  });

  it('does not suspend a task-targeted need in otherwise fixed-only work', () => {
    const graph = graphWithWindowNeed([fixedEventTask()], 'club');
    const result = compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'interaction_v1', compile: view => compileGenericSchedulerInput({ graph: view, context }) });
    expect(result.status).toBe('needs_resolution');
    expect(result.issues.some(issue => issue.code === 'semantic_uncertainty')).toBe(true);
  });

  it('does not hide required date scope for an incomplete fixed event', () => {
    const task = fixedEventTask();
    const graph = graphWithWindowNeed([{ ...task, temporalConstraints: task.temporalConstraints.map(fact => ({ ...fact, dateExpression: null })) }]);
    // One day legitimately supplies a commitment date. A week cannot choose it.
    const ambiguousContext = { ...context, planningEndDate: '2026-10-13' };
    const result = compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'interaction_v1', compile: view => compileGenericSchedulerInput({ graph: view, context: ambiguousContext }) });
    expect(result.status).toBe('needs_resolution');
    expect(result.issues.some(issue => issue.code === 'missing_commitment_date_scope')).toBe(true);
  });

  it('keeps legacy compiler output byte-identical', () => {
    const graph = graphWithWindowNeed([fixedEventTask()]);
    const compile = (view: typeof graph) => compileGenericSchedulerInput({ graph: view, context });
    expect(JSON.stringify(compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'legacy_v5', compile })))
      .toBe(JSON.stringify(compile(graph)));
  });

  it.each(['study', 'study-amount', 'material'])('retains required task/component/workload question for %s', targetLocalId => {
    const task = eventStudyTask();
    const component = { localId: 'material', existingPublicId: null, parentLocalId: null, role: 'material', label: '教材', workloads: [], sourceText: '教材' };
    const graph = graphWithWindowNeed([{ ...task, study: { ...task.study, components: [component] } }], targetLocalId);
    const result = compileWithWeeklyPlanningWindowQuestionSuspension({ graph, architecture: 'interaction_v1', compile: view => compileGenericSchedulerInput({ graph: view, context }) });
    expect(result.status).toBe('needs_resolution');
    expect(result.issues.some(issue => issue.blocking && issue.code === 'semantic_uncertainty')).toBe(true);
    expect(result.input).toBeNull();
    expect(graph.uncertainties).toHaveLength(1);
  });
});
