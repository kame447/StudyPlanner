import { describe, expect, it } from 'vitest';
import {
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  requiredLabelsForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';

const planningInformation = {
  tasks: [{ id: 'task-1', title: '夏休みの課題' }],
  components: [
    { id: 'component-math', taskId: 'task-1', label: '数学のワーク' },
  ],
  workloads: [
    {
      id: 'workload-math',
      taskId: 'task-1',
      componentId: 'component-math',
      quantityRole: 'completed',
      amount: 30,
      unitCode: 'page',
      unitLabel: 'ページ',
    },
  ],
  uncertainties: [
    { id: 'uncertainty-math', targetFactId: 'component-math', field: 'workload_amount' },
  ],
};

describe('Stable V5 dialogue context', () => {
  it('resolves the application-selected uncertainty target from typed facts', () => {
    expect(requiredLabelsForStableV5Dialogue({
      planningInformation,
      targetFactId: 'uncertainty-math',
      includePreviewPromotionControl: false,
    })).toEqual(['数学のワーク']);
  });

  it('resolves a workload target to its owning component label', () => {
    expect(requiredLabelsForStableV5Dialogue({
      planningInformation,
      targetFactId: 'workload-math',
      includePreviewPromotionControl: false,
    })).toEqual(['数学のワーク']);
  });

  it('projects completed workload effort evidence as total-duration intent', () => {
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation,
      targetFactId: 'workload-math',
    });

    expect(questionTarget).toEqual({
      collection: 'workloads',
      fact: expect.objectContaining({
        id: 'workload-math',
        quantityRole: 'completed',
        amount: 30,
        unitCode: 'page',
        unitLabel: 'ページ',
      }),
    });
    expect(questionIntentForStableV5Dialogue({
      questionCode: 'missing_effort_estimate',
      questionTarget,
    })).toEqual({
      kind: 'effort_evidence',
      measurement: 'total_duration',
      evidenceRole: 'completed',
      targetFactId: 'workload-math',
      amount: 30,
      unitCode: 'page',
      unitLabel: 'ページ',
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
