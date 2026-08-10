import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  allowsInheritedWorkloadEvidenceForContextualAnswerV5,
  isWeeklyPlanningMachineContextualValidationEnvelopeV5,
} from './weeklyPlanningContextualValidationBoundaryV5';

function document(
  planningIntent: WeeklyPlanningSemanticDocumentV5['planningIntent'] = 'discuss',
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent,
    planningWindow: null,
    tasks: [{
      localId: 'task-answer',
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'study',
      title: 'レポート執筆',
      study: {
        purpose: 'homework',
        contextLabel: null,
        components: [],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '3時間です',
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

function stateSummary(
  questionCode: 'missing_effort_estimate' | 'quantity_role_unresolved',
  pendingRevision = 3,
) {
  return {
    graphRevision: 3,
    pendingQuestion: {
      actionId: `action-${questionCode}`,
      questionCode,
      targetFactId: 'workload-writing',
      graphRevision: pendingRevision,
    },
  };
}

describe('Stable V5 contextual validation boundary', () => {
  it('recognizes only a structurally minimal machine-targeted pending answer', () => {
    expect(isWeeklyPlanningMachineContextualValidationEnvelopeV5({
      document: document(),
      publicStateSummary: stateSummary('missing_effort_estimate'),
    })).toBe(true);
  });

  it('does not defer validation for create-plan turns', () => {
    expect(isWeeklyPlanningMachineContextualValidationEnvelopeV5({
      document: document('create_plan'),
      publicStateSummary: stateSummary('missing_effort_estimate'),
    })).toBe(false);
  });

  it('does not defer validation across graph revisions', () => {
    expect(isWeeklyPlanningMachineContextualValidationEnvelopeV5({
      document: document(),
      publicStateSummary: stateSummary('missing_effort_estimate', 2),
    })).toBe(false);
  });

  it('allows inherited workload scaffolding only for effort answers', () => {
    expect(allowsInheritedWorkloadEvidenceForContextualAnswerV5({
      document: document(),
      publicStateSummary: stateSummary('missing_effort_estimate'),
    })).toBe(true);
    expect(allowsInheritedWorkloadEvidenceForContextualAnswerV5({
      document: document(),
      publicStateSummary: stateSummary('quantity_role_unresolved'),
    })).toBe(false);
  });
});
