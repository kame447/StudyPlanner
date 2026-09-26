import { describe, expect, it } from 'vitest';
import type {
  SemanticDecisionV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningDecisionTargetReferencesV5,
} from './weeklyPlanningDecisionReferenceValidationV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

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

function availabilityDeclaration(localId = 'availability-1'):
  WeeklyPlanningSemanticDocumentV5['availabilityDeclarations'][number] {
  return {
    localId,
    kind: 'available',
    dateExpression: 'next_week',
    namedTimePeriod: null,
    startTime: '09:00',
    endTime: '10:00',
    recurrenceKind: null,
    days: [],
    constraintLevel: 'hard',
    capacityMinutes: null,
    sourceText: '来週の9時から10時は勉強できます',
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

  it('fails closed for a current-turn availability decision, including a matching declaration id', () => {
    const document = documentWith(decision({
      kind: 'availability_declaration',
      publicId: null,
      localId: 'availability-1',
      mention: '来週の空き時間',
    }));
    document.availabilityDeclarations = [availabilityDeclaration()];

    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document)).toEqual([
      'document.decisions[0].target:unknown-current-turn-availability_declaration:availability-1',
    ]);
    document.decisions[0].target.localId = 'task-1';
    document.tasks = [task()];
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document)).toEqual([
      'document.decisions[0].target:unknown-current-turn-availability_declaration:task-1',
    ]);
  });

  it('fails closed for a public availability decision, including an existing id', () => {
    const document = documentWith(decision({
      kind: 'availability_declaration',
      publicId: 'availability-public-1',
      localId: null,
      mention: '来週の空き時間',
    }));
    const publicState = {
      availabilityDeclarations: [{ publicId: 'availability-public-1', kind: 'available' }],
      tasks: [{ publicId: 'task-public-1', title: '数学' }],
    };

    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document, publicState)).toEqual([
      'document.decisions[0].target:unknown-active-availability_declaration:availability-public-1',
    ]);
    document.decisions[0].target.publicId = 'task-public-1';
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document, publicState)).toEqual([
      'document.decisions[0].target:unknown-active-availability_declaration:task-public-1',
    ]);
    document.decisions[0].target.publicId = 'unknown-id';
    expect(validateWeeklyPlanningDecisionTargetReferencesV5(document, publicState)).toEqual([
      'document.decisions[0].target:unknown-active-availability_declaration:unknown-id',
    ]);
  });

  it('rejects an availability decision at the semantic response boundary', () => {
    const document = documentWith(decision({
      kind: 'availability_declaration',
      publicId: 'availability-public-1',
      localId: null,
      mention: '来週の空き時間',
    }));
    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
      currentUserText: 'これを承認します',
      publicStateSummary: {
        availabilityDeclarations: [{ publicId: 'availability-public-1', kind: 'available' }],
      },
    });

    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.decisions[0].target.kind');
  });

  // V09 characterization: the decision kind must remain rejected until the
  // deterministic application path changes the addressed availability fact.
  it.fails('applies a rejected availability decision to the exact active declaration', () => {
    const initial = createEmptyWeeklyPlanningFactGraphV5();
    const declarationDocument = documentWith(decision({
      kind: 'task', publicId: null, localId: 'unused', mention: null,
    }));
    declarationDocument.decisions = [];
    declarationDocument.availabilityDeclarations = [availabilityDeclaration()];
    const declared = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: initial,
      document: declarationDocument,
      context: { conversationId: 'v09', turnId: 'declare', expectedRevision: initial.revision },
    });
    expect(declared.status).toBe('applied');
    const original = declared.graph;
    const availabilityId = original.availabilityDeclarations[0].id;

    // This compatibility probe passes the base validator as planning_window,
    // then restores the typed availability target before application. It keeps
    // the test focused on the downstream decision lifecycle without opening
    // the public semantic response boundary.
    const probeDocument = documentWith({
      ...decision({ kind: 'planning_window', publicId: availabilityId, localId: null, mention: null }),
      decision: 'reject',
    });
    const probe = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: original,
      document: probeDocument,
      context: { conversationId: 'v09', turnId: 'reject', expectedRevision: original.revision },
    });
    expect(probe.status).toBe('applied');
    const typedProbe = {
      ...probe,
      graph: {
        ...probe.graph,
        decisionIntents: probe.graph.decisionIntents.map((intent) => ({
          ...intent,
          target: { ...intent.target, kind: 'availability_declaration' as const },
        })),
      },
    };
    const committed = finalizeWeeklyPlanningSemanticCanonicalizationV5({
      originalGraph: original,
      document: probeDocument,
      baseCanonicalization: typedProbe,
      contextualAnswer: false,
      questionCode: null,
      operationKeyPrefix: 'v09:reject',
    });

    expect(committed.canonicalization.status).toBe('applied');
    expect(committed.canonicalization.graph.factLifecycles.find(
      (entry) => entry.factId === availabilityId,
    )?.status).toBe('removed');
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
