import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticEvidenceV5 } from './weeklyPlanningSemanticEvidenceV5';

function updateDocument(sourceText: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task_1',
      existingPublicId: 'wpf_task_math',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '数学のワーク',
      study: { purpose: 'practice', contextLabel: null, components: [] },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'tc_1',
        targetLocalId: 'task_1',
        kind: 'preferred_window',
        constraintLevel: 'soft',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: 'night',
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        sourceText,
      }],
      recurrence: [],
      durableContextSignals: [],
      sourceText,
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
  it('rejects previous-turn temporal facts copied into an ordinary update delta', () => {
    const errors = validateWeeklyPlanningSemanticEvidenceV5({
      document: updateDocument('数学は火曜の夜にして'),
      input: {
        userText: 'これで追加して',
        publicStateSummary: {
          pendingQuestion: null,
          tasks: [{ publicId: 'wpf_task_math', title: '数学のワーク' }],
        },
      },
    });
    expect(errors).toContain(
      'document.tasks[0].temporalConstraints[0].sourceText:not-grounded-in-current-user-text',
    );
  });

  it('accepts a temporal update grounded in the current user utterance', () => {
    const errors = validateWeeklyPlanningSemanticEvidenceV5({
      document: updateDocument('数学は火曜の夜にして'),
      input: {
        userText: '数学は火曜の夜にして',
        publicStateSummary: {
          pendingQuestion: null,
          tasks: [{ publicId: 'wpf_task_math', title: '数学のワーク' }],
        },
      },
    });
    expect(errors).toEqual([]);
  });
});
