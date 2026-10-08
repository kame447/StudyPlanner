import { describe, expect, it } from 'vitest';
import { conditionDocument, conditionSetupDocument } from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { hasWeeklyPlanningEvidenceCoverageTaskModificationV5 } from './weeklyPlanningSemanticEvidenceCoverageNeedV5';

function fixture() {
  const setup = conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5;
  const accepted = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: setup,
    context: { conversationId: 'coverage-scope', turnId: 'setup', expectedRevision: 0 } });
  if (accepted.status !== 'applied') throw new Error('scope fixture rejected');
  const graph = accepted.graph;
  const task = { ...setup.tasks[0], existingPublicId: graph.tasks[0].id, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [] };
  const document = conditionDocument({ planningIntent: 'update_plan', tasks: [task] }) as unknown as WeeklyPlanningSemanticDocumentV5;
  return { graph, task: document.tasks[0], document };
}

describe('typed scope for a literal-gap modification audit', () => {
  it.each(['workload', 'effort', 'temporal', 'recurrence', 'component_workload'] as const)('includes %s on an accepted task', kind => {
    const f = fixture();
    if (kind === 'workload') f.task.workloads = (conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5).tasks[0].workloads;
    if (kind === 'effort') f.task.effortEstimates = [{ localId: 'cap', targetLocalId: f.task.localId, kind: 'session_duration', minutes: 60, unitCode: null, precision: 'exact', sourceText: 'typed estimate' }];
    if (kind === 'temporal') f.task.temporalConstraints = [{ localId: 'window', targetLocalId: f.task.localId, kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'exact', sourceText: 'typed timing' }];
    if (kind === 'recurrence') f.task.recurrence = [{ localId: 'count', targetLocalId: f.task.localId, kind: 'custom', count: 2, days: [], sourceText: 'typed count' }];
    if (kind === 'component_workload') f.task.study!.components = [{ localId: 'part', existingPublicId: null, parentLocalId: null, role: 'section', label: 'part', sourceText: 'typed part', workloads: (conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5).tasks[0].workloads, durableContextSignals: [] }];
    expect(hasWeeklyPlanningEvidenceCoverageTaskModificationV5({ document: f.document, committedGraph: f.graph })).toBe(true);
  });

  it.each(['no_graph', 'new_task', 'mixed_new_task', 'unknown_task', 'inactive_task', 'identity_only', 'empty'] as const)('keeps %s with its existing route', kind => {
    const f = fixture();
    if (kind !== 'identity_only' && kind !== 'empty') f.task.effortEstimates = [{ localId: 'cap', targetLocalId: f.task.localId, kind: 'session_duration', minutes: 60, unitCode: null, precision: 'exact', sourceText: 'typed estimate' }];
    if (kind === 'empty') f.document.tasks = [];
    if (kind === 'new_task') f.task.existingPublicId = null;
    if (kind === 'unknown_task') f.task.existingPublicId = 'not-an-active-task';
    if (kind === 'inactive_task') f.graph.factLifecycles.find(lifecycle => lifecycle.factId === f.task.existingPublicId)!.status = 'superseded';
    if (kind === 'identity_only') f.task.study!.components = [{ localId: 'material', existingPublicId: null, parentLocalId: null, role: 'material', label: 'named material', sourceText: 'typed identity', workloads: [], durableContextSignals: [] }];
    if (kind === 'mixed_new_task') {
      f.task.workloads = (conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5).tasks[0].workloads;
      f.document.tasks.push({ ...f.task, localId: 'new', existingPublicId: null });
    }
    expect(hasWeeklyPlanningEvidenceCoverageTaskModificationV5({ document: f.document, committedGraph: kind === 'no_graph' ? undefined : f.graph })).toBe(false);
  });
});
