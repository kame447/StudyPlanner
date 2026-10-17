import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import {
  createReplyReferenceSnapshotV5, extractReplyReferenceEvidenceV5,
  resolveReplyReferenceCandidateV5,
} from './weeklyPlanningReplyReferenceCandidatesV5';

const source = (turnId: string) => ({
  conversationId: 'c', turnId, semanticLocalId: 'local', sourceText: 'ユーザーの入力', origin: 'user' as const,
});
const messages: WeeklyPlanningMessage[] = [
  { id: 't1:user', role: 'user', content: '数学をやりたい', createdAt: '2026-10-17T00:00:00Z' },
  { id: 't2:user', role: 'user', content: '青チャートの微積分を20問', createdAt: '2026-10-17T00:01:00Z' },
  { id: 't3:assistant', role: 'assistant', content: '1問あたりの時間は？', createdAt: '2026-10-17T00:02:00Z' },
];
function fixture() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 3;
  graph.tasks.push({ id: 'task', title: '数学', category: 'study', source: source('t1'), createdRevision: 1 });
  graph.components.push(
    { id: 'material', taskId: 'task', parentComponentId: null, label: '青チャート',
      role: 'material', source: source('t2'), createdRevision: 2 },
    { id: 'topic', taskId: 'task', parentComponentId: 'material', label: '微積分',
      role: 'topic', source: source('t2'), createdRevision: 2 },
  );
  graph.workloads.push({ id: 'work', taskId: 'task', componentId: 'topic', quantityRole: 'target',
    amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, source: source('t2'), createdRevision: 3 });
  return graph;
}
function question(): PlanningIntakeState {
  return { lastQuestionContext: {
    kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 'work',
    presentation: {
      version: 1, turnId: 't3', assistantMessageId: 't3:assistant',
      planningStateRevision: 7, graphRevision: 3,
      content: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none',
        selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 },
        previewPromotionControl: false },
    },
  } } as PlanningIntakeState;
}
describe('bounded historical reply-reference candidates', () => {
  it('binds a reply to a real message, full task ancestry and typed slot without extracting values', () => {
    const input = { graph: fixture(), messages, previousState: question(), inputStateRevision: 7 };
    const snapshot = createReplyReferenceSnapshotV5(input)!;
    const amount = snapshot.candidates.find(item => item.sourceMessageId === 't2:user'
      && item.targetFactId === 'work' && item.slot === 'quantity')!;
    expect(amount).toMatchObject({ targetKind: 'workload', taskFactId: 'task',
      componentPath: ['青チャート', '微積分'], operation: 'set_value' });
    expect(snapshot.candidates.some(item => item.sourceMessageId === 't3:assistant'
      && item.targetFactId === 'work' && item.slot === 'duration_per_unit')).toBe(true);
    expect(resolveReplyReferenceCandidateV5(snapshot, amount.key, input)).toEqual(amount);
    expect(resolveReplyReferenceCandidateV5(snapshot, 'missing', input)).toBeNull();
  });

  it('never turns a changed graph, stale question or old message into an authoritative anchor', () => {
    const graph = fixture();
    const current = { graph, messages, previousState: question(), inputStateRevision: 7 };
    const snapshot = createReplyReferenceSnapshotV5(current)!;
    const updated = structuredClone(graph);
    updated.revision += 1;
    expect(resolveReplyReferenceCandidateV5(snapshot, snapshot.candidates[0].key, {
      ...current, graph: updated,
    })).toBeNull();
    const stale = createReplyReferenceSnapshotV5({
      ...current, inputStateRevision: 8,
    })!;
    expect(stale.candidates.every(candidate => candidate.sourceMessageId !== 't3:assistant')).toBe(true);
    const removed = structuredClone(graph);
    removed.factLifecycles = [
      ...[...removed.tasks, ...removed.components].map(fact => ({
        factId: fact.id, status: 'active' as const,
        createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null,
      })),
      { factId: 'work', status: 'removed' as const, createdRevision: 3,
        terminalRevision: 4, supersededByFactId: null },
    ];
    expect(createReplyReferenceSnapshotV5({ ...current, graph: removed })?.candidates
      .some(item => item.targetFactId === 'work')).toBe(false);
  });

  it('fails closed for missing ancestors and a domain wider than its explicit bound', () => {
    const graph = fixture();
    graph.components[1].parentComponentId = 'absent';
    expect(createReplyReferenceSnapshotV5({ graph, messages, inputStateRevision: 7 })).toBeNull();
    const crowded = fixture();
    for (let i = 0; i < 20; i += 1) {
      crowded.workloads.push({ ...crowded.workloads[0], id: 'work-' + i });
    }
    expect(createReplyReferenceSnapshotV5({ graph: crowded, messages, inputStateRevision: 7 })).toBeNull();
  });

  it('copies only independently validated source offsets without parsing Japanese meaning', () => {
    const userText = '数学を📘で3分くらい';
    const start = userText.indexOf('3分');
    expect(extractReplyReferenceEvidenceV5(userText, { start, end: start + 2 })).toBe('3分');
    expect(extractReplyReferenceEvidenceV5(userText, { start: -1, end: 2 })).toBeNull();
    expect(extractReplyReferenceEvidenceV5(userText, { start: 4, end: 5 })).toBeNull();
    expect(extractReplyReferenceEvidenceV5(userText, { start: 0, end: 0 })).toBeNull();
  });
});
