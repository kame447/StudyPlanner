import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  normalizeTaskBoundariesV5,
  taskBoundaryConformanceErrorsV5,
} from './weeklyPlanningTaskBoundaryContractV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-container',
      category: 'study',
      title: '物理',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [
          {
            localId: 'component-physics',
            parentLocalId: null,
            role: 'subject',
            label: '物理',
            workloads: [],
            sourceText: '物理',
          },
          {
            localId: 'component-chemistry',
            parentLocalId: null,
            role: 'subject',
            label: '化学',
            workloads: [],
            sourceText: '化学',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '物理と化学',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 task boundary ownership', () => {
  it('never renames or splits the AI-selected task structure', () => {
    const input = document();
    expect(normalizeTaskBoundariesV5(input)).toEqual({
      document: input,
      repairs: [],
    });
    expect(taskBoundaryConformanceErrorsV5(input)).toEqual([]);
  });
});
