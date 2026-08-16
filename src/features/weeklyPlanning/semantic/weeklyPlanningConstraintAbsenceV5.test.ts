import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type {
  SemanticAvailabilityDeclarationV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticValueV5,
} from './weeklyPlanningSemanticValidatorV5';

function availability(
  partial: Partial<SemanticAvailabilityDeclarationV5>,
): SemanticAvailabilityDeclarationV5 {
  return {
    localId: 'availability-1',
    kind: 'available',
    dateExpression: null,
    namedTimePeriod: null,
    startTime: null,
    endTime: null,
    recurrenceKind: null,
    days: [],
    constraintLevel: 'hard',
    sourceText: 'source evidence',
    ...partial,
  };
}

function documentWith(
  declaration: SemanticAvailabilityDeclarationV5,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [declaration],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function canonicalize(document: WeeklyPlanningSemanticDocumentV5) {
  return canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    document,
    context: {
      conversationId: 'conversation-absence',
      turnId: `turn-${document.availabilityDeclarations[0]?.localId ?? 'none'}`,
      expectedRevision: 0,
    },
  });
}

describe('constraint absence semantic boundary', () => {
  it('accepts an absence fact without manufacturing a positive availability window', () => {
    const document = documentWith(availability({
      kind: 'no_additional_constraint',
    }));

    const validation = validateWeeklyPlanningSemanticValueV5(document);
    expect(validation.errors).toEqual([]);
    expect(validation.document?.availabilityDeclarations[0]?.kind)
      .toBe('no_additional_constraint');

    const result = canonicalize(document);
    expect(result.status).toBe('applied');
    expect(result.graph.availabilityDeclarations).toEqual([
      expect.objectContaining({ kind: 'no_additional_constraint' }),
    ]);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph).availabilityDeclarations)
      .toEqual([]);
  });

  it('rejects attaching a positive clock window to an absence fact', () => {
    const validation = validateWeeklyPlanningSemanticValueV5(documentWith(availability({
      kind: 'no_additional_constraint',
      startTime: '18:00',
      endTime: '20:00',
    })));

    expect(validation.document).toBeNull();
    expect(validation.errors).toContain(
      'document.availabilityDeclarations[0]:absence-has-no-positive-clock-window',
    );
  });

  it('preserves positive availability in the Fact Graph while dropping a scheduler no-op', () => {
    const result = canonicalize(documentWith(availability({
      dateExpression: 'weekday:monday',
    })));

    expect(result.status).toBe('applied');
    expect(result.graph.availabilityDeclarations).toEqual([
      expect.objectContaining({ kind: 'available', dateExpression: 'weekday:monday' }),
    ]);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph).availabilityDeclarations)
      .toEqual([]);
  });

  it('keeps a concrete positive availability window in scheduler input', () => {
    const result = canonicalize(documentWith(availability({
      dateExpression: 'weekday:monday',
      startTime: '18:00',
      endTime: '20:00',
    })));

    expect(result.status).toBe('applied');
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph).availabilityDeclarations)
      .toEqual([
        expect.objectContaining({
          kind: 'available',
          startTime: '18:00',
          endTime: '20:00',
        }),
      ]);
  });
});
