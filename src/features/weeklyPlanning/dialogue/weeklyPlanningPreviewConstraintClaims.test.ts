import { describe, expect, it } from 'vitest';
import { claimsUnverifiedWeeklyPlanningPreviewConstraints as claims } from './weeklyPlanningPreviewConstraintClaims';
import type { WeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';
import { weeklyPlanningPreviewConstraintDisclosureText as disclosure } from './weeklyPlanningPreviewOmissionDisclosure';

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

  it('discloses failed and unverified preferences by task, without duplicating the same task condition', () => {
    const output = disclosure([fact, { ...fact, sourceFactId: 'another-night' }, {
      ...fact, taskId: 'book', taskLabel: '本', status: 'not_evaluated',
    }, { ...fact, taskLabel: '満たした作業', status: 'satisfied' }]);
    expect(output.split('\n')).toHaveLength(2);
    expect(output).toContain('研究');
    expect(output).toContain('本');
    expect(output).not.toContain('満たした作業');
    expect(disclosure(undefined)).toBe('');
  });
});
