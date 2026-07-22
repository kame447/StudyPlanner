import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import { deriveGenericSchedulerDialoguePolicy } from './weeklyPlanningGenericSchedulerDialoguePolicy';

function graph() {
  const graph = createEmptyWeeklyPlanningFactGraphV2();
  graph.revision = 2;
  graph.tasks = [{
    id: 'task-study',
    category: 'study',
    title: '英単語',
    source: {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      semanticLocalId: 'task-study',
      sourceText: '英単語',
      origin: 'user',
    },
    createdRevision: 1,
  }];
  return graph;
}

describe('task date rule dialogue', () => {
  it('asks which instruction wins when the same date is allowed and excluded', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: {
        status: 'needs_resolution',
        input: null,
        issues: [{
          domain: 'task_date_rule',
          code: 'conflicting_task_date_rule',
          blocking: true,
          factId: 'date-rule-exclude',
          details: { taskId: 'task-study', date: '2026-07-25' },
        }],
      },
    });

    expect(policy.nextQuestion).toEqual({
      issueCode: 'task_date_rule:conflicting_task_date_rule',
      targetFactId: 'date-rule-exclude',
      text: '英単語を2026-07-25に行う指定と、行わない指定が両方あります。どちらを採用しますか？',
    });
  });

  it('asks for a concrete date instead of parsing a custom phrase later', () => {
    const policy = deriveGenericSchedulerDialoguePolicy({
      graph: graph(),
      compilation: {
        status: 'needs_resolution',
        input: null,
        issues: [{
          domain: 'task_date_rule',
          code: 'unsupported_task_date_expression',
          blocking: true,
          factId: 'date-rule-custom',
          details: { taskId: 'task-study', expression: 'custom:試験前日' },
        }],
      },
    });

    expect(policy.nextQuestion?.text)
      .toBe('英単語を行う日、または行わない日を具体的な日付で教えてください。');
  });
});
