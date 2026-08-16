import { describe, expect, it } from 'vitest';
import {
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  requiredLabelsForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';

const planningInformation = {
  planningWindow: null,
  tasks: [
    {
      id: 'task-math',
      title: '数学のワーク',
      category: 'study',
      createdRevision: 1,
    },
    {
      id: 'task-vocabulary',
      title: '英単語',
      category: 'study',
      createdRevision: 1,
    },
  ],
  studyContexts: [],
  components: [],
  workloads: [
    {
      id: 'workload-math',
      taskId: 'task-math',
      componentId: null,
      quantityRole: 'completed',
      amount: 30,
      unitCode: 'page',
      unitLabel: 'ページ',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      createdRevision: 1,
    },
    {
      id: 'workload-math-target',
      taskId: 'task-math',
      componentId: null,
      quantityRole: 'target',
      amount: 50,
      unitCode: 'page',
      unitLabel: 'ページ',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      createdRevision: 1,
    },
    {
      id: 'workload-vocabulary',
      taskId: 'task-vocabulary',
      componentId: null,
      quantityRole: 'target',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      createdRevision: 1,
    },
  ],
  effortEstimates: [],
  temporalConstraints: [],
  recurrence: [],
  relations: [],
};

describe('Stable V5 dialogue context', () => {
  it('projects an application-owned completed-workload total-duration intent', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'workload-math',
    });
    expect(questionTarget).toEqual({
      collection: 'workloads',
      fact: expect.objectContaining({
        id: 'workload-math',
        amount: 30,
        unitCode: 'page',
        unitLabel: 'ページ',
      }),
    });
    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_effort_estimate',
      questionTarget,
      effortMeasurement: 'total_duration',
    })).toEqual({
      kind: 'effort_measurement',
      measurement: 'total_duration',
      quantityRole: 'completed',
      targetFactId: 'workload-math',
      amount: 30,
      unitCode: null,
      unitLabel: 'ページ',
    });
  });

  it('projects an application-owned target-page duration-per-unit intent', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'workload-math-target',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_effort_estimate',
      questionTarget,
      effortMeasurement: 'duration_per_unit',
    })).toEqual({
      kind: 'effort_measurement',
      measurement: 'duration_per_unit',
      quantityRole: 'target',
      targetFactId: 'workload-math-target',
      amount: 50,
      unitCode: 'page',
      unitLabel: 'ページ',
    });
  });

  it('does not infer effort measurement from a vocabulary unit alone', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'workload-vocabulary',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_effort_estimate',
      questionTarget,
    })).toBeNull();
  });

  it('projects one-session intent when the application has explicitly established that measurement', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'workload-vocabulary',
    });

    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_effort_estimate',
      questionTarget,
      effortMeasurement: 'session_duration',
    })).toEqual({
      kind: 'effort_measurement',
      measurement: 'session_duration',
      quantityRole: 'target',
      targetFactId: 'workload-vocabulary',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
    });
  });

  it('does not invent a label when the selected fact has no readable owner', () => {
    expect(requiredLabelsForStableV5Dialogue({
      planningInformation,
      targetFactId: 'missing-fact',
      includePreviewPromotionControl: false,
    })).toEqual([]);
  });

  it('preserves the preview promotion control label from typed preview state', () => {
    expect(requiredLabelsForStableV5Dialogue({
      planningInformation,
      targetFactId: null,
      includePreviewPromotionControl: true,
    })).toEqual(['この内容で仮予定にする']);
  });
});
