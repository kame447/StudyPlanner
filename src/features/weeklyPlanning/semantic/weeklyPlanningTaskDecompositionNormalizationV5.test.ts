import { describe, expect, it } from 'vitest';
import {
  normalizeTaskDecompositionUncertaintiesV5,
} from './weeklyPlanningTaskDecompositionNormalizationV5';

function normalize(task: Record<string, unknown>, uncertainties: unknown[] = []) {
  return normalizeTaskDecompositionUncertaintiesV5(JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    tasks: [task],
    uncertainties,
  }));
}

describe('Stable V5 task decomposition normalization', () => {
  it('derives one work_breakdown uncertainty from an explicit needs_breakdown classification', () => {
    const result = normalize({
      localId: 'task-1',
      decompositionStatus: 'needs_breakdown',
      sourceText: '提出物がいくつか残っている',
    });
    const parsed = JSON.parse(result.rawResponse) as any;
    expect(parsed.uncertainties).toEqual([{
      localId: 'derived-work-breakdown-task-1',
      targetLocalId: 'task-1',
      field: 'work_breakdown',
      reason: 'task constituents are not yet identified for planning',
      sourceText: '提出物がいくつか残っている',
    }]);
    expect(result.repairs).toEqual([
      'task-decomposition-uncertainty-derived:0:task-1',
    ]);
  });

  it.each(['atomic', 'decomposed'])('does not derive uncertainty for %s', (status) => {
    const result = normalize({
      localId: 'task-1',
      decompositionStatus: status,
      sourceText: '英単語を100語やる',
    });
    const parsed = JSON.parse(result.rawResponse) as any;
    expect(parsed.uncertainties).toEqual([]);
    expect(result.repairs).toEqual([]);
  });

  it('does not duplicate an explicit matching uncertainty', () => {
    const result = normalize({
      localId: 'task-1',
      decompositionStatus: 'needs_breakdown',
      sourceText: '大きな準備が残っている',
    }, [{
      localId: 'uncertainty-1',
      targetLocalId: 'task-1',
      field: 'work_breakdown',
      reason: 'already represented',
      sourceText: '大きな準備が残っている',
    }]);
    const parsed = JSON.parse(result.rawResponse) as any;
    expect(parsed.uncertainties).toHaveLength(1);
    expect(result.repairs).toEqual([]);
  });
});
