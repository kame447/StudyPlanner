import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { SEMANTIC_QUANTITY_ROLES_V5, SEMANTIC_WORKLOAD_UNIT_CODES_V5, WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学を30ページ' }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: '数学を30ページ' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
}
function canonicalGraph(input = document()) {
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(),
    document: input, context: { conversationId: 'conversation', turnId: 'turn', expectedRevision: 0 } });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}

function effortDocument() {
  const input = document();
  input.tasks[0].effortEstimates = [{ localId: 'effort', targetLocalId: 'task', kind: 'total_duration',
    minutes: 30, unitCode: null, precision: 'exact', sourceText: '所要時間は30分' }];
  return input;
}
const effortKinds = ['total_duration', 'duration_per_unit', 'session_duration'] as const;
const precisions = ['exact', 'approximate', 'unspecified'] as const;
const positiveFinite = fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true });
const nullableString = fc.option(fc.string({ maxLength: 20 }), { nil: null });
const workloadValues = fc.record({
  quantityRole: fc.constantFrom(...SEMANTIC_QUANTITY_ROLES_V5), amount: positiveFinite,
  unitCode: fc.constantFrom(...SEMANTIC_WORKLOAD_UNIT_CODES_V5),
  unitLabel: fc.string({ minLength: 1, maxLength: 20 }).filter(value => value.trim().length > 0),
  rangeStart: nullableString, rangeEnd: nullableString, periodExpression: nullableString, perOccurrence: fc.boolean(),
});
const effortValues = fc.record({ kind: fc.constantFrom(...effortKinds), minutes: positiveFinite,
  unitCode: fc.option(fc.constantFrom(...SEMANTIC_WORKLOAD_UNIT_CODES_V5), { nil: null }), precision: fc.constantFrom(...precisions),
}).map(value => value.kind === 'duration_per_unit' && value.unitCode === null ? { ...value, unitCode: 'page' as const } : value);
const workloadExample = { quantityRole: 'target' as const, amount: 0.5, unitCode: 'page' as const, unitLabel: 'ページ',
  rangeStart: '' as string | null, rangeEnd: 'section 2' as string | null, periodExpression: '' as string | null, perOccurrence: true };

const example = <T>(value: T): [T] => [value];

type Bucket = 'workloads' | 'effortEstimates';
function expectPreserved(bucket: Bucket, values: object) {
  const input = effortDocument(); Object.assign(input.tasks[0][bucket][0], values);
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
  const graph = canonicalGraph(input);
  // Check the original generated values too: round-trip equality alone could
  // hide a canonicalizer that rewrites a quantity or unit before serialization.
  expect(graph[bucket][0]).toMatchObject(values);
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
}
function expectRejected(bucket: Bucket, field: string, value: unknown) {
  const input = effortDocument(); const graph = canonicalGraph(input);
  Object.assign(input.tasks[0][bucket][0], { [field]: value }); Object.assign(graph[bucket][0], { [field]: value });
  // Validate before JSON can turn NaN/Infinity into null or drop undefined.
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toContain(`document.tasks[0].${bucket}[0].${field}`);
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain(`graph.${bucket}[0].${field}`);
  expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
  expect(() => serializeWeeklyPlanningFactGraphV5(graph)).toThrow('Invalid WeeklyPlanningFactGraphV5');
}

// Independent input classes, not samples filtered through the production validator.
// Each field gets its own property, so a missing field check cannot be masked by
// another corrupt field. Required examples preserve the former fixed regressions.
const scalar = fc.oneof(fc.constantFrom(undefined, null), fc.boolean(), fc.integer(), fc.string({ maxLength: 20 }),
  fc.array(fc.integer(), { maxLength: 3 }), fc.record({ bad: fc.string({ maxLength: 4 }) }));
const invalidNumber = fc.oneof(fc.double({ max: 0, noNaN: false }), scalar.filter(value => typeof value !== 'number'));
const invalidEnum = (values: readonly string[], nullable = false) => scalar.filter(value =>
  !(nullable && value === null) && (typeof value !== 'string' || !values.includes(value)));
