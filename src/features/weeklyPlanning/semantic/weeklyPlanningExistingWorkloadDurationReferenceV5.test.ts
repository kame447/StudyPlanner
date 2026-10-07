import { describe, expect, it } from 'vitest';
import { conditionDocument, conditionSetupDocument, CONDITION_FOLLOWUP } from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { projectWeeklyPlanningExistingWorkloadRateReferenceV5, bindWeeklyPlanningExistingWorkloadRatesV5 } from './weeklyPlanningExistingWorkloadRateReferenceV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

function fixture(kind: 'session_duration' | 'total_duration' = 'session_duration') {
  const accepted = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5,
    context: { conversationId: 'duration', turnId: 'setup', expectedRevision: 0 } });
  if (accepted.status !== 'applied') throw new Error('fixture setup rejected');
  const graph = accepted.graph;
  const target = graph.workloads.find(workload => workload.unitCode === 'hour')!;
  const task = graph.tasks.find(task => task.id === target.taskId)!;
  const estimate = { localId: 'session', targetLocalId: target.id, kind, minutes: 60,
    unitCode: kind === 'session_duration' ? 'session' : null, precision: 'approximate', sourceText: '1回1時間くらいで2回に分けたい' };
  const shell = { localId: 'answer', existingPublicId: task.id, decompositionStatus: 'atomic', category: 'study', title: task.title,
    study: null, workloads: [], effortEstimates: [estimate], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: CONDITION_FOLLOWUP };
  return { graph, target, estimate, shell, document: conditionDocument({ planningIntent: 'update_plan', tasks: [shell] }) };
}

describe('exact-ID duration reference binding', () => {
  it.each(['session_duration', 'total_duration'] as const)('retains the exact accepted workload for %s', kind => {
    const f = fixture(kind);
    const projected = projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse: JSON.stringify(f.document), graph: f.graph });
    expect(projected.repairs).toHaveLength(1);
    const validation = validateWeeklyPlanningSemanticResponseV5(projected.rawResponse, {
      currentUserText: CONDITION_FOLLOWUP, committedGraph: f.graph, conversationArchitecture: 'interaction_v1',
      publicStateSummary: { tasks: f.graph.tasks.map(task => ({ publicId: task.id, title: task.title, category: task.category })) },
    });
    expect(validation.errors).toEqual([]);
    const document = validation.document!;
    expect(document.tasks[0].workloads).toEqual([]);
    expect(document.tasks[0].effortEstimates[0].targetLocalId).toBe(f.shell.localId);
    const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: f.graph, document,
      context: { conversationId: 'duration', turnId: 'answer', expectedRevision: f.graph.revision } });
    const bound = bindWeeklyPlanningExistingWorkloadRatesV5({ originalGraph: f.graph, document, canonicalization: base, algorithmicRepairs: projected.repairs });
    expect(bound.status).toBe('applied');
    if (bound.status !== 'applied') throw new Error('answer rejected');
    expect(bound.graph.effortEstimates[0].targetFactId).toBe(f.target.id);
    expect(bound.graph.workloads.map(workload => workload.amount)).toEqual(f.graph.workloads.map(workload => workload.amount));
  });

  it.each(['unknown-id', 'wrong-task', 'superseded', 'double-citation', 'new-workload'] as const)('leaves %s for the normal validator', variant => {
    const f = fixture();
    if (variant === 'unknown-id') f.estimate.targetLocalId += '-typo';
    if (variant === 'wrong-task') f.shell.existingPublicId = f.graph.tasks.find(task => task.id !== f.target.taskId)!.id;
    if (variant === 'superseded') f.graph.factLifecycles.find(lifecycle => lifecycle.factId === f.target.id)!.status = 'superseded';
    if (variant === 'double-citation') f.shell.effortEstimates.push({ ...f.estimate, localId: 'other' });
    if (variant === 'new-workload') Object.assign(f.shell, { workloads: [{ localId: 'new-work', amount: 60, unitCode: 'minute' }] });
    const rawResponse = JSON.stringify(f.document);
    expect(projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse, graph: f.graph })).toEqual({ rawResponse, repairs: [] });
  });

  it('leaves the legacy response rejection and wire text unchanged', () => {
    const f = fixture();
    const { conversationActs: _acts, ...legacyDocument } = f.document;
    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(legacyDocument), {
      currentUserText: CONDITION_FOLLOWUP, committedGraph: f.graph, conversationArchitecture: 'legacy_v5',
      publicStateSummary: { tasks: f.graph.tasks.map(task => ({ publicId: task.id, title: task.title, category: task.category })) },
    });
    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].effortEstimates[0].targetLocalId');
    expect(result.algorithmicRepairs).toEqual([`existing-study-task-shell-filled:answer:${f.shell.existingPublicId}`]);
  });
});
