import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { guardAnswerAgainstHeldPurposeV5, parseHeldQuestionPurposeIntentV5 } from './weeklyPlanningAnswerPurposeGuardV5';

type Json = Record<string, unknown>;
const life = (factId: string) => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null });
function graph(o: { scopeTotal?: boolean; workload?: boolean; material?: boolean } = {}): WeeklyPlanningFactGraphV5 {
  const base = createEmptyWeeklyPlanningFactGraphV5();
  const workloads = [
    ...(o.scopeTotal ? [{ id: 'S', taskId: 'T', componentId: null, quantityRole: 'scope_total', amount: 90, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }] : []),
    ...(o.workload ? [{ id: 'W', taskId: 'T', componentId: null, quantityRole: 'target', amount: 20, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }] : []),
  ];
  const components = o.material ? [{ id: 'C', taskId: 'T', role: 'material', label: 'ノート', parentComponentId: null }] : [];
  return {
    ...base, revision: 2, tasks: [{ id: 'T', title: '卒研', category: 'study' }] as never, workloads: workloads as never, components: components as never,
    uncertainties: [{ id: 'U', targetFactId: 'T', field: 'work_breakdown', reason: 'r', source: { sourceText: 'q' }, createdRevision: 1 }] as never,
    factLifecycles: ['T', 'U', ...workloads.map(w => w.id), ...components.map(c => c.id)].map(life),
  };
}
const task = (extra: Json = {}): Json => ({ localId: 'task', existingPublicId: 'T', decompositionStatus: 'atomic', category: 'study', title: '卒研', study: null,
  workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: 's', ...extra });
const doc = (...tasks: Json[]): WeeklyPlanningSemanticDocumentV5 => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks, relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [] }) as unknown as WeeklyPlanningSemanticDocumentV5;
const wl = (role: string, localId = 'w', amount = 30): Json => ({ localId, quantityRole: role, amount, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: 'q' });
const total = (targetLocalId = 'task'): Json => ({ localId: 'e', targetLocalId, kind: 'total_duration', minutes: 120, unitCode: null, precision: 'approximate', sourceText: 'q' });
const held = { purpose: 'current_progress' as const, ownerTaskId: 'T' };
const guard = (g: WeeklyPlanningFactGraphV5, d: WeeklyPlanningSemanticDocumentV5) => guardAnswerAgainstHeldPurposeV5({ graph: g, document: d, held });
const roles = (d: WeeklyPlanningSemanticDocumentV5) => d.tasks.flatMap(t => t.workloads.map(w => w.quantityRole));

describe('parseHeldQuestionPurposeIntentV5', () => {
  it('reads a persisted purpose:<enum> intent forward-compatibly; unknown, effort and legacy values hold nothing', () => {
    expect(parseHeldQuestionPurposeIntentV5('purpose:current_progress')).toBe('current_progress');
    for (const intent of ['purpose:future_thing', 'total_duration', 'duration_per_unit', 'session_duration', 'all_requested_work_complete', 'existing_target_progress', 'semantic_uncertainty', '', null, undefined]) {
      expect(parseHeldQuestionPurposeIntentV5(intent)).toBeNull();
    }
  });
});

describe('guardAnswerAgainstHeldPurposeV5: each contribution is judged on its own', () => {
  it('a target amount and a bare total are demoted to declared; the held purpose never upgrades or fills a role', () => {
    const target = guard(graph(), doc(task({ workloads: [wl('target')] })));
    expect(roles(target.document)).toEqual(['declared']);
    const bare = guard(graph(), doc(task({ effortEstimates: [total()] })));
    expect(roles(bare.document)).toEqual(['declared']);
    expect(bare.document.tasks[0].effortEstimates).toEqual([]);
    for (const role of ['declared', 'unknown']) expect(guard(graph(), doc(task({ workloads: [wl(role)] }))).demoted).toBe(0);
  });
  it('completed + a bare total: the completed amount binds, the total is demoted', () => {
    const result = guard(graph(), doc(task({ workloads: [wl('completed')], effortEstimates: [total()] })));
    expect(roles(result.document)).toEqual(['completed', 'declared']);
    expect(result.demoted).toBe(1);
  });
  it('a total that is the cost of a stated quantity (targets a workload, or a remaining amount exists) is left alone', () => {
    expect(guard(graph(), doc(task({ workloads: [wl('completed', 'w')], effortEstimates: [total('w')] }))).demoted).toBe(0);
    expect(guard(graph(), doc(task({ workloads: [wl('remaining')], effortEstimates: [total()] }))).demoted).toBe(0);
    expect(guard(graph({ workload: true }), doc(task({ effortEstimates: [total()] }))).demoted).toBe(0);
  });
  it('a typed restatement of an accepted workload is a replay and is untouched', () => {
    expect(guard(graph({ workload: true }), doc(task({ workloads: [wl('target', 'again', 20)] }))).demoted).toBe(0);
  });
  it('entity bypass: a NEW task with the owner\'s exact normalized title counts as the owner; another title does not', () => {
    const bypass = guard(graph(), doc(task({ existingPublicId: null, title: ' 卒研 ', effortEstimates: [total()] })));
    expect(roles(bypass.document)).toEqual(['declared']);
    expect(guard(graph(), doc(task({ existingPublicId: null, title: '数学', effortEstimates: [total()] }))).demoted).toBe(0);
  });
  it('component amounts are covered too', () => {
    const study = { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [{ localId: 'c', existingPublicId: null, parentLocalId: null, role: 'material', label: 'ノート', workloads: [wl('target')], durableContextSignals: [], sourceText: 'q' }] };
    const result = guard(graph(), doc(task({ study })));
    expect(result.document.tasks[0].study?.components[0].workloads[0].quantityRole).toBe('declared');
  });
});