const invalidNullableString = scalar.filter(value => value !== null && typeof value !== 'string');
const corruptions: Array<{ bucket: Bucket; field: string; arbitrary: fc.Arbitrary<unknown>; examples: unknown[] }> = [
  { bucket: 'workloads', field: 'amount', arbitrary: invalidNumber, examples: [-30, 'thirty', null, undefined] },
  { bucket: 'workloads', field: 'quantityRole', arbitrary: invalidEnum(SEMANTIC_QUANTITY_ROLES_V5), examples: ['already_saved', null, undefined] },
  { bucket: 'workloads', field: 'unitCode', arbitrary: invalidEnum(SEMANTIC_WORKLOAD_UNIT_CODES_V5), examples: ['not-a-unit', null, undefined] },
  { bucket: 'workloads', field: 'unitLabel', arbitrary: scalar.filter(value => typeof value !== 'string' || !value.trim()), examples: ['  ', 30, undefined] },
  ...(['rangeStart', 'rangeEnd', 'periodExpression'] as const).map(field => ({ bucket: 'workloads' as const, field,
    arbitrary: invalidNullableString, examples: field === 'rangeEnd' ? [false, undefined] : [1, undefined] })),
  { bucket: 'workloads', field: 'perOccurrence', arbitrary: scalar.filter(value => typeof value !== 'boolean'), examples: ['false', undefined] },
  { bucket: 'effortEstimates', field: 'minutes', arbitrary: invalidNumber, examples: [-30, 'thirty', null, undefined] },
  { bucket: 'effortEstimates', field: 'kind', arbitrary: invalidEnum(effortKinds), examples: ['elapsed', null, undefined] },
  { bucket: 'effortEstimates', field: 'precision', arbitrary: invalidEnum(precisions), examples: ['certain', null, undefined] },
  { bucket: 'effortEstimates', field: 'unitCode', arbitrary: invalidEnum(SEMANTIC_WORKLOAD_UNIT_CODES_V5, true), examples: ['not-a-unit', 1, undefined] },
];

describe('quantitative values across provider, canonicalization and saved graph', () => {
  it('preserves generated positive finite workload values, fractions and every supported role/unit', () => {
    fc.assert(fc.property(workloadValues, values => expectPreserved('workloads', values)), {
      seed: 20261004, numRuns: 50,
      examples: [
        ...SEMANTIC_QUANTITY_ROLES_V5.map(quantityRole => example({ ...workloadExample, quantityRole })),
        ...SEMANTIC_WORKLOAD_UNIT_CODES_V5.map(unitCode => example({ ...workloadExample, unitCode })),
        [{ ...workloadExample, amount: Number.MIN_VALUE, perOccurrence: false, rangeStart: null, rangeEnd: null, periodExpression: null }],
        [{ ...workloadExample, amount: Number.MAX_VALUE }],
      ],
    });
  });
  it('preserves generated finite effort values, fractions and every kind/precision', () => {
    fc.assert(fc.property(effortValues, values => expectPreserved('effortEstimates', values)), {
      seed: 20261005, numRuns: 50,
      examples: effortKinds.flatMap(kind => precisions.map(precision => example({ kind, precision, minutes: 0.5,
        unitCode: kind === 'duration_per_unit' ? 'page' as const : null }))),
    });
  });
  it.each(corruptions.map((rule, index) => ({ ...rule, seed: 20261100 + index })))('rejects generated corruption of $bucket / $field', ({ bucket, field, arbitrary, examples, seed }) => {
    fc.assert(fc.property(arbitrary, value => expectRejected(bucket, field, value)), {
      seed, numRuns: 15, examples: examples.map(value => [value]),
    });
  });
  it('rejects zero and nonfinite numeric values before JSON conversion at both boundaries', () => {
    for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectRejected('workloads', 'amount', value); expectRejected('effortEstimates', 'minutes', value);
    }
  });
  it('requires a unit for per-unit effort at both boundaries', () => {
    const input = effortDocument(); const graph = canonicalGraph(input);
    input.tasks[0].effortEstimates[0].kind = 'duration_per_unit'; graph.effortEstimates[0].kind = 'duration_per_unit';
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toContain('document.tasks[0].effortEstimates[0].unitCode:required');
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.effortEstimates[0].unitCode:required');
  });
  it('keeps graph reference checks distinct from provider local IDs', () => {
    const graph = canonicalGraph(); graph.workloads[0].taskId = 'missing-task';
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.workloads[0].taskId');
  });
});
