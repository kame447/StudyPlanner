import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  createWeeklyPlanningStableV5CurrentTurnGrounding,
} from './weeklyPlanningStableV5CurrentTurnGrounding';

function graph(): WeeklyPlanningFactGraphV5 {
  return {
    version: 'weekly-planning-fact-graph-v5',
    revision: 3,
    appliedTurnKeys: [],
    appliedLifecycleOperationKeys: [],
    factLifecycles: [{
      factId: 'availability-1',
      status: 'active',
      createdRevision: 3,
      terminalRevision: null,
      supersededByFactId: null,
    }],
    planningWindows: [],
    tasks: [],
    studyContexts: [],
    components: [],
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    taskDateRules: [],
    recurrences: [],
    relations: [],
    uncertainties: [],
    correctionIntents: [],
    decisionIntents: [],
    availabilityDeclarations: [{
      id: 'availability-1',
      kind: 'unavailable',
      dateExpression: 'tomorrow',
      namedTimePeriod: null,
      startTime: '14:30',
      endTime: '20:00',
      recurrenceKind: null,
      days: [],
      constraintLevel: 'hard',
      resolutionStatus: 'unresolved',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-current',
        semanticLocalId: 'availability-local',
        sourceText: '14時半から20時まではバイトです',
        origin: 'user',
      },
      createdRevision: 3,
    }],
    constraintSourceRequests: [],
  };
}

describe('Stable V5 current-turn dialogue grounding', () => {
  it('requires observable grounding when a side contribution is accepted and the same question remains pending', () => {
    expect(createWeeklyPlanningStableV5CurrentTurnGrounding({
      graph: graph(),
      turnId: 'turn-current',
      actionKind: 'question',
      previousQuestionCode: 'missing_schedulable_work',
      currentQuestionCode: 'missing_schedulable_work',
    })).toEqual({
      mode: 'required_before_resume',
      acceptedFacts: [{
        factId: 'availability-1',
        kind: 'availability_declaration',
        sourceText: '14時半から20時まではバイトです',
        data: expect.objectContaining({
          kind: 'unavailable',
          dateExpression: 'tomorrow',
          startTime: '14:30',
          endTime: '20:00',
          constraintLevel: 'hard',
        }),
      }],
    });
  });

  it('does not confuse scheduler resolutionStatus with whether the user fact was accepted', () => {
    const result = createWeeklyPlanningStableV5CurrentTurnGrounding({
      graph: graph(),
      turnId: 'turn-current',
      actionKind: 'question',
      previousQuestionCode: 'missing_schedulable_work',
      currentQuestionCode: 'missing_schedulable_work',
    });
    expect(result.acceptedFacts).toHaveLength(1);
    expect(result.acceptedFacts[0].data).not.toHaveProperty('resolutionStatus');
  });

  it('does not manufacture grounding when the current turn added no active facts', () => {
    expect(createWeeklyPlanningStableV5CurrentTurnGrounding({
      graph: graph(),
      turnId: 'other-turn',
      actionKind: 'question',
      previousQuestionCode: 'missing_schedulable_work',
      currentQuestionCode: 'missing_schedulable_work',
    })).toEqual({ mode: 'none', acceptedFacts: [] });
  });
});
