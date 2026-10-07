import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';
import {
  isRepresentationOnlySemanticRepairV5,
  readWeeklyPlanningRepresentationRepairBaselineV5,
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
});

describe('a recurring weekday set restated during a date-representation repair (live A on 2f9ae953)', () => {
  const ERRORS = ['document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression'];
  const REJECTED = ['semantic-repair-preservation:representation-only repair changed unrelated semantic facts'];
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => `weekday:${day}`);
  type TemporalFact = WeeklyPlanningSemanticDocumentV5['tasks'][number]['temporalConstraints'][number];
  const evening = (overrides: Partial<TemporalFact> = {}): TemporalFact => ({
    localId: 'temporal-1', targetLocalId: 't1', kind: 'preferred_window', constraintLevel: 'soft',
    dateExpression: '平日', namedTimePeriod: null, startTime: '20:00', endTime: null,
    precision: 'exact', sourceText: '平日は20時以降がいい', ...overrides,
  });
  function initial(fact: TemporalFact = evening()): WeeklyPlanningSemanticDocumentV5 {
    const value = document({ canonicalWindow: true });
    value.tasks[0].temporalConstraints = [fact];
    return value;
  }
  // One copy per weekday with fresh IDs, deliberately not in the original position/order.
  function split(fact: TemporalFact = evening()): WeeklyPlanningSemanticDocumentV5 {
    const value = initial(fact);
    value.tasks[0].temporalConstraints = WEEKDAYS
      .map((dateExpression, index) => ({ ...fact, localId: `weekday-${index}`, dateExpression }))
      .reverse();
    return value;
  }
  const guard = (
    repairedDocument: WeeklyPlanningSemanticDocumentV5,
    initialDocument = initial(),
    conversationArchitecture?: 'interaction_v1' | 'legacy_v5',
  ) => validateWeeklyPlanningSemanticRepairPreservationV5({
    initialDocument, repairedDocument, initialErrors: ERRORS, conversationArchitecture,
  });

  it('accepts one copy per weekday that keeps every other field, in any order', () => {
    expect(guard(split())).toEqual([]);
    expect(guard(split(), initial(), 'interaction_v1')).toEqual([]);
  });

  it('still rejects the live repair that invented a task recurrence for the weekday scope', () => {
    const live = initial(evening({ dateExpression: 'custom:平日' }));
    live.tasks[0].recurrence = [{
      localId: 'recurrence-1', targetLocalId: 't1', kind: 'weekdays', count: null, days: WEEKDAYS, sourceText: '平日',
    }];
    expect(guard(live)).toEqual(REJECTED);
    // A single restatement remains allowed, as before.
    expect(guard(initial(evening({ dateExpression: 'custom:平日' })))).toEqual([]);
  });

  it.each([
    ['changes a copy clock', (value: WeeklyPlanningSemanticDocumentV5) => { value.tasks[0].temporalConstraints[2].startTime = '21:00'; }],
    ['narrows a copy sourceText', (value: WeeklyPlanningSemanticDocumentV5) => { value.tasks[0].temporalConstraints[0].sourceText = '平日'; }],
    ['repeats a weekday', (value: WeeklyPlanningSemanticDocumentV5) => {
      value.tasks[0].temporalConstraints[1].dateExpression = value.tasks[0].temporalConstraints[0].dateExpression;
    }],
    ['drops an unrelated fact', (value: WeeklyPlanningSemanticDocumentV5) => { value.availabilityDeclarations = []; }],
    ['drops the weekday fact', (value: WeeklyPlanningSemanticDocumentV5) => { value.tasks[0].temporalConstraints = []; }],
    ['adds a task recurrence', (value: WeeklyPlanningSemanticDocumentV5) => {
      value.tasks[0].recurrence = [{ localId: 'r', targetLocalId: 't1', kind: 'weekdays', count: null, days: WEEKDAYS, sourceText: '平日' }];
    }],
  ] as const)('rejects a split that %s', (_label, mutate) => {
    const repaired = split();
    mutate(repaired);
    expect(guard(repaired)).toEqual(REJECTED);
  });

  it('splits only preferred windows; date rules, bounds and deadlines keep one fact', () => {
    // A date rule's weekday token is its next dated occurrence from the request date, so a
    // per-weekday split of 「平日は入れないで」 would leave next week's Wednesday open.
    for (const kind of ['allowed_date', 'excluded_date', 'deadline', 'latest_end', 'earliest_start', 'avoid_window'] as const) {
      const fact = evening({ kind, constraintLevel: kind === 'avoid_window' ? 'soft' : 'hard', startTime: null });
      expect(guard(split(fact), initial(fact)), kind).toEqual(REJECTED);
      const single = initial({ ...fact, dateExpression: 'weekday:friday' });
      expect(guard(single, initial(fact)), `${kind} single`).toEqual([]);
    }
  });

  it('lets an availability declaration move a weekday set into its own recurrence fields only', () => {
    const errors = ['document.availabilityDeclarations[0].dateExpression:canonical-expression'];
    const before = document({ canonicalWindow: true });
    Object.assign(before.availabilityDeclarations[0], {
      kind: 'preferred', dateExpression: '平日', recurrenceKind: null, days: [],
      startTime: '20:00', endTime: null, constraintLevel: 'soft', sourceText: '平日は20時以降がいい',
    });
    const after = structuredClone(before);
    Object.assign(after.availabilityDeclarations[0], { dateExpression: null, recurrenceKind: 'weekdays', days: WEEKDAYS });
    const check = (repairedDocument: WeeklyPlanningSemanticDocumentV5) => validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: before, repairedDocument, initialErrors: errors,
    });
    expect(check(after)).toEqual([]);
    const moved = structuredClone(after);
    moved.availabilityDeclarations[0].startTime = '21:00';
    expect(check(moved)).toEqual(REJECTED);
  });

  it('keeps the historical comparison unguarded for date canonicalization, exactly as before #488', () => {
    const live = initial(evening({ dateExpression: 'custom:平日' }));
    live.tasks[0].recurrence = [{
      localId: 'recurrence-1', targetLocalId: 't1', kind: 'weekdays', count: null, days: WEEKDAYS, sourceText: '平日',
    }];
    expect(isRepresentationOnlySemanticRepairV5(ERRORS, 'legacy_v5')).toBe(false);
    expect(isRepresentationOnlySemanticRepairV5(ERRORS, 'interaction_v1')).toBe(true);
    expect(guard(live, initial(), 'legacy_v5')).toEqual([]);
    expect(readWeeklyPlanningRepresentationRepairBaselineV5({
      rawResponse: JSON.stringify(initial()), validationErrors: ERRORS, conversationArchitecture: 'legacy_v5',
    })).toBeNull();
    expect(readWeeklyPlanningRepresentationRepairBaselineV5({
      rawResponse: JSON.stringify(initial()), validationErrors: ERRORS, conversationArchitecture: 'interaction_v1',
    })).not.toBeNull();
    // Representation repairs that were guarded before #488 stay guarded in both architectures.
    expect(isRepresentationOnlySemanticRepairV5(['document.planningWindow:absolute-range'], 'legacy_v5')).toBe(true);
  });
});

