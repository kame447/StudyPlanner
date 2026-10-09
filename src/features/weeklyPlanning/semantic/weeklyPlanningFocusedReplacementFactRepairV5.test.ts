import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  applyFocusedReplacementFactRepairV5, createFocusedReplacementFactRepairMessagesV5, parseFocusedReplacementFactRepairDecisionV5,
  readFocusedReplacementFactRepairCandidatesV5,
} from './weeklyPlanningFocusedReplacementFactRepairV5';

type Json = Record<string, unknown>;
const workload = (localId: string): Json => ({ localId, quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null, sourceText: '30ページ' });
function accepted(componentLevel = false) {
  const task: Json = { localId: 'paper', category: 'study', title: '文献',
    study: { purpose: 'self_study', contextLabel: null, components: componentLevel ? [{ localId: 'comp', parentLocalId: null, role: 'material', label: '教材', workloads: [workload('amt')], sourceText: '教材' }] : [] },
    workloads: componentLevel ? [] : [workload('amt')], effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: '文献を30ページ' };
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(),
    document: { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan', planningWindow: null, tasks: [task] as never, relations: [],
      availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] } as WeeklyPlanningSemanticDocumentV5,
    context: { conversationId: 'focused-replacement', turnId: 'turn-1', expectedRevision: 0 } });
  if (result.status !== 'applied') throw new Error('setup rejected');
  return { graph: result.graph, taskId: result.localToFactId['paper'], workloadId: result.localToFactId['amt'] };
}
const dangling = (index: number, id: string) => `document.corrections[${index}].replacementLocalId:unknown:${id}`;
const raw = (f: ReturnType<typeof accepted>, over: Json = {}, tasks?: Json[]) => JSON.stringify({ corrections: [{ localId: 'c1', target: { kind: 'workload', publicId: f.workloadId, localId: null, mention: null },
  operation: 'replace', replacementLocalId: 'pages20', sourceText: 'やっぱり20ページにして', ...over }],
  tasks: tasks ?? [{ localId: 'paper', existingPublicId: f.taskId, workloads: [] }] });

