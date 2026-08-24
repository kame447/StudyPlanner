import { describe, expect, it } from 'vitest';
import type {
  SemanticDecisionV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningDecisionTargetReferencesV5,
} from './weeklyPlanningDecisionReferenceValidationV5';

function documentWith(decision: SemanticDecisionV5): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [decision],
  };
}

function decision(target: SemanticDecisionV5['target']): SemanticDecisionV5 {
  return {
    localId: 'decision-1',
    target,
    decision: 'accept',
    sourceText: 'これを承認します',
  };
}

describe('validateWeeklyPlanningDecisionTargetReferencesV5', () => {
  it('rejects a mention-only durable decision target', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(documentWith(decision({
      kind: 'task',
      publicId: null,
      localId: null,
      mention: '別のtask',
    })))).toEqual([
      'document.decisions[0].target:requires-machine-addressable-id',
    ]);
  });

  it('accepts a current-turn local target', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(documentWith(decision({
      kind: 'task',
      publicId: null,
      localId: 'task-1',
      mention: '数学',
    })))).toEqual([]);
  });

  it('accepts a public target even when a human-readable mention is also present', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(documentWith(decision({
      kind: 'task',
      publicId: 'task_public_1',
      localId: null,
      mention: '数学',
    })))).toEqual([]);
  });

  it('requires an exact public id for proposal decisions', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(documentWith(decision({
      kind: 'proposal',
      publicId: null,
      localId: 'proposal-local',
      mention: 'この提案',
    })))).toEqual([
      'document.decisions[0].target:proposal-requires-public-id',
    ]);
  });

  it('accepts a proposal public id', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(documentWith(decision({
      kind: 'proposal',
      publicId: 'proposal_public_1',
      localId: null,
      mention: 'この提案',
    })))).toEqual([]);
  });
});
