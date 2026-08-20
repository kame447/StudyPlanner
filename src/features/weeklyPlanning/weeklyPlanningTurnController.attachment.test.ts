import { describe, expect, it } from 'vitest';
import {
  buildWeeklyPlanningExecutionText,
  MAX_WEEKLY_PLANNING_SUPPLEMENTAL_CONTEXT_LENGTH,
} from './weeklyPlanningTurnController';

describe('weekly planning attachment context', () => {
  it('keeps plain user text unchanged when there is no attachment context', () => {
    expect(buildWeeklyPlanningExecutionText('来週の計画を作って')).toBe('来週の計画を作って');
  });

  it('adds extracted image facts only to the execution text', () => {
    const executionText = buildWeeklyPlanningExecutionText(
      'この画像をもとに計画して',
      '数学テスト: 8月28日\n範囲: p.30〜80',
    );

    expect(executionText).toContain('この画像をもとに計画して');
    expect(executionText).toContain('[添付画像から読み取った参考情報]');
    expect(executionText).toContain('数学テスト: 8月28日');
    expect(executionText).toContain('範囲: p.30〜80');
  });

  it('keeps the supplemental-context budget aligned with the attachment extractor', () => {
    expect(MAX_WEEKLY_PLANNING_SUPPLEMENTAL_CONTEXT_LENGTH).toBe(1800);
  });
});