describe('focused replacement-fact repair (x9b): candidate, request, merge', () => {
  it('reads exactly the dangling workload replacement of an accepted task-level workload', () => {
    const f = accepted();
    const candidates = readFocusedReplacementFactRepairCandidatesV5({ rawResponse: raw(f), validationErrors: [dangling(0, 'pages20')], committedGraph: f.graph });
    expect(candidates).toEqual([{ localId: 'pages20', correctionIndex: 0, correctionQuote: 'やっぱり20ページにして', taskIndex: 0,
      replaces: { amount: 30, unitCode: 'page', unitLabel: 'ページ', quantityRole: 'target', perOccurrence: false, periodExpression: null } }]);
  });

  it.each([
    ['another validation error alongside', (f: ReturnType<typeof accepted>) => ({ raw: raw(f), errors: [dangling(0, 'pages20'), 'document.tasks[0].title:required'] })],
    ['a non-workload target', (f: ReturnType<typeof accepted>) => ({ raw: raw(f, { target: { kind: 'effort_estimate', publicId: f.workloadId, localId: null, mention: null } }), errors: [dangling(0, 'pages20')] })],
    ['an unknown workload', (f: ReturnType<typeof accepted>) => ({ raw: raw(f, { target: { kind: 'workload', publicId: 'wpf_workload_none', localId: null, mention: null } }), errors: [dangling(0, 'pages20')] })],
    ['a remove correction', (f: ReturnType<typeof accepted>) => ({ raw: raw(f, { operation: 'remove' }), errors: [dangling(0, 'pages20')] })],
    ['no task entry bound to the workload\'s task', (f: ReturnType<typeof accepted>) => ({ raw: raw(f, {}, [{ localId: 'x', existingPublicId: 'wpf_task_other', workloads: [] }]), errors: [dangling(0, 'pages20')] })],
    ['two task entries bound to the task', (f: ReturnType<typeof accepted>) => ({ raw: raw(f, {}, [{ localId: 'a', existingPublicId: f.taskId, workloads: [] }, { localId: 'b', existingPublicId: f.taskId, workloads: [] }]), errors: [dangling(0, 'pages20')] })],
    ['an id that is already declared as a workload', (f: ReturnType<typeof accepted>) => ({ raw: raw(f, {}, [{ localId: 'paper', existingPublicId: f.taskId, workloads: [{ localId: 'pages20' }] }]), errors: [dangling(0, 'pages20')] })],
    ['an error naming a different id than the correction', (f: ReturnType<typeof accepted>) => ({ raw: raw(f), errors: [dangling(0, 'other')] })],
    ['more than three dangling ids', (f: ReturnType<typeof accepted>) => ({ raw: raw(f), errors: [0, 1, 2, 3].map(i => dangling(i, 'pages20')) })],
  ])('is not a candidate with %s', (_name, build) => {
    const f = accepted();
    const { raw: rawResponse, errors } = build(f);
    expect(readFocusedReplacementFactRepairCandidatesV5({ rawResponse, validationErrors: errors, committedGraph: f.graph })).toBeNull();
  });

  it('is not a candidate for a component-held workload, without a graph, or for invalid JSON', () => {
    const component = accepted(true);
    expect(readFocusedReplacementFactRepairCandidatesV5({ rawResponse: raw(component), validationErrors: [dangling(0, 'pages20')], committedGraph: component.graph })).toBeNull();
    const f = accepted();
    expect(readFocusedReplacementFactRepairCandidatesV5({ rawResponse: raw(f), validationErrors: [dangling(0, 'pages20')] })).toBeNull();
    expect(readFocusedReplacementFactRepairCandidatesV5({ rawResponse: '{', validationErrors: [dangling(0, 'pages20')], committedGraph: f.graph })).toBeNull();
  });

  it('the request carries only the user text and the named corrections (typed accepted workload, quote, id)', () => {
    const f = accepted();
    const candidates = readFocusedReplacementFactRepairCandidatesV5({ rawResponse: raw(f), validationErrors: [dangling(0, 'pages20')], committedGraph: f.graph })!;
    const messages = createFocusedReplacementFactRepairMessagesV5({ userText: 'やっぱり20ページにして、金曜日までに終わらせたい', candidates });
    const payload = JSON.parse(messages[1].content);
    expect(Object.keys(payload).sort()).toEqual(['corrections', 'userText']);
    expect(payload.corrections).toEqual([{ localId: 'pages20', quote: 'やっぱり20ページにして', replaces: { amount: 30, unitCode: 'page', unitLabel: 'ページ' } }]);
  });

  const provided = (over: Json = {}) => ({ replacements: [{ localId: 'pages20', decision: 'provided', quantityRole: 'target', amount: 20, unitCode: 'page', unitLabel: 'ページ', sourceText: '20ページ', ...over }] });
  it('merges only the declared workload (recurrence scope copied from the replaced workload), and refuses every non-answer', () => {
    const f = accepted();
    const candidates = readFocusedReplacementFactRepairCandidatesV5({ rawResponse: raw(f), validationErrors: [dangling(0, 'pages20')], committedGraph: f.graph })!;
    const merged = JSON.parse(applyFocusedReplacementFactRepairV5({ rawResponse: raw(f), candidates, decision: parseFocusedReplacementFactRepairDecisionV5(JSON.stringify(provided()))! })!);
    expect(merged.tasks[0].workloads).toEqual([{ localId: 'pages20', quantityRole: 'target', amount: 20, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, sourceText: '20ページ' }]);
    expect(merged.corrections).toEqual(JSON.parse(raw(f)).corrections);
    for (const over of [{ decision: 'fallback' }, { sourceText: ' ' }, { unitCode: 'banana' }, { localId: 'other' }]) {
      const decision = parseFocusedReplacementFactRepairDecisionV5(JSON.stringify(provided(over)));
      expect(decision && applyFocusedReplacementFactRepairV5({ rawResponse: raw(f), candidates, decision })).toBeNull();
    }
    expect(applyFocusedReplacementFactRepairV5({ rawResponse: raw(f), candidates, decision: { replacements: [] } })).toBeNull();
  });

  it('the decision parser accepts only the exact schema', () => {
    expect(parseFocusedReplacementFactRepairDecisionV5('{')).toBeNull();
    expect(parseFocusedReplacementFactRepairDecisionV5(JSON.stringify({ replacements: [], extra: 1 }))).toBeNull();
    expect(parseFocusedReplacementFactRepairDecisionV5(JSON.stringify({ replacements: [{ localId: 'x' }] }))).toBeNull();
    expect(parseFocusedReplacementFactRepairDecisionV5(JSON.stringify(provided()))?.replacements).toHaveLength(1);
  });
});
