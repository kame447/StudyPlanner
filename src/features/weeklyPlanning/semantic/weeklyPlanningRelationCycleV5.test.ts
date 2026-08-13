import { describe, expect, it } from 'vitest';
import type { TaskRelationFact } from './weeklyPlanningFactGraph';
import { detectWeeklyPlanningRelationCycleV5 } from './weeklyPlanningRelationCycleV5';

const source = {
  conversationId: 'conversation-relation-cycle',
  turnId: 'turn-1',
  semanticLocalId: 'relation',
  sourceText: 'relation',
  origin: 'user' as const,
};

function relation(
  id: string,
  kind: TaskRelationFact['kind'],
  fromTaskId: string,
  toTaskId: string,
): TaskRelationFact {
  return {
    id,
    kind,
    fromTaskId,
    toTaskId,
    source,
    createdRevision: 1,
  };
}

describe('Stable V5 relation-cycle validation', () => {
  it('detects a direct before cycle', () => {
    expect(detectWeeklyPlanningRelationCycleV5([
      relation('r1', 'before', 'a', 'b'),
      relation('r2', 'before', 'b', 'a'),
    ])).toEqual({
      relationFactIds: ['r1', 'r2'],
      taskIds: ['a', 'b'],
    });
  });

  it('normalizes depends_on direction before detecting a mixed cycle', () => {
    expect(detectWeeklyPlanningRelationCycleV5([
      relation('r1', 'depends_on', 'b', 'a'),
      relation('r2', 'before', 'b', 'a'),
    ])).toEqual({
      relationFactIds: ['r1', 'r2'],
      taskIds: ['a', 'b'],
    });
  });

  it('treats contradictory priority order as a cycle because it affects scheduling rank', () => {
    expect(detectWeeklyPlanningRelationCycleV5([
      relation('r1', 'priority_over', 'a', 'b'),
      relation('r2', 'priority_over', 'b', 'a'),
    ])).not.toBeNull();
  });

  it('returns null for a valid DAG', () => {
    expect(detectWeeklyPlanningRelationCycleV5([
      relation('r1', 'before', 'a', 'b'),
      relation('r2', 'depends_on', 'c', 'b'),
      relation('r3', 'priority_over', 'a', 'c'),
    ])).toBeNull();
  });
});
