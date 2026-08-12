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

function document(params: {
  canonicalWindow: boolean;
  includeTask?: boolean;
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
    tasks: params.includeTask
      ? [{
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
                amount: 80,
                unitCode: 'word',
                unitLabel: '語',
                rangeStart: null,
                rangeEnd: null,
                perOccurrence: false,
                periodExpression: null,
                sourceText: '英単語80語',
              }],
              durableContextSignals: [],
              sourceText: '英単語80語',
            }],
          },
          workloads: [],
          effortEstimates: [],
          temporalConstraints: [],
          recurrence: [],
          durableContextSignals: [],
          sourceText: '英単語80語',
        }]
      : [],
    relations: [],
    availabilityDeclarations: [],
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
      'document.planningWindow:absolute-iso-range-required',
      'availabilityDeclarations[a1].days:canonical-weekday-required:tuesday',
    ])).toBe(true);
    expect(isRepresentationOnlySemanticRepairV5([
      'document.tasks[t1]:some-semantic-error',
    ])).toBe(false);
  });

  it('allows the targeted planning-window representation to change while preserving all other facts', () => {
    expect(validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: document({ canonicalWindow: false, includeTask: true }),
      repairedDocument: document({ canonicalWindow: true, includeTask: true }),
      initialErrors: ['document.planningWindow:absolute-iso-range-required'],
    })).toEqual([]);
  });

  it('rejects a repair that fixes the window but silently drops an unrelated accepted task', () => {
    expect(validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: document({ canonicalWindow: false, includeTask: true }),
      repairedDocument: document({ canonicalWindow: true, includeTask: false }),
      initialErrors: ['document.planningWindow:absolute-iso-range-required'],
    })).toEqual([
      'semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
    ]);
  });

  it('keeps the normalizer fixture representation-only before testing destructive repair rejection', () => {
    const initial = document({ canonicalWindow: false, includeTask: true });
    const validation = validateWeeklyPlanningSemanticResponseV5(
      JSON.stringify(initial),
      { userText: '8月17日から23日で英単語80語の予定を作りたい' },
    );

    expect(validation.parsedDocument).not.toBeNull();
    expect(validation.document).toBeNull();
    expect(validation.errors).toEqual([
      'document.planningWindow:absolute-iso-range-required',
    ]);
    expect(isRepresentationOnlySemanticRepairV5(validation.errors)).toBe(true);
  });

  it('rejects a schema-valid destructive AI repair at the normalizer boundary', async () => {
    const responses = [
      JSON.stringify(document({ canonicalWindow: false, includeTask: true })),
      JSON.stringify(document({
        canonicalWindow: true,
        includeTask: false,
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
      userText: '8月17日から23日で英単語80語の予定を作りたい',
    });

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.validationErrors).toContain(
      'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
    );
  });
});
