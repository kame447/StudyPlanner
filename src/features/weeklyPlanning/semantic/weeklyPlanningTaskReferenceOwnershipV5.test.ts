import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGraphCheckpointAssertions } from '../testUtils/__tests__/weeklyPlanningGraphCheckpointAssertions';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5 } from './weeklyPlanningExistingEntityBindingV5';
import { validateWeeklyPlanningCorrectionTargetReferencesV5 } from './weeklyPlanningCorrectionReferenceValidationV5';

const scope = { ownerId: 'reference-owner', weekStartDate: '2026-08-24', conversationId: 'reference-conversation' };
type Target = 'task' | 'component' | 'workload';
function task(id: string, label: string, amount: number, minutes: number, target: Target = 'workload', taskLevel = false): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  const sourceText = `${label}の教材${amount}ページを${minutes}分`;
  const workload = { localId: `${id}-workload`, quantityRole: 'target' as const, amount, unitCode: 'page' as const,
    unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText };
  return { localId: id, category: 'study', title: label,
    study: { purpose: 'self_study', contextLabel: null, components: [{ localId: `${id}-component`, parentLocalId: null,
      role: 'material', label: `${label}教材`, workloads: taskLevel ? [] : [workload], sourceText }] },
    workloads: taskLevel ? [workload] : [], effortEstimates: [{ localId: `${id}-effort`,
      targetLocalId: target === 'task' ? id : `${id}-${target}`, kind: 'total_duration', minutes, unitCode: null, precision: 'exact', sourceText }],
    temporalConstraints: [], recurrence: [], sourceText };
}
function document(target: Target = 'workload', taskLevel = false, minutes = 60): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: [task('math', '数学', 10, minutes, target, taskLevel), task('english', '英語', 20, 120)],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] };
}
function scopedDocument(target: 'task' | 'component', input = document()) {
  for (const task of input.tasks) {
    const targetLocalId = target === 'task' ? task.localId : task.study!.components[0].localId;
    task.temporalConstraints = [{ localId: `${task.localId}-temporal`, targetLocalId, kind: 'deadline',
      constraintLevel: 'hard', dateExpression: '2026-08-26', namedTimePeriod: null, startTime: null,
      endTime: null, precision: 'exact', sourceText: '8月26日まで' }];
    task.recurrence = [{ localId: `${task.localId}-recurrence`, targetLocalId, kind: 'daily', count: null,
      days: [], sourceText: '毎日' }];
  }
  return input;
}
function canonical(input: WeeklyPlanningSemanticDocumentV5, graph = createEmptyWeeklyPlanningFactGraphV5(), turnId = 'reference-turn') {
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph, document: input,
    context: { conversationId: scope.conversationId, turnId, expectedRevision: graph.revision } });
  expect(result.status).toBe('applied');
  return result;
}
function markFixtureHistory(graph: WeeklyPlanningFactGraphV5, bucket: 'temporalConstraints' | 'recurrences', status: 'active' | 'removed' | 'superseded') {
  if (status === 'active') return;
  graph.revision += 1;
  Object.assign(graph.factLifecycles.find(entry => entry.factId === graph[bucket][0].id)!, {
    status, terminalRevision: graph.revision, supersededByFactId: status === 'superseded' ? graph[bucket][1].id : null,
  });
}
function commitCorrection(baseline: WeeklyPlanningFactGraphV5, input: WeeklyPlanningSemanticDocumentV5, turnId: string) {
  const publicStateSummary = createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, baseline);
  expect(validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5({ document: input, publicStateSummary })).toEqual([]);
  expect(validateWeeklyPlanningCorrectionTargetReferencesV5(input, publicStateSummary)).toEqual([]);
  const finalized = finalizeWeeklyPlanningSemanticCanonicalizationV5({ originalGraph: baseline, document: input,
    baseCanonicalization: canonical(input, baseline, turnId), contextualAnswer: false, questionCode: null,
    operationKeyPrefix: turnId }).canonicalization;
  expect(finalized.status, finalized.errors.join(',')).toBe('applied');
  return finalized.graph;
}
let checkpoint: ReturnType<typeof createGraphCheckpointAssertions>;
beforeEach(() => { checkpoint = createGraphCheckpointAssertions(scope); });
afterEach(() => checkpoint.restore());

