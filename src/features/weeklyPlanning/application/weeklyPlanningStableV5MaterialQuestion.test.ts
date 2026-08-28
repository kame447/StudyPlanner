import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  renderStableV5RuntimeQuestion,
  stableV5MissingSchedulableWorkQuestion,
} from './weeklyPlanningStableV5RuntimeQuestions';

function graph(): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...empty,
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '数学IA・IIBC 基礎問題精講',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'task-1',
        sourceText: '基礎問題精講を一周したい',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    components: [{
      id: 'component-material',
      taskId: 'task-1',
      parentComponentId: null,
      role: 'material',
      label: '基礎問題精講',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'component-material',
        sourceText: '基礎問題精講',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    uncertainties: [{
      id: 'uncertainty-1',
      targetFactId: 'task-1',
      field: 'work_breakdown',
      reason: '教材の量が未確定',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'uncertainty-1',
        sourceText: '基礎問題精講を一周したい',
        origin: 'user',
      },
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'component-material',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'uncertainty-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function expectConcreteMaterialQuestion(message: string): void {
  expect(message).toContain('全何問');
  expect(message).toContain('全何ページ');
  expect(message).toContain('全何語');
  expect(message).toContain('全何章');
  expect(message).toContain('今どこまで');
  expect(message).not.toContain('ざっくり');
  expect(message).not.toContain('100%');
  expect(message).not.toContain('何時間');
}

describe('Stable V5 material questions', () => {
  it('asks for a concrete count when work breakdown is unknown', () => {
    const message = renderStableV5RuntimeQuestion(
      graph(),
      {
        domain: 'semantic_uncertainty',
        code: 'semantic_uncertainty',
        factId: 'uncertainty-1',
        details: {},
      },
    );

    expect(message).toContain('基礎問題精講');
    expectConcreteMaterialQuestion(message);
  });

  it('uses the same concrete fallback when schedulable work has no total scope', () => {
    const message = stableV5MissingSchedulableWorkQuestion(graph()).message;

    expect(message).toContain('基礎問題精講');
    expectConcreteMaterialQuestion(message);
  });
});
