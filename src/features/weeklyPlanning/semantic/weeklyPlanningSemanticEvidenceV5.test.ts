import { describe, expect, it } from 'vitest';
import type {
  SemanticWorkloadV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticEvidenceV5 } from './weeklyPlanningSemanticEvidenceV5';

function workload(
  localId: string,
  quantityRole: SemanticWorkloadV5['quantityRole'],
  amount: number,
  unitCode: SemanticWorkloadV5['unitCode'] = 'page',
): SemanticWorkloadV5 {
  return {
    localId,
    quantityRole,
    amount,
    unitCode,
    unitLabel: unitCode === 'page' ? 'ページ' : unitCode,
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    sourceText: 'structured semantic evidence',
  };
}

function documentWithWorkloads(
  workloads: SemanticWorkloadV5[],
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task_1',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '数学のワーク',
      study: { purpose: 'practice', contextLabel: null, components: [] },
      workloads,
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: 'structured semantic evidence',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 semantic evidence', () => {
  it('rejects unresolved declared progress beside completed workload on the same basis', () => {
    const errors = validateWeeklyPlanningSemanticEvidenceV5({
      document: documentWithWorkloads([
        workload('wl_total', 'declared', 80),
        workload('wl_completed', 'completed', 30),
      ]),
    });

    expect(errors).toEqual([
      'document.tasks[0].workloads[0].quantityRole:declared-cannot-coexist-with-completed-same-target-unit;resolve-progress-to-remaining-difference-or-emit-uncertainty',
    ]);
  });

  it('accepts declared workload when no completed peer shares its basis', () => {
    const errors = validateWeeklyPlanningSemanticEvidenceV5({
      document: documentWithWorkloads([
        workload('wl_total', 'declared', 80),
      ]),
    });

    expect(errors).toEqual([]);
  });

  it('does not conflate progress across different workload units', () => {
    const errors = validateWeeklyPlanningSemanticEvidenceV5({
      document: documentWithWorkloads([
        workload('wl_pages', 'declared', 80, 'page'),
        workload('wl_problems', 'completed', 30, 'problem'),
      ]),
    });

    expect(errors).toEqual([]);
  });
});
