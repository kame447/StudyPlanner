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
  it.each(['task', 'component'] as const)('does not overwrite an owner-visible bookshelf ID on the %s side', (side) => {
    const rawResponse = response({ taskId: side === 'task' ? 'bookshelf-B' : 'task-target',
      componentId: side === 'component' ? 'bookshelf-B' : 'component-target' });
    expect(normalizePendingQuestionEntityBindingsV5({ rawResponse,
      publicStateSummary: { ...publicStateSummary, registeredMaterials: [{ materialId: 'bookshelf-B' }] },
    })).toEqual({ rawResponse, repairs: [] });
  });

  it('keeps an exact canonical anchor effective even if the external registry uses the same token', () => {
    const rawResponse = response({ taskId: 'copy-corrupted-parent', componentId: 'component-target' });
    const result = normalizePendingQuestionEntityBindingsV5({ rawResponse,
      publicStateSummary: { ...publicStateSummary, registeredMaterials: [{ materialId: 'component-target' }] },
    });
    expect(result.repairs).toEqual(['pending-component-parent-task-id-restored:task-local']);
    expect(JSON.parse(result.rawResponse).tasks[0]).toMatchObject({ existingPublicId: 'task-target',
      study: { components: [{ existingPublicId: 'component-target' }] } });
  });

  it('retains the existing one-anchor repair for a component token absent from every declared namespace', () => {
    const rawResponse = response({ taskId: 'task-target', componentId: 'copy-corrupted-component' });
    const result = normalizePendingQuestionEntityBindingsV5({ rawResponse,
      publicStateSummary: { ...publicStateSummary, registeredMaterials: [{ materialId: 'bookshelf-B' }] },
    });
    expect(result.repairs).toEqual(['pending-component-id-restored:component-local']);
    expect(JSON.parse(result.rawResponse).tasks[0].study.components[0].existingPublicId).toBe('component-target');
  });

});
