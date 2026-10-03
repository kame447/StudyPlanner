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
const invalid: Array<[string, unknown]> = [
  ...[-30, 0, 'thirty', null, undefined, Number.NaN, Number.POSITIVE_INFINITY].map((value): [string, unknown] => ['amount', value]),
  ['quantityRole', 'already_saved'], ['quantityRole', null], ['quantityRole', undefined],
  ['unitCode', 'not-a-unit'], ['unitCode', null], ['unitCode', undefined],
  ['unitLabel', '  '], ['unitLabel', 30], ['unitLabel', undefined],
  ['rangeStart', 1], ['rangeStart', undefined], ['rangeEnd', false], ['rangeEnd', undefined],
  ['perOccurrence', 'false'], ['perOccurrence', undefined], ['periodExpression', 1], ['periodExpression', undefined],
];
describe('shared workload value contract at provider and Fact Graph boundaries', () => {
  it.each(invalid)('rejects invalid %s = %s before restoring or serializing graph values', (field, value) => {
    const semantic = document(); const graph = canonicalGraph();
    Object.assign(semantic.tasks[0].workloads[0], { [field]: value });
    Object.assign(graph.workloads[0], { [field]: value });
    expect(validateWeeklyPlanningSemanticValueV5(semantic).errors).toContain(`document.tasks[0].workloads[0].${field}`);
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain(`graph.workloads[0].${field}`);
    expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
    expect(() => serializeWeeklyPlanningFactGraphV5(graph)).toThrow('Invalid WeeklyPlanningFactGraphV5');
  });
  it.each(SEMANTIC_QUANTITY_ROLES_V5)('preserves valid fractional %s quantities and nullable/string fields', (quantityRole) => {
    const input = document(); Object.assign(input.tasks[0].workloads[0], { quantityRole, amount: 0.5,
      rangeStart: '', rangeEnd: 'section 2', perOccurrence: true, periodExpression: '' });
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
    const graph = canonicalGraph(input);
    expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
  });
  it.each(SEMANTIC_WORKLOAD_UNIT_CODES_V5)('preserves the existing %s unit vocabulary', (unitCode) => {
    const input = document(); input.tasks[0].workloads[0].unitCode = unitCode;
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
    const graph = canonicalGraph(input); expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  });
  it('keeps graph reference checks distinct from provider local IDs', () => {
    const graph = canonicalGraph(); graph.workloads[0].taskId = 'missing-task';
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.workloads[0].taskId');
  });
});


function effortDocument() {
  const input = document();
  input.tasks[0].effortEstimates = [{ localId: 'effort', targetLocalId: 'task', kind: 'total_duration',
    minutes: 30, unitCode: null, precision: 'exact', sourceText: '所要時間は30分' }];
  return input;
}
describe('effort value contract at provider and Fact Graph boundaries', () => {
  const invalidEfforts: Array<[string, unknown]> = [
    ...[-30, 0, 'thirty', null, undefined, Number.NaN, Number.POSITIVE_INFINITY].map((value): [string, unknown] => ['minutes', value]),
    ['kind', 'elapsed'], ['kind', null], ['kind', undefined],
    ['precision', 'certain'], ['precision', null], ['precision', undefined],
    ['unitCode', 'not-a-unit'], ['unitCode', 1], ['unitCode', undefined],
  ];
  it.each(invalidEfforts)('rejects invalid effort %s = %s', (field, value) => {
    const semantic = effortDocument(); const graph = canonicalGraph(semantic);
    Object.assign(semantic.tasks[0].effortEstimates[0], { [field]: value });
    Object.assign(graph.effortEstimates[0], { [field]: value });
    expect(validateWeeklyPlanningSemanticValueV5(semantic).errors).toContain(`document.tasks[0].effortEstimates[0].${field}`);
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain(`graph.effortEstimates[0].${field}`);
    expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
    expect(() => serializeWeeklyPlanningFactGraphV5(graph)).toThrow('Invalid WeeklyPlanningFactGraphV5');
  });
  it('requires a unit for per-unit effort on both boundaries', () => {
    const semantic = effortDocument(); const graph = canonicalGraph(semantic);
    semantic.tasks[0].effortEstimates[0].kind = 'duration_per_unit'; graph.effortEstimates[0].kind = 'duration_per_unit';
    expect(validateWeeklyPlanningSemanticValueV5(semantic).errors).toContain('document.tasks[0].effortEstimates[0].unitCode:required');
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.effortEstimates[0].unitCode:required');
  });
  it.each(['total_duration', 'duration_per_unit', 'session_duration'] as const)('preserves fractional %s effort and all precision levels', (kind) => {
    for (const precision of ['exact', 'approximate', 'unspecified'] as const) {
      const semantic = effortDocument(); Object.assign(semantic.tasks[0].effortEstimates[0], {
        kind, minutes: 0.5, precision, unitCode: kind === 'duration_per_unit' ? 'page' : null,
      });
      expect(validateWeeklyPlanningSemanticValueV5(semantic).errors).toEqual([]);
      const graph = canonicalGraph(semantic);
      expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
    }
  });
});