it('rejects foreign-task references at the required live and historical boundaries', () => {
  for (const kind of ['component-owner', 'effort-task', 'effort-component', 'effort-workload', 'effort-owner',
    'temporal-task', 'temporal-component', 'recurrence-task', 'recurrence-component'] as const) {
    const bucket = kind.startsWith('temporal') ? 'temporalConstraints' : kind.startsWith('recurrence') ? 'recurrences' : null;
    const statuses = bucket ? ['active', 'removed', 'superseded'] as const : ['active'] as const;
    for (const status of statuses) {
      const input = scopedDocument('component');
      const graph = canonical(input).graph;
      if (bucket) markFixtureHistory(graph, bucket, status);
      checkpoint.roundTrip(graph);
      if (bucket) {
        const foreignTask = kind.endsWith('-task');
        graph[bucket][0].targetFactId = foreignTask ? graph.tasks[1].id : graph.components[1].id;
        const wire = bucket === 'temporalConstraints' ? input.tasks[0].temporalConstraints[0] : input.tasks[0].recurrence[0];
        wire.targetLocalId = foreignTask ? 'english' : 'english-component';
        expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
      } else if (kind === 'component-owner') graph.workloads[0].componentId = graph.components[1].id;
      else if (kind === 'effort-owner') graph.effortEstimates[0].taskId = graph.tasks[1].id;
      else {
        graph.effortEstimates[0].targetFactId = kind === 'effort-task' ? graph.tasks[1].id
          : kind === 'effort-component' ? graph.components[1].id : graph.workloads[1].id;
        input.tasks[0].effortEstimates[0].targetLocalId = kind === 'effort-task' ? 'english'
          : kind === 'effort-component' ? 'english-component' : 'english-workload';
        expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
      }
      checkpoint.reject(graph);
    }
  }
  for (const bucket of ['temporalConstraints', 'recurrences'] as const) {
    for (const status of ['active', 'removed', 'superseded'] as const) {
      for (const target of ['missing', 'wrong-kind']) {
        const graph = canonical(scopedDocument('component')).graph;
        markFixtureHistory(graph, bucket, status);
        checkpoint.roundTrip(graph);
        graph[bucket][0].targetFactId = target === 'missing' ? 'missing' : graph.workloads[0].id;
        checkpoint.reject(graph);
      }
    }
  }
});

it('preserves same-task targets and exact estimates across checkpoint reload', () => {
  fc.assert(fc.property(fc.record({ target: fc.constantFrom<Target>('task', 'component', 'workload'),
    taskLevel: fc.boolean(), minutes: fc.integer({ min: 5, max: 300 }) }), ({ target, taskLevel, minutes }) => {
    const graph = canonical(document(target, target !== 'component' && taskLevel, minutes)).graph;
    checkpoint.roundTrip(graph);
    const compiled = compileGenericPlanningWorkItems(createWeeklyPlanningActiveSchedulerGraphViewV5(checkpoint.load()!.graph));
    expect(compiled.issues).toEqual([]);
    const math = compiled.items.find(item => item.taskId === graph.tasks[0].id)!;
    expect(math.label).toContain('数学');
    expect(math.label).not.toContain('英語');
    expect(math.baseEstimatedMinutes).toBe(minutes);
  }), { numRuns: 30, examples: [
    [{ target: 'task', taskLevel: true, minutes: 60 }],
    [{ target: 'component', taskLevel: false, minutes: 90 }],
    [{ target: 'workload', taskLevel: false, minutes: 120 }],
    [{ target: 'workload', taskLevel: true, minutes: 30 }],
  ] });
  for (const target of ['task', 'component'] as const) {
    const baseline = canonical(scopedDocument(target)).graph;
    checkpoint.roundTrip(baseline);
    for (const kind of ['temporal_constraint', 'recurrence'] as const) {
      const input = document();
      input.tasks = [task('new', '追加課題', 20, 90)];
      scopedDocument(target, input);
      input.tasks[0].existingPublicId = baseline.tasks[0].id;
      input.tasks[0].study!.components[0].workloads = [];
      if (target === 'task') input.tasks[0].study!.components = [];
      else input.tasks[0].study!.components[0].existingPublicId = baseline.components[0].id;
      input.tasks[0].effortEstimates = [];
      if (kind === 'temporal_constraint') input.tasks[0].recurrence = [];
      else input.tasks[0].temporalConstraints = [];
      const original = kind === 'temporal_constraint' ? baseline.temporalConstraints[0] : baseline.recurrences[0];
      input.corrections = [{ localId: 'replace-condition', target: { kind, publicId: original.id, localId: null, mention: '元の条件' },
        operation: 'replace', replacementLocalId: kind === 'temporal_constraint' ? 'new-temporal' : 'new-recurrence', sourceText: '条件を更新' }];
      const corrected = commitCorrection(baseline, input, `replace-${kind}-${target}`);
      expect(corrected.factLifecycles.find(entry => entry.factId === original.id)!.status).toBe('superseded');
      checkpoint.roundTrip(corrected);
    }
  }
});

