import { describe, expect, it } from 'vitest';
import { claimsUnverifiedWeeklyPlanningPreviewConstraints as claims } from './weeklyPlanningPreviewConstraintClaims';
import type { WeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';

const fact: WeeklyPlanningPreviewConstraintSatisfaction = {
  sourceFactId: 'night', taskId: 'research', taskLabel: '研究', kind: 'preferred_window', status: 'not_satisfied',
};

describe('renderer claims about unverified or unmet preview constraints', () => {
  it.each(['どちらも夜の候補を3件用意しました。', 'ご希望どおり候補ができました。', '1時間ずつに分けました。', '20:00以降です。'])('rejects %s', text => {
    expect(claims(text, [fact])).toBe(true);
    expect(claims(text, [{ ...fact, status: 'not_evaluated' }])).toBe(true);
  });
  it('allows a neutral preview reply and does not alter legacy replies without evidence', () => {
    expect(claims('候補が3件できました。「この内容で仮予定にする」を押してください。', [fact])).toBe(false);
    expect(claims('夜に分けました。', undefined)).toBe(false);
    expect(claims('夜に分けました。', [{ ...fact, status: 'satisfied' }])).toBe(false);
  });
});
