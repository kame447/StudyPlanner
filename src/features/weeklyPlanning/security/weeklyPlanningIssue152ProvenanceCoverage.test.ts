import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
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
    decisions: [],
  };
}

function existingTask(params: {
  publicId: string;
  title: string;
  sourceText: string;
}): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  return {
    localId: `local-${params.publicId}`,
    existingPublicId: params.publicId,
    decompositionStatus: 'atomic',
    category: 'study',
    title: params.title,
    study: {
      purpose: 'practice',
      contextLabel: null,
      components: [],
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.sourceText,
  };
}

describe('Issue #152 current-turn provenance branch audit', () => {
  it('rejects a stored sibling task title laundered into an existing task rename', () => {
    const document = emptyDocument();
    document.tasks = [existingTask({
      publicId: 'task-math',
      title: '英語',
      sourceText: '20問にします',
    })];

    const errors = validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '20問にします',
      publicStateSummary: {
        tasks: [
          { publicId: 'task-math', category: 'study', title: '数学' },
          { publicId: 'task-english', category: 'study', title: '英語' },
        ],
      },
    });

    expect(errors).toContain(
      'document.tasks[0].title:copied-from-stored-context-without-current-mention',
    );
  });

  it('rejects a stored sibling component label laundered into an existing component rename', () => {
    const document = emptyDocument();
    const task = existingTask({
      publicId: 'task-math',
      title: '数学',
      sourceText: '20問にします',
    });
    task.study!.components = [{
      localId: 'component-current',
      existingPublicId: 'component-current',
      parentLocalId: null,
      role: 'material',
      label: '別教材',
      workloads: [],
      durableContextSignals: [],
      sourceText: '20問にします',
    }];
    document.tasks = [task];

    const errors = validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '20問にします',
      publicStateSummary: {
        tasks: [{ publicId: 'task-math', category: 'study', title: '数学' }],
        components: [
          {
            publicId: 'component-current',
            taskPublicId: 'task-math',
            role: 'material',
            label: '問題集',
          },
          {
            publicId: 'component-sibling',
            taskPublicId: 'task-math',
            role: 'material',
            label: '別教材',
          },
        ],
      },
    });

    expect(errors).toContain(
      'document.tasks[0].study.components[0].label:copied-from-stored-context-without-current-mention',
    );
  });

  it('rejects empty source evidence instead of treating an empty substring as grounded', () => {
    const document = emptyDocument();
    document.tasks = [{
      ...existingTask({
        publicId: 'unused-shell',
        title: '数学',
        sourceText: '',
      }),
      existingPublicId: null,
    }];

    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '数学を20問進めたいです',
    })).toContain(
      'document.tasks[0].sourceText:not-grounded-in-current-user-text',
    );
  });

  it('authorizes stored identity reuse only through the exact pending target chain', () => {
    const document = emptyDocument();
    document.tasks = [{
      ...existingTask({
        publicId: 'unused-shell',
        title: '数学',
        sourceText: '20問です',
      }),
      existingPublicId: null,
    }];

    const errors = validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '20問です',
      publicStateSummary: {
        pendingQuestion: { targetFactId: 'workload-english' },
        tasks: [
          { publicId: 'task-math', category: 'study', title: '数学' },
          { publicId: 'task-english', category: 'study', title: '英語' },
        ],
        workloads: [
          { publicId: 'workload-math', taskPublicId: 'task-math' },
          { publicId: 'workload-english', taskPublicId: 'task-english' },
        ],
      },
    });

    expect(errors).toContain(
      'document.tasks[0].title:copied-from-stored-context-without-current-mention',
    );
  });

  it('requires current-turn evidence across every security-relevant nested semantic fact family', () => {
    const currentUserText = '数学を20問進めたいです';
    const staleSource = 'stored-only evidence';
    const document = emptyDocument();
    const task = existingTask({
      publicId: 'task-math',
      title: '数学',
      sourceText: currentUserText,
    });
    task.workloads = [{
      localId: 'workload-1',
      quantityRole: 'target',
      amount: 20,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: staleSource,
    }];
    task.effortEstimates = [{
      localId: 'effort-1',
      targetLocalId: 'workload-1',
      kind: 'duration_per_unit',
      minutes: 5,
      unitCode: 'problem',
      precision: 'approximate',
      sourceText: staleSource,
    }];
    task.temporalConstraints = [{
      localId: 'time-1',
      targetLocalId: 'local-task-math',
      kind: 'deadline',
      constraintLevel: 'hard',
      dateExpression: '金曜',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      precision: 'unspecified',
      sourceText: staleSource,
    }];
    task.recurrence = [{
      localId: 'recurrence-1',
      targetLocalId: 'local-task-math',
      kind: 'daily',
      count: null,
      days: [],
      sourceText: staleSource,
    }];
    task.durableContextSignals = [{
      localId: 'concern-1',
      kind: 'concern',
      basis: 'worry',
      value: '難しい',
      sourceText: staleSource,
    }];
    task.study!.components = [{
      localId: 'component-1',
      existingPublicId: 'component-math',
      parentLocalId: null,
      role: 'material',
      label: '問題集',
      workloads: [{
        localId: 'component-workload-1',
        quantityRole: 'target',
        amount: 10,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: staleSource,
      }],
      durableContextSignals: [{
        localId: 'component-concern-1',
        kind: 'concern',
        basis: 'difficulty',
        value: '難しい',
        sourceText: staleSource,
      }],
      sourceText: currentUserText,
    }];
    document.tasks = [task];
    document.relations = [{
      localId: 'relation-1',
      kind: 'before',
      fromLocalId: 'local-task-math',
      toLocalId: 'other-task',
      sourceText: staleSource,
    }];
    document.availabilityDeclarations = [{
      localId: 'availability-1',
      kind: 'unavailable',
      dateExpression: '火曜',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      recurrenceKind: null,
      days: [],
      constraintLevel: 'hard',
      sourceText: staleSource,
    }];
    document.constraintSourceRequests = [{
      localId: 'source-1',
      kind: 'calendar',
      selector: 'active',
      requestedAction: 'use',
      sourceText: staleSource,
    }];
    document.uncertainties = [{
      localId: 'uncertainty-1',
      targetLocalId: 'document',
      field: 'task',
      reason: 'ambiguous',
      sourceText: staleSource,
    }];
    document.corrections = [{
      localId: 'correction-1',
      target: {
        kind: 'task',
        publicId: 'task-math',
        localId: null,
        mention: null,
      },
      operation: 'modify',
      replacementLocalId: null,
      sourceText: staleSource,
    }];
    document.decisions = [{
      localId: 'decision-1',
      target: {
        kind: 'proposal',
        publicId: 'proposal-1',
        localId: null,
        mention: null,
      },
      decision: 'accept',
      sourceText: staleSource,
    }];

    const errors = validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText,
      publicStateSummary: {
        tasks: [{ publicId: 'task-math', category: 'study', title: '数学' }],
        components: [{
          publicId: 'component-math',
          taskPublicId: 'task-math',
          role: 'material',
          label: '問題集',
        }],
      },
    });

    expect(errors).toEqual(expect.arrayContaining([
      'document.tasks[0].workloads[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].effortEstimates[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].temporalConstraints[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].recurrence[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].durableContextSignals[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].study.components[0].workloads[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].study.components[0].durableContextSignals[0].sourceText:not-grounded-in-current-user-text',
      'document.relations[0].sourceText:not-grounded-in-current-user-text',
      'document.availabilityDeclarations[0].sourceText:not-grounded-in-current-user-text',
      'document.constraintSourceRequests[0].sourceText:not-grounded-in-current-user-text',
      'document.uncertainties[0].sourceText:not-grounded-in-current-user-text',
      'document.corrections[0].sourceText:not-grounded-in-current-user-text',
      'document.decisions[0].sourceText:not-grounded-in-current-user-text',
    ]));
  });
});