it('retains terminal correction provenance but requires literal lifecycle status tags', () => {
  const baseline = canonical(document()).graph;
  const input = document();
  input.tasks = [task('math-new', '追加課題', 20, 90)];
  input.corrections = [
    { localId: 'replace-work', target: { kind: 'workload', publicId: baseline.workloads[0].id, localId: null, mention: '旧数学' },
      operation: 'replace', replacementLocalId: 'math-new-workload', sourceText: '数学の作業量を変更' },
    { localId: 'remove-new-effort', target: { kind: 'effort_estimate', publicId: null, localId: 'math-new-effort', mention: '追加の見積もり' },
      operation: 'remove', replacementLocalId: null, sourceText: '追加の見積もりは削除' },
  ];
  const publicStateSummary = createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, baseline);
  expect(validateWeeklyPlanningExistingEntityBindingsAgainstPublicStateV5({ document: input, publicStateSummary })).toEqual([]);
  expect(validateWeeklyPlanningCorrectionTargetReferencesV5(input, publicStateSummary)).toEqual([]);
  const staged = canonical(input, baseline, 'correction-turn');
  const finalize = (baseCanonicalization: typeof staged) => finalizeWeeklyPlanningSemanticCanonicalizationV5({
    originalGraph: baseline, document: input, baseCanonicalization,
    contextualAnswer: false, questionCode: null, operationKeyPrefix: 'correction-turn',
  }).canonicalization;
  const rejectedWrite = finalize(staged);
  expect(rejectedWrite.status).toBe('rejected');
  expect(rejectedWrite.graph).toBe(baseline);
  expect(rejectedWrite.diff).toBeNull();
  expect(rejectedWrite.errors.join('|')).toContain('replacement-container-not-installed');

  // Retained-checkpoint fixture, not current public-write acceptance. Main 9f0e0911
  // accepted these labels and then pruned the temporary containers. Reconstruct its
  // lifecycle with neutral labels, then restore only the terminal historical labels.
  // Same-name public writes require explicit bindings; no shared validator is skipped.
  const historicalStaging = structuredClone(staged);
  const temporaryTaskId = staged.localToFactId['math-new'];
  const temporaryComponentId = staged.localToFactId['math-new-component'];
  historicalStaging.graph.tasks.find(fact => fact.id === temporaryTaskId)!.title = baseline.tasks[0].title;
  historicalStaging.graph.components.find(fact => fact.id === temporaryComponentId)!.label = baseline.components[0].label;
  const historicalResult = finalize(historicalStaging);
  expect(historicalResult.status, historicalResult.errors.join('|')).toBe('applied');
  const graph = historicalResult.graph;
  expect(graph.factLifecycles.find(entry => entry.factId === temporaryTaskId)!.status).toBe('removed');
  expect(graph.factLifecycles.find(entry => entry.factId === temporaryComponentId)!.status).toBe('removed');
  graph.tasks.find(fact => fact.id === temporaryTaskId)!.title = input.tasks[0].title;
  graph.components.find(fact => fact.id === temporaryComponentId)!.label = input.tasks[0].study!.components[0].label;
  // Frozen from the actual original input on immutable main, not this implementation.
  expect(createHash('sha256').update(JSON.stringify(graph)).digest('hex')).toBe('e84fb3720d8452a7ade752d3aa06509c96b4fbbc856c307c721ca083973aa3a9');
  const historical = graph.effortEstimates.find(fact => fact.source.semanticLocalId === 'math-new-effort')!;
  const target = graph.workloads.find(fact => fact.id === historical.targetFactId)!;
  expect(historical.taskId).not.toBe(target.taskId);
  const index = graph.factLifecycles.findIndex(entry => entry.factId === historical.id);
  expect(graph.factLifecycles[index].status).toBe('removed');
  checkpoint.roundTrip(graph);
  expect(checkpoint.load()!.graph).toEqual(graph);

  // Both terminal statuses are retained checkpoint provenance, not live estimates.
  const superseded = structuredClone(graph);
  Object.assign(superseded.factLifecycles[index], {
    status: 'superseded', supersededByFactId: baseline.effortEstimates[1].id,
  });
  checkpoint.roundTrip(superseded);
  expect(createWeeklyPlanningActiveSchedulerGraphViewV5(checkpoint.load()!.graph).effortEstimates
    .some(fact => fact.id === historical.id)).toBe(false);
  checkpoint.roundTrip(graph);

  const badHistoricalWorkload = structuredClone(graph);
  expect(graph.factLifecycles.find(entry => entry.factId === baseline.workloads[0].id)!.status).toBe('superseded');
  badHistoricalWorkload.workloads.find(fact => fact.id === baseline.workloads[0].id)!.componentId = baseline.components[1].id;
  checkpoint.reject(badHistoricalWorkload);
  checkpoint.roundTrip(graph);

  for (const change of [
    { targetFactId: 'missing' }, { targetFactId: graph.studyContexts[0].id }, { taskId: 'missing' },
  ]) {
    const malformed = structuredClone(graph);
    Object.assign(malformed.effortEstimates.find(fact => fact.id === historical.id)!, change);
    checkpoint.reject(malformed);
    checkpoint.roundTrip(graph);
  }

  for (const status of ['active', 'removed', 'superseded']) {
    const malformed = structuredClone(graph);
    Object.assign(malformed.factLifecycles[index], { status: [status], supersededByFactId: baseline.effortEstimates[0].id });
    expect(validateWeeklyPlanningFactGraphValueV5(malformed).errors).toContain(`graph.factLifecycles[${index}].status`);
    checkpoint.reject(malformed);
    checkpoint.roundTrip(graph);
  }
});
