export const A = '来週、アルゴリズムイントロダクションを20ページ読みたい。1ページ3分くらいで、平日は20時以降がいい';
export const G = '10月16日までにアルゴリズムイントロダクションを12ページ読みたい。1ページ5分くらい。火曜20時から22時は入れないで';
export type Json = Record<string, unknown>;

export function declaration(overrides: Json): Json {
  return {
    localId: 'availability', kind: 'preferred', dateExpression: null, namedTimePeriod: null,
    startTime: '20:00', endTime: null, recurrenceKind: 'weekdays', days: [],
    constraintLevel: 'soft', capacityMinutes: null, sourceText: '平日は20時以降がいい',
    ...overrides,
  };
}

export function schedulingDocument(scenario: 'A' | 'G', extra: Json = {}): Json {
  const isA = scenario === 'A';
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: isA ? {
      localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週',
    } : null,
    tasks: [{
      localId: 'book', existingPublicId: null, decompositionStatus: 'atomic', category: 'study',
      title: 'アルゴリズムイントロダクション',
      study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
      workloads: [{
        localId: 'pages', quantityRole: 'target', amount: isA ? 20 : 12, unitCode: 'page', unitLabel: 'ページ',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        sourceText: isA ? '20ページ' : '12ページ',
      }],
      effortEstimates: [{
        localId: 'pace', targetLocalId: 'pages', kind: 'duration_per_unit', minutes: isA ? 3 : 5,
        unitCode: 'page', precision: 'approximate', sourceText: isA ? '1ページ3分くらい' : '1ページ5分くらい',
      }],
      temporalConstraints: isA ? [] : [{
        localId: 'deadline', targetLocalId: 'book', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: '2026-10-16', namedTimePeriod: null, startTime: null, endTime: null,
        precision: 'exact', sourceText: '10月16日までに',
      }],
      recurrence: [], durableContextSignals: [], sourceText: `アルゴリズムイントロダクションを${isA ? 20 : 12}ページ読みたい`,
    }],
    relations: [],
    availabilityDeclarations: [isA ? declaration({}) : declaration({
      kind: 'unavailable', dateExpression: 'weekday:tuesday', recurrenceKind: null,
      endTime: '22:00', constraintLevel: 'hard', sourceText: '火曜20時から22時は入れないで',
    })],
    constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
    conversationActs: [], ...extra,
  };
}
