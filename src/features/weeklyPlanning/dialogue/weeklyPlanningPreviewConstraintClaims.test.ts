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


it('limits claims to explicitly named tasks while keeping unscoped and mixed-task claims guarded', () => {
  const satisfied = { ...fact, taskId: 'english', taskLabel: '英語の長文', status: 'satisfied' as const };
  const unmet = { ...fact, taskId: 'english-short', taskLabel: '英語' };
  expect(claims('英語の長文は夜の候補です。', [satisfied, unmet])).toBe(false);
  expect(claims('英語は夜の候補です。', [satisfied, unmet])).toBe(true);
  expect(claims('英語の長文と英語は夜の候補です。', [satisfied, unmet])).toBe(true);
  expect(claims('英語の長文は夜の候補です。どちらも夜です。', [satisfied, unmet])).toBe(true);
  expect(claims('どちらも夜です。', [satisfied, unmet])).toBe(true);
  expect(claims('夜の読書の候補です。', [{ ...fact, taskLabel: '夜の読書' }])).toBe(false);
});
