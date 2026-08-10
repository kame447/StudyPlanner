import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningStandaloneModifierTargetsV5 } from './weeklyPlanningStandaloneModifierTargetV5';

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 't1', existingPublicId: null, decompositionStatus: 'decomposed', category: 'study',
        title: 'first task', sourceText: 'first task', workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
        study: { purpose: 'homework', contextLabel: null, components: [
          { localId: 'c1', existingPublicId: null, parentLocalId: null, role: 'material', label: 'first task', sourceText: 'first task', workloads: [], durableContextSignals: [] },
        ] },
      },
      {
        localId: 't2', existingPublicId: null, decompositionStatus: 'decomposed', category: 'study',
        title: 'second task', sourceText: 'second task', workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
        study: { purpose: 'homework', contextLabel: null, components: [
          { localId: 'c2', existingPublicId: null, parentLocalId: null, role: 'material', label: 'second task', sourceText: 'second task', workloads: [], durableContextSignals: [] },
        ] },
      },
    ],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
}

function workload() {
  return {
    localId: 'w1', quantityRole: 'declared' as const, amount: 20, unitCode: 'page' as const,
    unitLabel: 'pages', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
    sourceText: 'about 20 pages',
  };
}

describe('validateWeeklyPlanningStandaloneModifierTargetsV5', () => {
  it('rejects a standalone workload attached to only one of multiple previously listed candidates', () => {
    const document = baseDocument();
    document.tasks[0].study!.components[0].workloads = [workload()];

    expect(validateWeeklyPlanningStandaloneModifierTargetsV5({
      document,
      userText: 'I want to do first task and second task. About 20 pages.',
    })).toEqual([
      'ambiguous-standalone-modifier-target:about 20 pages:candidate-count=2:attached-count=1',
    ]);
  });

  it('allows an explicitly targeted modifier in the following sentence', () => {
    const document = baseDocument();
    document.tasks[0].study!.components[0].workloads = [{ ...workload(), sourceText: 'first task about 20 pages' }];

    expect(validateWeeklyPlanningStandaloneModifierTargetsV5({
      document,
      userText: 'I want to do first task and second task. First task about 20 pages.',
    })).toEqual([]);
  });

  it('allows a standalone modifier when the semantic document keeps its target unresolved', () => {
    const document = baseDocument();
    document.uncertainties = [{
      localId: 'u1', targetLocalId: 't1', field: 'modifier_target',
      reason: 'target is unresolved across listed tasks', sourceText: 'about 20 pages',
    }];

    expect(validateWeeklyPlanningStandaloneModifierTargetsV5({
      document,
      userText: 'I want to do first task and second task. About 20 pages.',
    })).toEqual([]);
  });
});
