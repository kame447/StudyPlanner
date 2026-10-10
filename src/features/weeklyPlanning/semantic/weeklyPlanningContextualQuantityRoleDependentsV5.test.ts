import { weeklyPlanningIntroducedActiveFactReferenceErrorsV5 } from './weeklyPlanningActiveFactReferenceInvariantV5';
import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';
import { workloadLifecycleFixture } from '../testUtils/__tests__/weeklyPlanningWorkloadLifecycleFixture';
import { eventDocument, eventStudyTask } from '../testUtils/__tests__/weeklyPlanningCorrectionIntegrityFixture';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

function answer(graph: WeeklyPlanningFactGraphV5) {
  const task = eventStudyTask('problem');
  const document = eventDocument({ planningIntent: 'discuss', tasks: [{ ...task, existingPublicId: 'task', title: 'synthetic',
    workloads: [{ ...task.workloads[0], quantityRole: 'target' }] }] }) as unknown as WeeklyPlanningSemanticDocumentV5;
  return applyWeeklyPlanningStableV5ContextualAnswer({ graph, document,
    pendingQuestion: { actionId: null, questionCode: 'quantity_role_unresolved', targetFactId: 'work', graphRevision: graph.revision },
    conversationId: 'lifecycle-synthetic', turnId: 'answer', expectedRevision: graph.revision,
    userText: 'typed answer, never interpreted' });
}

describe('quantity-role replacement uses the explicit dependent policy', () => {
  it.each(['duration_per_unit', 'session_duration', 'total_duration'] as const)('handles %s without creating dangling operational references', effortKind => {
    const graph = workloadLifecycleFixture({ effortKind });
    const before = JSON.stringify(graph);
    const result = answer(graph);
    expect(result?.status).toBe('applied');
    expect(JSON.stringify(graph)).toBe(before);
    const updated = result!.graph;
    const active = new Set(updated.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    const replacement = updated.workloads.find(fact => active.has(fact.id))!;
    expect(replacement.quantityRole).toBe('target');
    const efforts = updated.effortEstimates.filter(fact => active.has(fact.id));
    if (effortKind === 'total_duration') {
      expect(efforts).toEqual([]);
      expect(result!.diff?.removed).toContainEqual({ kind: 'effort_estimate', id: 'pace' });
    } else {
      expect(efforts).toHaveLength(1);
      expect(efforts[0]).toMatchObject({ kind: effortKind, minutes: 3, targetFactId: replacement.id, unitCode: 'problem' });
      expect(updated.effortEstimates[0].targetFactId).toBe('work');
      expect(updated.factLifecycles.find(entry => entry.factId === 'pace')?.status).toBe('superseded');
      expect(efforts[0].source.sourceText).toBe(graph.effortEstimates[0].source.sourceText);
    }
    expect(weeklyPlanningIntroducedActiveFactReferenceErrorsV5({ originalGraph: graph, graph: updated })).toEqual([]);
    expect(validateWeeklyPlanningFactGraphValueV5(updated).errors).toEqual([]);
  });

  it('rejects an unsupported workload uncertainty atomically through the existing policy', () => {
    const graph = workloadLifecycleFixture();
    graph.uncertainties.push({ id: 'unsupported', targetFactId: 'work', field: 'opaque', reason: 'unresolved detail', source: graph.workloads[0].source, createdRevision: 1 });
    graph.factLifecycles.push({ factId: 'unsupported', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const before = JSON.stringify(graph);
    const result = answer(graph);
    expect(result?.status).toBe('rejected');
    expect(result?.graph).toBe(graph);
    expect(result?.errors[0]).toContain('uncertainty-rebinding-needs-explicit-semantic-policy');
    expect(JSON.stringify(graph)).toBe(before);
  });
});
