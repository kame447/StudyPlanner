import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';
import {
  isRepresentationOnlySemanticRepairV5,
  validateWeeklyPlanningSemanticRepairPreservationV5,
} from './weeklyPlanningSemanticRepairPreservationV5';

const USER_TEXT = '8月17日から23日で、英単語220語を進める予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。';

function document(params: {
  canonicalWindow: boolean;
  clockAsCustomPeriod?: boolean;
  includeTask?: boolean;
  includeAvailability?: boolean;
  planningIntent?: 'create_plan' | 'update_plan' | 'discuss' | 'unknown';
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: params.planningIntent ?? 'create_plan',
    planningWindow: params.canonicalWindow
      ? {
          localId: 'pw1',
          kind: 'absolute',
          value: '2026-08-17/2026-08-23',
          start: '2026-08-17',
          end: '2026-08-23',
          sourceText: '8月17日から23日',
        }
      : {
          localId: 'pw1',
          kind: 'absolute',
          value: '8月17日から23日',
          start: null,
          end: null,
          sourceText: '8月17日から23日',
        },
    tasks: params.includeTask === false
      ? []
      : [{
          localId: 't1',
          existingPublicId: null,
          decompositionStatus: 'decomposed',
          category: 'study',
          title: '英単語を進める',
          study: {
            purpose: 'self_study',
            contextLabel: '英単語',
            components: [{
              localId: 'c1',
              existingPublicId: null,
              parentLocalId: null,
              role: 'material',
              label: '英単語',
              workloads: [{
                localId: 'w1',
                quantityRole: 'target',
                amount: 220,
                unitCode: 'word',
                unitLabel: '語',
                rangeStart: null,
                rangeEnd: null,
                perOccurrence: false,
                periodExpression: null,
                sourceText: '英単語220語',
              }],
              durableContextSignals: [],
              sourceText: '英単語220語',
            }],
          },
          workloads: [],
          effortEstimates: [],
          temporalConstraints: [],
          recurrence: [],
          durableContextSignals: [],
          sourceText: '英単語220語',
        }],
    relations: [],
    availabilityDeclarations: params.includeAvailability === false
      ? []
      : [{
          localId: 'a1',
          kind: 'unavailable',
          dateExpression: 'weekday:tuesday',
          namedTimePeriod: params.clockAsCustomPeriod ? 'custom:18時から20時' : null,
          startTime: params.clockAsCustomPeriod ? null : '18:00',
          endTime: params.clockAsCustomPeriod ? null : '20:00',
          recurrenceKind: 'weekly',
          days: ['weekday:tuesday'],
          constraintLevel: 'hard',
          sourceText: '火曜日の18時から20時は予定があるので避けてください',
        }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 targeted semantic repair preservation', () => {
  it('recognizes only representation-local validator failures as preservation-guarded repairs', () => {
    expect(isRepresentationOnlySemanticRepairV5([
      'document.planningWindow:absolute-range',
      'availabilityDeclarations[a1].days:canonical-weekday-required:tuesday',
    ])).toBe(true);
    expect(isRepresentationOnlySemanticRepairV5([
      'document.tasks[t1]:some-semantic-error',
    ])).toBe(false);
  });

  it('allows the targeted planning-window representation to change while preserving all other facts', () => {
    expect(validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: document({ canonicalWindow: false }),
      repairedDocument: document({ canonicalWindow: true }),
      initialErrors: ['document.planningWindow:absolute-range'],
    })).toEqual([]);
  });

  it('rejects a repair that fixes the window but silently drops unrelated current-turn facts', () => {
    expect(validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: document({ canonicalWindow: false }),
      repairedDocument: document({
        canonicalWindow: true,
        includeTask: false,
        includeAvailability: false,
        planningIntent: 'unknown',
      }),
      initialErrors: ['document.planningWindow:absolute-range'],
    })).toEqual([
      'semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
    ]);
  });

  it('keeps the exact real-API fixture available as a comparison baseline before repair', () => {
    const initial = document({ canonicalWindow: false });
    const validation = validateWeeklyPlanningSemanticResponseV5(
      JSON.stringify(initial),
      { userText: USER_TEXT },
    );

    if (!validation.parsedDocument) {
      throw new Error(`fixture parse errors: ${JSON.stringify(validation.errors)}`);
    }
    expect(validation.document).toBeNull();
    expect(validation.errors).toEqual([
      'document.planningWindow:absolute-range',
    ]);
    expect(isRepresentationOnlySemanticRepairV5(validation.errors)).toBe(true);
  });

  it('rejects destructive full-document repair when meaning must still be recovered', async () => {
    const responses = [
      JSON.stringify(document({
        canonicalWindow: true,
        clockAsCustomPeriod: true,
      })),
      JSON.stringify(document({
        canonicalWindow: true,
        includeTask: false,
        includeAvailability: false,
        planningIntent: 'unknown',
      })),
    ];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: USER_TEXT,
    });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.validationErrors).toContain(
      'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
    );
  });
});
