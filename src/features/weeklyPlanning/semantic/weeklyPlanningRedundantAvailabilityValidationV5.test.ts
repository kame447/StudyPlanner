import { describe, expect, it } from 'vitest';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';

describe('Stable V5 redundant availability validation', () => {
  it('accepts the real-Luna shape without an AI repair when the only invalid fact is a redundant hard-available window', () => {
    const rawResponse = JSON.stringify({
      availabilityDeclarations: [{
        constraintLevel: 'hard',
        dateExpression: '8月17日から23日',
        days: [],
        endTime: null,
        kind: 'available',
        localId: 'availability-1',
        namedTimePeriod: null,
        recurrenceKind: null,
        sourceText: '固定予定はありません',
        startTime: null,
      }],
      constraintSourceRequests: [],
      corrections: [],
      decisions: [],
      planningIntent: 'create_plan',
      planningWindow: {
        end: '2026-08-23',
        kind: 'absolute',
        localId: 'planning-window-1',
        sourceText: '8月17日から23日',
        start: '2026-08-17',
        value: '2026-08-17/2026-08-23',
      },
      relations: [],
      schemaVersion: 'weekly-planning-semantic-v5',
      tasks: [{
        category: 'study',
        decompositionStatus: 'atomic',
        durableContextSignals: [],
        effortEstimates: [],
        existingPublicId: null,
        localId: 'task-1',
        recurrence: [],
        sourceText: '英単語220語を覚える計画を立てたいです。',
        study: {
          activityKind: 'memorization_retrieval',
          components: [],
          contextLabel: null,
          purpose: 'self_study',
        },
        temporalConstraints: [],
        title: '英単語を覚える',
        workloads: [{
          amount: 220,
          localId: 'workload-1',
          perOccurrence: false,
          periodExpression: null,
          quantityRole: 'target',
          rangeEnd: null,
          rangeStart: null,
          sourceText: '英単語220語',
          unitCode: 'word',
          unitLabel: '語',
        }],
      }],
      uncertainties: [],
      userContextFacts: [],
    });

    const result = validateWeeklyPlanningSemanticResponseV5(rawResponse, {});
    expect(result.errors).toEqual([]);
    expect(result.document?.availabilityDeclarations).toEqual([]);
    expect(result.algorithmicRepairs).toContain(
      'redundant-hard-availability-removed:availability-1',
    );
    expect(result.document?.planningWindow).toMatchObject({
      start: '2026-08-17',
      end: '2026-08-23',
    });
    expect(result.document?.tasks[0]?.study?.activityKind).toBe('memorization_retrieval');
  });
});
