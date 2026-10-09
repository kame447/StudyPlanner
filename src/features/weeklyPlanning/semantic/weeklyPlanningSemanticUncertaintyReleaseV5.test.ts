import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { dropReReleasedUncertaintiesV5, releasedFreeFormUncertaintiesV5 } from './weeklyPlanningSemanticUncertaintyReleaseV5';

type Json = Record<string, unknown>;
const source = (sourceText: string) => ({ channel: 'user', turnId: 't', sourceText }) as unknown as WeeklyPlanningFactGraphV5['uncertainties'][number]['source'];
function graph(o: { targetIsComponent?: boolean; field?: string; released?: boolean } = {}): WeeklyPlanningFactGraphV5 {
  const base = createEmptyWeeklyPlanningFactGraphV5();
  const life = (factId: string) => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null });
  return {
    ...base, revision: 2,
    appliedLifecycleOperationKeys: o.released ? ['c:t3:released-free-form-uncertainty:U'] : [],
    tasks: [{ id: 'T', title: 't' }] as never, components: [{ id: 'C', taskId: 'T', role: 'chapter', label: 'c' }] as never,
    recurrences: [{ id: 'R', taskId: 'T', targetFactId: 'T', kind: 'weekly', count: null, days: ['wednesday'] }] as never,
    temporalConstraints: [{ id: 'K', taskId: 'T', targetFactId: 'T', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null,
      namedTimePeriod: 'night', startTime: null, endTime: null }] as never,
    uncertainties: [{ id: 'U', targetFactId: o.targetIsComponent ? 'C' : 'T', field: o.field ?? 'free_form', reason: 'r', source: source('元の引用'), createdRevision: 1 }],
    factLifecycles: ['T', 'C', 'R', 'K', 'U'].map(life),
  };
}
const shell = (extra: Json = {}): Json => ({ localId: 'task', existingPublicId: 'T', decompositionStatus: 'atomic', category: 'study', title: 't', study: null,
  workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: 's', ...extra });
const doc = (o: Json = {}): WeeklyPlanningSemanticDocumentV5 => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  conversationActs: [{ kind: 'answer_pending_question', targetPublicId: 'T' }], ...o }) as unknown as WeeklyPlanningSemanticDocumentV5;
const night = { localId: 'k', targetLocalId: 'task', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'unspecified', sourceText: 'q' };
const recurrence = (days: string[]) => ({ localId: 'r', targetLocalId: 'task', kind: 'weekly', count: null, days, sourceText: 'q' });
const pending = { questionCode: 'semantic_uncertainty', targetFactId: 'U' };
const release = (g: WeeklyPlanningFactGraphV5, d: WeeklyPlanningSemanticDocumentV5, noOp = false) =>
  releasedFreeFormUncertaintiesV5({ graph: g, document: d, pendingQuestion: pending, noOpRetryConfirmed: noOp });

describe('releasedFreeFormUncertaintiesV5: replay identity and targets', () => {
  it('a restated identical constraint or recurrence is a replay and never releases; a new one does', () => {
    expect(release(graph(), doc({ tasks: [shell({ temporalConstraints: [night] })] }))).toEqual([]);
    expect(release(graph(), doc({ tasks: [shell({ recurrence: [recurrence(['wednesday'])] })] }))).toEqual([]);
    expect(release(graph(), doc({ tasks: [shell({ recurrence: [recurrence(['thursday'])] })] }))).toEqual([{ id: 'U', basis: 'delta' }]);
    expect(release(graph(), doc({ tasks: [shell({ temporalConstraints: [{ ...night, namedTimePeriod: 'morning' }] })] }))).toEqual([{ id: 'U', basis: 'delta' }]);
  });
  it('a restated concern signal carries no planner fact and does not qualify', () => {
    expect(release(graph(), doc({ tasks: [shell({ durableContextSignals: [{ localId: 'd', kind: 'concern', value: 'v', sourceText: 'q' }] })] }))).toEqual([]);
  });
  it('a component-targeted uncertainty is answered through its task', () => {
    const g = graph({ targetIsComponent: true });
    expect(release(g, doc({ tasks: [shell({ recurrence: [recurrence(['thursday'])] })] }))).toEqual([{ id: 'U', basis: 'delta' }]);
  });
  it('no delta anywhere releases only after the existing no-op retry ran', () => {
    expect(release(graph(), doc(), false)).toEqual([]);
    expect(release(graph(), doc(), true)).toEqual([{ id: 'U', basis: 'no_delta' }]);
    expect(release(graph(), doc({ relations: [{ localId: 'x' }] }), true)).toEqual([]);
  });
  it('known fields, unbound acts and re-declarations never release', () => {
    expect(release(graph({ field: 'work_breakdown' }), doc(), true)).toEqual([]);
    expect(release(graph(), doc({ conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] }), true)).toEqual([]);
    expect(release(graph(), doc({ uncertainties: [{ localId: 'u', targetLocalId: null, field: 'free_form', reason: 'r', sourceText: 'q' }] }), true)).toEqual([]);
  });
});

describe('dropReReleasedUncertaintiesV5', () => {
  const redeclared = (sourceText: string, field = 'free_form') => doc({
    tasks: [shell()], uncertainties: [{ localId: 'u', targetLocalId: 'task', field, reason: 'r', sourceText }],
  });
  it('drops a re-declaration of a released point whose quote the current text does not carry', () => {
    const result = dropReReleasedUncertaintiesV5({ graph: graph({ released: true }), document: redeclared('元の引用'), userText: '英語の本は木曜の夜に' });
    expect(result.dropped).toBe(1);
    expect(result.document.uncertainties).toEqual([]);
  });
  it('keeps it when the current text carries the quote (the user re-raised it)', () => {
    expect(dropReReleasedUncertaintiesV5({ graph: graph({ released: true }), document: redeclared('元の引用'), userText: 'やっぱり 元の引用 が気になる' }).dropped).toBe(0);
  });
  it('keeps a different field, a known field, and everything when nothing was ever released', () => {
    expect(dropReReleasedUncertaintiesV5({ graph: graph({ released: true }), document: redeclared('元の引用', 'other_point'), userText: 'x' }).dropped).toBe(0);
    expect(dropReReleasedUncertaintiesV5({ graph: graph({ released: true }), document: redeclared('元の引用', 'work_breakdown'), userText: 'x' }).dropped).toBe(0);
    expect(dropReReleasedUncertaintiesV5({ graph: graph(), document: redeclared('元の引用'), userText: 'x' }).dropped).toBe(0);
  });
});
