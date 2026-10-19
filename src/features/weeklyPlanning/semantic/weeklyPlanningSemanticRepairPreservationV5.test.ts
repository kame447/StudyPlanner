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
      {},
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
  it.each([false, true])('keeps the existing preservation guard when legacy userContextFacts is omitted: drop facts=%s', async (dropFacts) => {
    const initial = document({ canonicalWindow: true, clockAsCustomPeriod: true });
    delete initial.userContextFacts;
    const initialRaw = JSON.stringify(initial);
    const initialValidation = validateWeeklyPlanningSemanticResponseV5(initialRaw, { currentUserText: USER_TEXT });
    expect(initialValidation.parsedDocument).not.toBeNull();
    expect(initialValidation.errors).toEqual([
      'availabilityDeclarations[a1]: explicit clock text must use startTime/endTime with namedTimePeriod=null; do not encode clock times as a custom namedTimePeriod.',
    ]);
    const repaired = document({ canonicalWindow: true,
      ...(dropFacts ? { includeTask: false, includeAvailability: false, planningIntent: 'unknown' as const } : {}) });
    delete repaired.userContextFacts;
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(repaired), { currentUserText: USER_TEXT }).errors).toEqual([]);
    const responses = [initialRaw, JSON.stringify(repaired)];
    const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
      requests.push(structuredClone(request));
      const response = responses.shift(); if (!response) throw new Error('unexpected additional compatibility repair call');
      return response;
    } };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: USER_TEXT });
    expect(requests.map(request => request.responseFormat?.json_schema.name)).toEqual([
      'weekly_planning_semantic_document_v5', 'weekly_planning_semantic_document_v5',
    ]);
    expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    expect(initialRaw).toBe(JSON.stringify(initial));
    if (dropFacts) {
      expect(result.status).toBe('rejected'); expect(result.document).toBeNull();
      expect(result.diagnostics.validationErrors).toContain(
        'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts');
    } else {
      expect(result.status).toBe('accepted');
      expect(result.document?.tasks[0].study?.components[0].workloads[0].amount).toBe(220);
      expect(result.document?.availabilityDeclarations[0]).toMatchObject({ namedTimePeriod: null, startTime: '18:00', endTime: '20:00' });
    }
  });


  it.each(['availability', 'deadline', 'excluded_date'] as const)(
    'guards a %s canonical-date repair while allowing only its date expression to change',
    (kind) => {
      const initial = document({ canonicalWindow: true });
      let errors: string[];
      if (kind === 'availability') {
        initial.availabilityDeclarations[0].dateExpression = '火曜日';
        errors = ['document.availabilityDeclarations[0].dateExpression:canonical-expression'];
      } else {
        initial.tasks[0].temporalConstraints = [{
          localId: 'date', targetLocalId: 't1', kind, constraintLevel: 'hard',
          dateExpression: '火曜日', namedTimePeriod: null, startTime: null, endTime: null,
          precision: 'exact', sourceText: '火曜日',
        }];
        errors = ['document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression'];
        if (kind === 'excluded_date') errors.push('document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression-required');
      }
      const repaired = structuredClone(initial);
      if (kind === 'availability') repaired.availabilityDeclarations[0].dateExpression = 'weekday:tuesday';
      else repaired.tasks[0].temporalConstraints[0].dateExpression = 'weekday:tuesday';

      expect(isRepresentationOnlySemanticRepairV5(errors)).toBe(true);
      expect(validateWeeklyPlanningSemanticRepairPreservationV5({
        initialDocument: initial, repairedDocument: repaired, initialErrors: errors,
      })).toEqual([]);

      for (const unrelatedChange of ['drop_task', 'change_amount', 'drop_unavailability', 'change_clock'] as const) {
        const destructive = structuredClone(repaired);
        if (unrelatedChange === 'drop_task') destructive.tasks = [];
        if (unrelatedChange === 'change_amount') destructive.tasks[0].study!.components[0].workloads[0].amount = 20;
        if (unrelatedChange === 'drop_unavailability') destructive.availabilityDeclarations = [];
        if (unrelatedChange === 'change_clock') destructive.availabilityDeclarations[0].startTime = '20:00';
        expect(validateWeeklyPlanningSemanticRepairPreservationV5({
          initialDocument: initial, repairedDocument: destructive, initialErrors: errors,
        }), unrelatedChange).toEqual([
          'semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
        ]);
      }
      expect(initial.availabilityDeclarations[0].startTime).toBe('18:00');
    },
  );

  it('does not classify a missing deadline or a mixed invalid quantity as date representation repair', () => {
    expect(isRepresentationOnlySemanticRepairV5([
      'document.tasks[0].temporalConstraints[0]:missing-deadline',
    ])).toBe(false);
    expect(isRepresentationOnlySemanticRepairV5([
      'document.availabilityDeclarations[0].dateExpression:canonical-expression',
      'document.tasks[0].workloads[0].amount',
    ])).toBe(false);
  });
  it.each(['availability', 'deadline', 'excluded_date'] as const)(
    'applies canonical-date preservation in the real single-repair normalizer: %s', async kind => {
      for (const dropTask of [false, true]) {
        const initial = document({ canonicalWindow: true });
        if (kind === 'availability') initial.availabilityDeclarations[0].dateExpression = '火曜日';
        else initial.tasks[0].temporalConstraints = [{
          localId: 'date', targetLocalId: 't1', kind, constraintLevel: 'hard', dateExpression: '火曜日',
          namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '火曜日',
        }];
        const repaired = structuredClone(initial);
        if (kind === 'availability') repaired.availabilityDeclarations[0].dateExpression = 'weekday:tuesday';
        else repaired.tasks[0].temporalConstraints[0].dateExpression = 'weekday:tuesday';
        if (dropTask) repaired.tasks = [];
        const initialRaw = JSON.stringify(initial);
        const initialValidation = validateWeeklyPlanningSemanticResponseV5(initialRaw, { currentUserText: USER_TEXT });
        expect(initialValidation.errors.length).toBeGreaterThan(0);
        expect(initialValidation.errors.every(error => error.includes('canonical-expression'))).toBe(true);
        expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(repaired), { currentUserText: USER_TEXT }).errors).toEqual([]);
        const responses = [initialRaw, JSON.stringify(repaired)];
        const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
        const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
          requests.push(structuredClone(request));
          const response = responses.shift();
          if (!response) throw new Error('unexpected third date repair call');
          return response;
        } };
        const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: USER_TEXT });
        expect(requests).toHaveLength(2);
        expect(responses).toEqual([]);
        expect(result.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
        expect(JSON.stringify(initial)).toBe(initialRaw);
        if (dropTask) {
          expect(result.status).toBe('rejected');
          expect(result.document).toBeNull();
          expect(result.diagnostics.validationErrors).toContain(
            'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts');
        } else {
          expect(result.status).toBe('accepted');
          expect(result.document?.tasks[0].study?.components[0].workloads[0].amount).toBe(220);
          expect(result.document?.availabilityDeclarations[0]).toMatchObject({ kind: 'unavailable', startTime: '18:00', endTime: '20:00' });
        }
      }
    },
  );

  it('does not grant date repair authority to an unrelated declaration index', () => {
    const initial = document({ canonicalWindow: true });
    initial.availabilityDeclarations.push({ ...initial.availabilityDeclarations[0],
      localId: 'second', dateExpression: '2026-08-19' });
    initial.availabilityDeclarations[0].dateExpression = '火曜日';
    const repaired = structuredClone(initial);
    repaired.availabilityDeclarations[0].dateExpression = 'weekday:tuesday';
    repaired.availabilityDeclarations[1].dateExpression = '2026-08-20';
    expect(validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: initial, repairedDocument: repaired,
      initialErrors: ['document.availabilityDeclarations[0].dateExpression:canonical-expression'],
    })).toEqual(['semantic-repair-preservation:representation-only repair changed unrelated semantic facts']);
  });

});
