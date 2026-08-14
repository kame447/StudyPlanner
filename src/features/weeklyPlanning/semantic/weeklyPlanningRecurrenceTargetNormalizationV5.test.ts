import { describe, expect, it } from 'vitest';
import { normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5 } from './weeklyPlanningRecurrenceTargetNormalizationV5';

function response(targetLocalId: string): string {
  return JSON.stringify({
    tasks: [{
      localId: 'task-local',
      workloads: [{ localId: 'task-workload' }],
      study: {
        components: [{
          localId: 'component-local',
          workloads: [{ localId: 'component-workload' }],
        }],
      },
      recurrence: [{ localId: 'recurrence-local', targetLocalId }],
    }],
  });
}

describe('recurrence workload target normalization', () => {
  it('moves an exact component workload target to its containing component', () => {
    const result = normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5(
      response('component-workload'),
    );

    expect(JSON.parse(result.rawResponse).tasks[0].recurrence[0].targetLocalId)
      .toBe('component-local');
    expect(result.repairs).toEqual([
      'recurrence-workload-target-normalized:task-local:recurrence-local:component-workload:component-local',
    ]);
  });

  it('moves an exact task workload target to its containing task', () => {
    const result = normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5(
      response('task-workload'),
    );

    expect(JSON.parse(result.rawResponse).tasks[0].recurrence[0].targetLocalId)
      .toBe('task-local');
  });

  it('leaves a non-workload target unchanged', () => {
    const rawResponse = response('component-local');
    expect(normalizeWeeklyPlanningRecurrenceWorkloadTargetsV5(rawResponse))
      .toEqual({ rawResponse, repairs: [] });
  });
});
