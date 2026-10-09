import { describe, expect, it } from 'vitest';
import { conditionDocument, conditionSetupDocument, CONDITION_FOLLOWUP } from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { projectWeeklyPlanningExistingWorkloadRateReferenceV5 } from './weeklyPlanningExistingWorkloadRateReferenceV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

type Json = Record<string, unknown>;
type NestedKind = 'temporalConstraints' | 'effortEstimates' | 'recurrence';

const nested = (kind: NestedKind, targetLocalId: string): Json => kind === 'temporalConstraints'
  ? { localId: 'fact', targetLocalId, kind: 'preferred_window', constraintLevel: 'soft', dateExpression: 'weekday:wednesday', namedTimePeriod: 'evening',
      startTime: null, endTime: null, precision: 'unspecified', sourceText: CONDITION_FOLLOWUP }
  : kind === 'effortEstimates'
    ? { localId: 'fact', targetLocalId, kind: 'session_duration', minutes: 60, unitCode: 'session', precision: 'approximate', sourceText: CONDITION_FOLLOWUP }
    : { localId: 'fact', targetLocalId, kind: 'custom', count: 2, days: [], sourceText: CONDITION_FOLLOWUP };

function fixture() {
  const accepted = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: conditionSetupDocument() as unknown as WeeklyPlanningSemanticDocumentV5,
    context: { conversationId: 'self-reference', turnId: 'setup', expectedRevision: 0 } });
  if (accepted.status !== 'applied') throw new Error('fixture setup rejected');
  const graph = accepted.graph;
  const [task, other] = graph.tasks;
  const shell = (extra: Json = {}): Json => ({ localId: 'shell', existingPublicId: task.id, decompositionStatus: 'atomic', category: 'study', title: task.title,
    study: null, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: CONDITION_FOLLOWUP, ...extra });
  return { graph, task, other, shell };
}
const project = (graph: ReturnType<typeof fixture>['graph'], tasks: Json[]) => {
  const rawResponse = JSON.stringify(conditionDocument({ planningIntent: 'update_plan', tasks }));
  return { input: rawResponse, ...projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse, graph }) };
};
const targetOf = (rawResponse: string, kind: NestedKind) => (JSON.parse(rawResponse).tasks[0][kind][0] as Json).targetLocalId;

describe('task self-reference projection (live H r1 on 80af22a3)', () => {
  it.each(['temporalConstraints', 'effortEstimates', 'recurrence'] as const)('rewrites a nested %s targeting its own task\'s public id to the entry\'s localId, with a diagnostic', kind => {
    const f = fixture();
    const result = project(f.graph, [f.shell({ [kind]: [nested(kind, f.task.id)] })]);
    expect(targetOf(result.rawResponse, kind)).toBe('shell');
    expect(result.repairs).toEqual([`task-self-reference-projected:${JSON.stringify(['shell', f.task.id, kind, 'fact'])}`]);
    const validation = validateWeeklyPlanningSemanticResponseV5(result.rawResponse, { currentUserText: CONDITION_FOLLOWUP, committedGraph: f.graph,
      conversationArchitecture: 'interaction_v1', publicStateSummary: { tasks: f.graph.tasks.map(task => ({ publicId: task.id, title: task.title, category: task.category })) } });
    expect(validation.errors.filter(error => error.includes('targetLocalId'))).toEqual([]);
  });

  it.each([
    ['another accepted task\'s public id', (f: ReturnType<typeof fixture>) => ({ target: f.other.id, tasks: [f.shell({ temporalConstraints: [nested('temporalConstraints', f.other.id)] })] })],
    ['another task\'s public id even when that task is in the document', (f: ReturnType<typeof fixture>) => ({ target: f.other.id,
      tasks: [f.shell({ temporalConstraints: [nested('temporalConstraints', f.other.id)] }), { ...f.shell({ localId: 'second', existingPublicId: f.other.id }) }] })],
    ['a public id of a task absent from the graph', (f: ReturnType<typeof fixture>) => ({ target: 'wpf_task_absent', tasks: [f.shell({ temporalConstraints: [nested('temporalConstraints', 'wpf_task_absent')] })] })],
    ['a value that is itself a declared localId', (f: ReturnType<typeof fixture>) => ({ target: f.task.id,
      tasks: [f.shell({ temporalConstraints: [nested('temporalConstraints', f.task.id)], recurrence: [{ ...nested('recurrence', 'shell'), localId: f.task.id }] })] })],
  ])('leaves %s untouched', (_name, build) => {
    const f = fixture();
    const { target, tasks } = build(f);
    const result = project(f.graph, tasks);
    expect(result.rawResponse).toBe(result.input);
    expect(result.repairs).toEqual([]);
    expect(targetOf(result.rawResponse, 'temporalConstraints')).toBe(target);
  });

  it('leaves a superseded or unknown task entry untouched', () => {
    const f = fixture();
    f.graph.factLifecycles.find(lifecycle => lifecycle.factId === f.task.id)!.status = 'superseded';
    const tasks = [f.shell({ temporalConstraints: [nested('temporalConstraints', f.task.id)] })];
    expect(project(f.graph, tasks).repairs).toEqual([]);
    const unknown = fixture();
    expect(project(unknown.graph, [unknown.shell({ existingPublicId: 'wpf_task_unknown', temporalConstraints: [nested('temporalConstraints', 'wpf_task_unknown')] })]).repairs).toEqual([]);
  });

  it('does nothing without a graph', () => {
    const f = fixture();
    const rawResponse = JSON.stringify(conditionDocument({ planningIntent: 'update_plan', tasks: [f.shell({ temporalConstraints: [nested('temporalConstraints', f.task.id)] })] }));
    expect(projectWeeklyPlanningExistingWorkloadRateReferenceV5({ rawResponse })).toEqual({ rawResponse, repairs: [] });
  });

  it('legacy_v5 keeps the rejection: the validator never projects for legacy', () => {
    const f = fixture();
    const { conversationActs: _acts, ...legacyDocument } = conditionDocument({ planningIntent: 'update_plan',
      tasks: [f.shell({ temporalConstraints: [nested('temporalConstraints', f.task.id)] })] }) as Json;
    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(legacyDocument), { currentUserText: CONDITION_FOLLOWUP, committedGraph: f.graph,
      conversationArchitecture: 'legacy_v5', publicStateSummary: { tasks: f.graph.tasks.map(task => ({ publicId: task.id, title: task.title, category: task.category })) } });
    expect(result.errors).toContain('document.tasks[0].temporalConstraints[0].targetLocalId');
    expect(result.algorithmicRepairs.some(repair => repair.startsWith('task-self-reference-projected'))).toBe(false);
  });
});
