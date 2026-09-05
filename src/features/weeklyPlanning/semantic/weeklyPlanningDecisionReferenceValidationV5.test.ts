import { describe, expect, it } from 'vitest';
import type {
  SemanticDecisionV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningDecisionTargetReferencesV5,
} from './weeklyPlanningDecisionReferenceValidationV5';

function task(localId = 'task-1'): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  return {
    localId,
    category: 'study',
    title: '数学',
    study: null,
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: '数学を進めます',
  };
}

function documentWith(
  decision: SemanticDecisionV5,
  tasks: WeeklyPlanningSemanticDocumentV5['tasks'] = [],
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks,
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

  it('rejects a dangling current-turn local id', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(documentWith(decision({
      kind: 'task',
      publicId: null,
      localId: 'missing-task',
      mention: '数学',
    })))).toEqual([
      'document.decisions[0].target:unknown-current-turn-task:missing-task',
    ]);
  });

  it('rejects a local id whose fact kind does not match the declared reference kind', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(
      documentWith(decision({
        kind: 'workload',
        publicId: null,
        localId: 'task-1',
        mention: '数学',
      }), [task()]),
    )).toEqual([
      'document.decisions[0].target:unknown-current-turn-workload:task-1',
    ]);
  });

  it('accepts a current-turn local target that exists with the declared kind', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(
      documentWith(decision({
        kind: 'task',
        publicId: null,
        localId: 'task-1',
        mention: '数学',
      }), [task()]),
    )).toEqual([]);
  });

  it('accepts a known active public target even when a mention is also present', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(
      documentWith(decision({
        kind: 'task',
        publicId: 'task_public_1',
        localId: null,
        mention: '数学',
      })),
      { tasks: [{ publicId: 'task_public_1', title: '数学' }] },
    )).toEqual([]);
  });

  it('rejects an unknown or wrong-kind public target when public state is available', () => {
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(
      documentWith(decision({
        kind: 'task',
        publicId: 'workload_public_1',
        localId: null,
        mention: '数学',
      })),
      { workloads: [{ publicId: 'workload_public_1', amount: 20 }] },
    )).toEqual([
      'document.decisions[0].target:unknown-active-task:workload_public_1',
    ]);
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

  it('accepts only a proposal public id present in current public state', () => {
    const proposalDecision = documentWith(decision({
      kind: 'proposal',
      publicId: 'proposal_public_1',
      localId: null,
      mention: 'この提案',
    }));

    expect(validateWeeklyPlanningDecisionTargetReferencesV5(
      proposalDecision,
      { learningStrategyProposals: [{ publicId: 'proposal_public_1', status: 'pending' }] },
    )).toEqual([]);
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(
      proposalDecision,
      { learningStrategyProposals: [] },
    )).toEqual([
      'document.decisions[0].target:unknown-active-proposal:proposal_public_1',
    ]);
  });
});
