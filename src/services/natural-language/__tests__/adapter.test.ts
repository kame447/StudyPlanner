import { describe, expect, it } from 'vitest';

import { runRulesPipelineThroughAdapter } from '../adapter';
import type { SuggestionInput } from '../../naturalLanguageRules';

function createInput(
  text: string,
  selectedDate = '2026-04-16',
): SuggestionInput {
  return {
    mode: 'add',
    text,
    selectedDate,
    plans: [],
    userId: 'user-1',
  };
}

describe('natural-language adapter', () => {
  it('time-only attach を legacy suggestion shape へ変換できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput('毎晩寝る前に15分だけ英単語の復習を入れて。時間は23時で。'),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.title).toBe('英単語の復習');
    expect(suggestions[0].parsedPlan.subject).toBe('英語');
    expect(suggestions[0].parsedPlan.startTime).toBe('23:00');
    expect(suggestions[0].parsedPlan.endTime).toBe('23:15');
    expect(suggestions[0].parsedPlan.repeat).toBe('daily');
    expect(suggestions[0].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'daily',
      startTime: '23:00',
      endTime: '23:15',
    });
    expect(suggestions[0].assumptions).toContain(
      'new pipeline adapter を経由して既存 planner 形式へ変換しました。',
    );
  });

  it('override 展開を legacy suggestion shape へ変換できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput('平日は毎朝7時から30分。ただし火曜と金曜は6時半から。'),
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'day-type',
      dayType: 'weekday',
      startTime: '07:00',
      endTime: '07:30',
    });

    const overrideWeekdays = suggestions
      .slice(1)
      .map((suggestion) => suggestion.parsedPlan.recurrenceRules[0]?.weekdays?.[0])
      .sort();

    expect(overrideWeekdays).toEqual(['fri', 'tue']);
  });

  it('relative ordering を legacy suggestion shape へ変換できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput('明日19時から数学を1時間。そのあと英単語を30分'),
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.date).toBe('2026-04-17');
    expect(suggestions[0].parsedPlan.startTime).toBe('19:00');
    expect(suggestions[0].parsedPlan.endTime).toBe('20:00');
    expect(suggestions[1].parsedPlan.date).toBe('2026-04-17');
    expect(suggestions[1].parsedPlan.startTime).toBe('20:00');
    expect(suggestions[1].parsedPlan.endTime).toBe('20:30');
  });

  it('enumeration 展開を legacy suggestion shape へ変換できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput(
        '来週のどこかで英語を3回。1回は長文、1回は単語、もう1回は文法',
      ),
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((suggestion) => suggestion.parsedPlan.title)).toEqual([
      '長文',
      '単語',
      '文法',
    ]);
    expect(suggestions.every((suggestion) => suggestion.parsedPlan.subject === '英語')).toBe(
      true,
    );
  });

  it('独立した複数イベントを legacy suggestion shape へ変換できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput('明日19時から数学を1時間。明後日20時から英語を30分'),
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].parsedPlan.date).toBe('2026-04-17');
    expect(suggestions[0].parsedPlan.subject).toBe('数学');
    expect(suggestions[1].parsedPlan.date).toBe('2026-04-18');
    expect(suggestions[1].parsedPlan.subject).toBe('英語');
  });
});
