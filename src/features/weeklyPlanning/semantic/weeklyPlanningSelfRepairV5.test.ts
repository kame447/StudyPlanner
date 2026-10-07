import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningSelfRepairNoticeV5, weeklyPlanningTurnRemovalsV5 } from './weeklyPlanningSelfRepairV5';

const source = (turnId: string, localId: string, text: string) => ({
  conversationId: 'conversation-1', turnId, semanticLocalId: localId, sourceText: text, origin: 'user' as const,
});

describe('Stable V5 self repair notice', () => {
  it('describes only the exact replaced workload and does not revive unrelated facts', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.revision = 2;
    graph.tasks = [
      { id: 'task-english', category: 'study', title: '英単語', source: source('turn-1', 'task', '英単語'), createdRevision: 1 },
      { id: 'task-math', category: 'study', title: '数学', source: source('turn-1', 'math', '数学'), createdRevision: 1 },
    ];
    graph.workloads = [
      {
        id: 'work-old', taskId: 'task-english', componentId: null, quantityRole: 'target', amount: 80,
        unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false,
        periodExpression: null, source: source('turn-1', 'old-work', '80ページ'), createdRevision: 1,
      },
      {
        id: 'work-new', taskId: 'task-english', componentId: null, quantityRole: 'target', amount: 80,
        unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false,
        periodExpression: null, source: source('turn-2', 'new-work', '80語だよ'), createdRevision: 2,
      },
      {
        id: 'work-math', taskId: 'task-math', componentId: null, quantityRole: 'target', amount: 30,
        unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false,
        periodExpression: null, source: source('turn-1', 'math-work', '数学30ページ'), createdRevision: 1,
      },
    ];
    graph.correctionIntents = [{
      id: 'correction-1',
      target: { kind: 'workload', publicId: 'work-old', factId: 'work-old', mention: '80ページ' },
      operation: 'replace', replacementFactId: 'work-new',
      source: source('turn-2', 'correction', '80語だよ'), createdRevision: 2,
    }];
    graph.factLifecycles = [
      { factId: 'task-english', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'task-math', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'work-old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'work-new' },
      { factId: 'work-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
      { factId: 'work-math', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'correction-1', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    ];

    const notice = createWeeklyPlanningSelfRepairNoticeV5({ graph, currentTurnId: 'turn-2' });

    expect(notice).toEqual({
      targetFactId: 'work-old',
      replacementFactId: 'work-new',
      // Typed correction data (interaction renderer context) next to the legacy sentence.
      taskLabel: '英単語',
      before: '80ページ',
      after: '80語',
      message: '英単語は80ページではなく80語ですね。修正しました。',
    });
    expect(notice?.message).not.toContain('数学30ページ');
  });

  it('returns null when there is no correction created by the current turn', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    expect(createWeeklyPlanningSelfRepairNoticeV5({ graph, currentTurnId: 'turn-2' })).toBeNull();
  });

  it('does not claim a replacement when the correction only removes a fact', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.correctionIntents = [{
      id: 'correction-remove',
      target: { kind: 'workload', publicId: 'work-old', factId: 'work-old', mention: '80ページ' },
      operation: 'remove', replacementFactId: null,
      source: source('turn-2', 'correction', 'それはなし'), createdRevision: 2,
    }];
    expect(createWeeklyPlanningSelfRepairNoticeV5({ graph, currentTurnId: 'turn-2' })).toBeNull();
  });
});

describe('Stable V5 removals of the current turn (Issue #488)', () => {
  it('lists only what this turn removed, as plan data for the renderer', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.revision = 3;
    graph.tasks = [
      { id: 'task-english', category: 'study', title: '英語', source: source('turn-1', 'english', '英語'), createdRevision: 1 },
      { id: 'task-math', category: 'study', title: '数学', source: source('turn-1', 'math', '数学'), createdRevision: 1 },
    ];
    graph.correctionIntents = [
      {
        id: 'remove-english', target: { kind: 'task', publicId: 'task-english', factId: 'task-english', mention: '英語' },
        operation: 'remove', replacementFactId: null, source: source('turn-3', 'remove', '英語はやめる'), createdRevision: 3,
      },
      {
        id: 'remove-old', target: { kind: 'task', publicId: 'task-math', factId: 'task-math', mention: '数学' },
        operation: 'remove', replacementFactId: null, source: source('turn-2', 'old', '数学はなし'), createdRevision: 2,
      },
    ];
    expect(weeklyPlanningTurnRemovalsV5({ graph, currentTurnId: 'turn-3' }))
      .toEqual([{ kind: 'task', taskLabel: '英語', label: '英語' }]);
    expect(weeklyPlanningTurnRemovalsV5({ graph, currentTurnId: 'turn-4' })).toEqual([]);
  });
});
