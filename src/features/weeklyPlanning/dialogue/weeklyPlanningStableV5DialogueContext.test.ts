import { describe, expect, it } from 'vitest';
import {
  isStableV5QuestionLikeText,
  requiredLabelsForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';

const planningInformation = {
  tasks: [{ id: 'task-1', title: '夏休みの課題' }],
  components: [
    { id: 'component-math', taskId: 'task-1', label: '数学のワーク' },
  ],
  workloads: [
    { id: 'workload-math', taskId: 'task-1', componentId: 'component-math' },
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

  it('still identifies question-like fallback text until action-kind inference is migrated separately', () => {
    expect(isStableV5QuestionLikeText(
      '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
    )).toBe(true);
    expect(isStableV5QuestionLikeText('2件の仮予定候補を作りました。')).toBe(false);
  });
});
