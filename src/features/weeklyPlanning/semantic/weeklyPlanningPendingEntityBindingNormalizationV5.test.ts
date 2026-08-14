import { describe, expect, it } from 'vitest';
import { normalizePendingQuestionEntityBindingsV5 } from './weeklyPlanningPendingEntityBindingNormalizationV5';

const publicStateSummary = {
  pendingQuestion: {
    questionCode: 'missing_schedulable_work',
    targetFactId: 'component-target',
  },
  tasks: [
    { publicId: 'task-target', category: 'study', title: 'Target task' },
    { publicId: 'task-other', category: 'study', title: 'Other task' },
  ],
  components: [
    {
      publicId: 'component-target',
      taskPublicId: 'task-target',
      role: 'subject',
      label: 'Target component',
    },
    {
      publicId: 'component-other',
      taskPublicId: 'task-other',
      role: 'subject',
      label: 'Other component',
    },
  ],
};

function response(params: { taskId: string; componentId: string }): string {
  return JSON.stringify({
    tasks: [{
      localId: 'task-local',
      existingPublicId: params.taskId,
      study: {
        components: [{
          localId: 'component-local',
          existingPublicId: params.componentId,
        }],
      },
    }],
  });
}

describe('pending entity binding normalization', () => {
  it('restores an unknown parent task ID from one exact pending component anchor', () => {
    const result = normalizePendingQuestionEntityBindingsV5({
      rawResponse: response({
        taskId: 'task-target-with-copy-corruption',
        componentId: 'component-target',
      }),
      publicStateSummary,
    });

    expect(JSON.parse(result.rawResponse).tasks[0]).toMatchObject({
      existingPublicId: 'task-target',
      study: { components: [{ existingPublicId: 'component-target' }] },
    });
    expect(result.repairs).toEqual([
      'pending-component-parent-task-id-restored:task-local',
    ]);
  });

  it('does not guess when both IDs are unknown', () => {
    const rawResponse = response({ taskId: 'unknown-task', componentId: 'unknown-component' });

    expect(normalizePendingQuestionEntityBindingsV5({
      rawResponse,
      publicStateSummary,
    })).toEqual({ rawResponse, repairs: [] });
  });

  it('does not overwrite a different valid public binding', () => {
    const rawResponse = response({ taskId: 'task-other', componentId: 'component-other' });

    expect(normalizePendingQuestionEntityBindingsV5({
      rawResponse,
      publicStateSummary,
    })).toEqual({ rawResponse, repairs: [] });
  });
});