describe('restatement guard edges (adversarial review of 8aae7738)', () => {
  const REJECTED = ['semantic-repair-preservation:representation-only repair changed unrelated semantic facts'];
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => `weekday:${day}`);
  type TemporalFact = WeeklyPlanningSemanticDocumentV5['tasks'][number]['temporalConstraints'][number];
  const evening = (overrides: Partial<TemporalFact> = {}): TemporalFact => ({
    localId: 'temporal-1', targetLocalId: 't1', kind: 'preferred_window', constraintLevel: 'soft',
    dateExpression: '平日', namedTimePeriod: null, startTime: '20:00', endTime: null,
    precision: 'exact', sourceText: '平日は20時以降がいい', ...overrides,
  });
  const withFacts = (facts: TemporalFact[]) => {
    const value = document({ canonicalWindow: true });
    value.tasks[0].temporalConstraints = facts;
    return value;
  };
  const dateError = (index: number) => `document.tasks[0].temporalConstraints[${index}].dateExpression:canonical-expression`;
  const check = (before: WeeklyPlanningSemanticDocumentV5, after: WeeklyPlanningSemanticDocumentV5, initialErrors: string[]) =>
    validateWeeklyPlanningSemanticRepairPreservationV5({ initialDocument: before, repairedDocument: after, initialErrors });
  const split = (fact: TemporalFact, days = WEEKDAYS, prefix = 'split') =>
    days.map((dateExpression, index) => ({ ...fact, localId: `${prefix}-${index}`, dateExpression }));

  it('keeps an availability declaration typed recurrence and days; only an empty scope may move', () => {
    const errors = ['document.availabilityDeclarations[0].dateExpression:canonical-expression'];
    const before = document({ canonicalWindow: true });
    Object.assign(before.availabilityDeclarations[0], { dateExpression: '火曜日', recurrenceKind: 'weekly', days: ['weekday:tuesday'] });
    const dateOnly = structuredClone(before);
    dateOnly.availabilityDeclarations[0].dateExpression = null;
    expect(check(before, dateOnly, errors)).toEqual([]);
    // Moving a typed busy Tuesday to Friday, or widening it to every day, would open a blocked slot.
    for (const scope of [{ days: ['weekday:friday'] }, { recurrenceKind: 'daily' as const, days: [] }]) {
      const moved = structuredClone(dateOnly);
      Object.assign(moved.availabilityDeclarations[0], scope);
      expect(check(before, moved, errors), JSON.stringify(scope)).toEqual(REJECTED);
    }
  });

  it('accepts a split that also fixes a flagged clock, and only when the clock was flagged', () => {
    const before = withFacts([evening({ namedTimePeriod: 'custom:20時以降', startTime: null })]);
    const after = withFacts(split(evening()));
    expect(check(before, after, [dateError(0), 'temporalConstraints[temporal-1]: explicit clock text must use startTime/endTime'])).toEqual([]);
    // A clock change the validator did not address stays an unrelated change.
    expect(check(before, after, [dateError(0)])).toEqual(REJECTED);
  });

  it('compares flagged facts that differ only by date as one group', () => {
    const before = withFacts([evening({ localId: 'one' }), evening({ localId: 'two', dateExpression: '週末' })]);
    const errors = [dateError(0), dateError(1)];
    const both = withFacts([...split(evening(), WEEKDAYS, 'weekdays'), ...split(evening(), ['weekday:saturday', 'weekday:sunday'], 'weekend')]);
    expect(check(before, both, errors)).toEqual([]);
    const oneToOne = withFacts([evening({ localId: 'one', dateExpression: 'weekday:monday' }), evening({ localId: 'two', dateExpression: 'weekday:saturday' })]);
    expect(check(before, oneToOne, errors)).toEqual([]);
    const merged = withFacts([evening({ localId: 'one', dateExpression: 'weekday:monday' })]);
    expect(check(before, merged, errors)).toEqual(REJECTED);
    const duplicated = withFacts([...both.tasks[0].temporalConstraints, { ...both.tasks[0].temporalConstraints[0], localId: 'duplicate' }]);
    expect(check(before, duplicated, errors)).toEqual(REJECTED);
  });

  it('keeps unflagged facts exact, even when a split repeats one of their dates', () => {
    const monday = evening({ localId: 'existing', dateExpression: 'weekday:monday' });
    const before = withFacts([evening(), monday]);
    expect(check(before, withFacts([...split(evening()), monday]), [dateError(0)])).toEqual([]);
    expect(check(before, withFacts(split(evening())), [dateError(0)])).toEqual(REJECTED);
    const saturday = evening({ localId: 'sat', dateExpression: 'weekday:saturday', startTime: '09:00' });
    const changed = { ...saturday, startTime: '10:00' };
    expect(check(withFacts([evening(), saturday]), withFacts([...split(evening()), changed]), [dateError(0)])).toEqual(REJECTED);
  });
});
