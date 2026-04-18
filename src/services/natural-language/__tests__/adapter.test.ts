import { describe, expect, it } from 'vitest';

import {
  adaptPipelineSuggestionToLegacySuggestion,
  adaptPipelineSuggestionToLegacyEditSuggestion,
  runRulesPipelineEditThroughAdapter,
  runRulesPipelineThroughAdapter,
} from '../adapter';
import type { SuggestionInput } from '../../naturalLanguageRules';
import type { Plan } from '../../../types/domain';
import type { Suggestion as PipelineSuggestion } from '../shared/types';

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

function createEditInput(
  text: string,
  selectedDate = '2026-04-16',
): SuggestionInput {
  const recurringPlan: Plan = {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '英語',
    subject: '英語',
    date: selectedDate,
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'weekly',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [
      {
        id: 'rule-1',
        kind: 'weekday',
        startDate: selectedDate,
        until: null,
        dates: [],
        weekdays: ['mon', 'wed', 'fri'],
        dayType: null,
        startTime: '19:00',
        endTime: '20:00',
        title: '英語',
        subject: '英語',
        type: 'study',
        memo: '',
        isOverride: false,
      },
    ],
    type: 'study',
    memo: '',
    createdAt: `${selectedDate}T00:00:00.000Z`,
    updatedAt: `${selectedDate}T00:00:00.000Z`,
  };

  return {
    mode: 'edit',
    text,
    selectedDate,
    plans: [recurringPlan],
    userId: 'user-1',
  };
}

function createRecurringEditPipelineSuggestion(
  overrides: Partial<PipelineSuggestion['parsedPlan']> = {},
): PipelineSuggestion {
  return {
    rawText: '英語を変更して',
    parsedPlan: {
      rawText: '英語を変更して',
      title: '英語',
      subject: '英語',
      startTime: '19:00',
      endTime: '20:00',
      ...overrides,
    },
    assumptions: [],
    unresolvedFields: [],
    confidence: 0.9,
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
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'thu'],
      startTime: '07:00',
      endTime: '07:30',
    });

    const overrideWeekdays = suggestions
      .slice(1)
      .map((suggestion) => suggestion.parsedPlan.recurrenceRules[0]?.weekdays?.[0])
      .sort();

    expect(overrideWeekdays).toEqual(['fri', 'tue']);
  });

  it('weekday 例外を legacy recurrence へ分解し、base duration を維持できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput('平日は毎朝7時から30分。ただし火曜と金曜は6時半から。'),
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'thu'],
      startTime: '07:00',
      endTime: '07:30',
    });
    expect(suggestions[1].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['tue'],
      startTime: '06:30',
      endTime: '07:00',
    });
    expect(suggestions[2].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['fri'],
      startTime: '06:30',
      endTime: '07:00',
    });
  });

  it('until を rawText から補完して legacy recurrence へ変換できる', () => {
    const suggestions = runRulesPipelineThroughAdapter(
      createInput('毎晩23時から15分、来週末まで', '2026-04-16'),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.repeat).toBe('daily');
    expect(suggestions[0].parsedPlan.repeatUntil).toBe('2026-04-26');
    expect(suggestions[0].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'daily',
      until: '2026-04-26',
      startTime: '23:00',
      endTime: '23:15',
    });
  });

  it('複数曜日 recurring を 1 本の legacy weekday rule に変換できる', () => {
    const pipelineSuggestion: PipelineSuggestion = {
      rawText: '毎週月水金の英語',
      parsedPlan: {
        rawText: '毎週月水金の英語',
        title: '英語',
        subject: '英語',
        recurrenceRules: [
          {
            kind: 'weekday',
            weekdays: ['mon', 'wed', 'fri'],
          },
        ],
      },
      assumptions: [],
      unresolvedFields: [],
      confidence: 0.9,
    };

    const suggestion = adaptPipelineSuggestionToLegacySuggestion(
      pipelineSuggestion,
      createInput('毎週月水金の英語', '2026-04-16'),
    );

    expect(suggestion.parsedPlan.repeat).toBe('weekly');
    expect(suggestion.parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'fri'],
    });
  });

  it('recurrence legacy fidelity として startDate / until / isOverride / excluded weekday をできるだけ保持できる', () => {
    const suggestion = adaptPipelineSuggestionToLegacySuggestion(
      {
        rawText: '水曜だけ22時、他の日は毎日20時から21時',
        parsedPlan: {
          rawText: '水曜だけ22時、他の日は毎日20時から21時',
          title: '勉強予定',
          subject: '勉強',
          startTime: '20:00',
          endTime: '21:00',
          recurrenceRules: [
            {
              id: 'base-rule',
              kind: 'daily',
              startDate: '2026-04-18',
              until: '2026-04-30',
              excludedWeekdays: ['wed'],
              startTime: '20:00',
              endTime: '21:00',
            },
            {
              id: 'override-rule',
              kind: 'weekday',
              startDate: '2026-04-18',
              until: '2026-04-30',
              weekdays: ['wed'],
              startTime: '22:00',
              endTime: '23:00',
              isOverride: true,
            },
          ],
        },
        assumptions: [],
        unresolvedFields: [],
        confidence: 0.9,
      },
      createInput('水曜だけ22時、他の日は毎日20時から21時', '2026-04-18'),
    );

    expect(suggestion.parsedPlan.recurrenceRules).toHaveLength(2);
    expect(suggestion.parsedPlan.recurrenceRules[0]).toMatchObject({
      startDate: '2026-04-18',
      until: '2026-04-30',
    });
    expect(suggestion.parsedPlan.recurrenceRules[1]).toMatchObject({
      startDate: '2026-04-18',
      until: '2026-04-30',
      isOverride: true,
      weekdays: ['wed'],
      startTime: '22:00',
      endTime: '23:00',
    });
    expect(
      suggestion.parsedPlan.recurrenceRules.some(
        (rule) =>
          rule.kind === 'weekday' &&
          rule.weekdays.includes('sat') &&
          rule.weekdays.includes('sun') &&
          !rule.isOverride,
      ),
    ).toBe(true);
    expect(suggestion.assumptions).toContain(
      'pipeline recurrence の毎日例外を曜日列に展開して legacy 形式へ変換しました。',
    );
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

  it('pipeline title が無い場合でも noisy contentText をそのまま legacy title にしない', () => {
    const suggestion = adaptPipelineSuggestionToLegacySuggestion(
      {
        rawText: '授業後に情報の課題をやる',
        parsedPlan: {
          rawText: '授業後に情報の課題をやる',
          contentText: '授業後に情報の課題をやる',
          subject: '情報',
        },
        assumptions: [],
        unresolvedFields: [],
        confidence: 0.9,
      },
      createInput('授業後に情報の課題をやる'),
    );

    expect(suggestion.parsedPlan.title).toBe('情報の課題');
  });

  it('multi-event input でも local subject/type 推定を優先し、全文 fallback で他イベントへ汚染しない', () => {
    const suggestion = adaptPipelineSuggestionToLegacySuggestion(
      {
        rawText: '15:00から16:00まで情報の課題',
        parsedPlan: {
          rawText: '15:00から16:00まで情報の課題',
          contentText: '情報の課題',
          startTime: '15:00',
          endTime: '16:00',
        },
        assumptions: [],
        unresolvedFields: [],
        confidence: 0.9,
      },
      createInput(
        '土日は朝9時から2時間、共通テストの過去問演習。15時から16時まで情報の課題。',
        '2026-04-18',
      ),
    );

    expect(suggestion.parsedPlan.subject).toBe('情報');
    expect(suggestion.parsedPlan.type).toBe('study');
  });

  it('suggestion-local subject inference で specific title と broad subject を分離し、multi-event 汚染を避けられる', () => {
    const suggestion = adaptPipelineSuggestionToLegacySuggestion(
      {
        rawText: '22:00からTOEICの勉強',
        parsedPlan: {
          rawText: '22:00からTOEICの勉強',
          title: 'TOEICの勉強',
          contentText: 'TOEICの勉強',
          startTime: '22:00',
          endTime: '23:00',
        },
        assumptions: [],
        unresolvedFields: [],
        confidence: 0.9,
      },
      createInput(
        '19:00から黄色チャート。20:00から良問の風。22:00からTOEICの勉強。',
        '2026-04-18',
      ),
    );

    expect(suggestion.parsedPlan.title).toBe('TOEICの勉強');
    expect(suggestion.parsedPlan.subject).toBe('英語');
  });

  it('recurring な既存予定の edit では recurrence を維持したまま title/time だけ変更できる', () => {
    const suggestions = runRulesPipelineEditThroughAdapter(
      createEditInput('英語を20時開始にして'),
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].matchedPlanId).toBe('plan-1');
    expect(suggestions[0].parsedPlan.startTime).toBe('20:00');
    expect(suggestions[0].parsedPlan.endTime).toBe('21:00');
    expect(suggestions[0].parsedPlan.repeat).toBe('weekly');
    expect(suggestions[0].parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'fri'],
    });
  });

  it('recurring な既存予定に対して title だけ変えても baseline recurrence を維持する', () => {
    const suggestion = adaptPipelineSuggestionToLegacyEditSuggestion(
      createRecurringEditPipelineSuggestion({
        title: '英語長文',
        subject: '英語',
      }),
      createEditInput('英語を英語長文に変更して'),
    );

    expect(suggestion.matchedPlanId).toBe('plan-1');
    expect(suggestion.parsedPlan.title).toBe('英語長文');
    expect(suggestion.parsedPlan.repeat).toBe('weekly');
    expect(suggestion.parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'fri'],
      title: '英語長文',
      startTime: '19:00',
      endTime: '20:00',
    });
  });

  it('recurring な既存予定に対して start/end time だけ変えても baseline recurrence を維持する', () => {
    const suggestion = adaptPipelineSuggestionToLegacyEditSuggestion(
      createRecurringEditPipelineSuggestion({
        startTime: '20:00',
        endTime: '21:00',
      }),
      createEditInput('英語を20時開始に変更して'),
    );

    expect(suggestion.parsedPlan.startTime).toBe('20:00');
    expect(suggestion.parsedPlan.endTime).toBe('21:00');
    expect(suggestion.parsedPlan.repeat).toBe('weekly');
    expect(suggestion.parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'fri'],
      startTime: '20:00',
      endTime: '21:00',
    });
  });

  it('recurring な既存予定に対して subject だけ変えても baseline recurrence を維持する', () => {
    const suggestion = adaptPipelineSuggestionToLegacyEditSuggestion(
      createRecurringEditPipelineSuggestion({
        title: '化学',
        subject: '化学',
      }),
      createEditInput('英語を化学に変更して'),
    );

    expect(suggestion.parsedPlan.subject).toBe('化学');
    expect(suggestion.parsedPlan.repeat).toBe('weekly');
    expect(suggestion.parsedPlan.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed', 'fri'],
      subject: '化学',
      title: '化学',
    });
  });

  it('recurrence 情報が入力に無い edit では baseline recurrence を維持する', () => {
    const suggestion = adaptPipelineSuggestionToLegacyEditSuggestion(
      createRecurringEditPipelineSuggestion({
        title: '英語',
        subject: '英語',
        startTime: '19:00',
        endTime: '20:00',
      }),
      createEditInput('英語のままメモだけ見直して'),
    );

    expect(suggestion.parsedPlan.repeat).toBe('weekly');
    expect(suggestion.parsedPlan.recurrenceRules).toHaveLength(1);
    expect(suggestion.assumptions).toContain(
      'recurrence 情報の変更が無かったため、既存の recurring baseline を維持したまま差分だけ適用しました。',
    );
  });

  it('recurrence fidelity として startDate / until / override を representative date と矛盾なく保持できる', () => {
    const suggestion = adaptPipelineSuggestionToLegacySuggestion(
      {
        rawText: '火曜だけ6時半から30分、金曜だけ6時半から30分、他は4月中の平日7時から30分',
        parsedPlan: {
          rawText: '火曜だけ6時半から30分、金曜だけ6時半から30分、他は4月中の平日7時から30分',
          title: '英語',
          subject: '英語',
          date: '2026-04-18',
          recurrenceRules: [
            {
              id: 'base-rule',
              kind: 'day-type',
              startDate: '2026-04-18',
              until: '2026-04-30',
              dayType: 'weekday',
              excludedWeekdays: ['tue', 'fri'],
              startTime: '07:00',
              endTime: '07:30',
            },
            {
              id: 'override-tue',
              kind: 'weekday',
              startDate: '2026-04-18',
              until: '2026-04-30',
              weekdays: ['tue'],
              startTime: '06:30',
              endTime: '07:00',
              isOverride: true,
            },
            {
              id: 'override-fri',
              kind: 'weekday',
              startDate: '2026-04-18',
              until: '2026-04-30',
              weekdays: ['fri'],
              startTime: '06:30',
              endTime: '07:00',
              isOverride: true,
            },
          ],
        },
        assumptions: [],
        unresolvedFields: [],
        confidence: 0.9,
      },
      createInput(
        '火曜だけ6時半から30分、金曜だけ6時半から30分、他は4月中の平日7時から30分',
        '2026-04-18',
      ),
    );

    expect(suggestion.parsedPlan.date).toBe('2026-04-20');
    expect(suggestion.parsedPlan.recurrenceRules).toHaveLength(3);
    expect(
      suggestion.parsedPlan.recurrenceRules.filter((rule) => rule.isOverride).map((rule) => rule.weekdays[0]).sort(),
    ).toEqual(['fri', 'tue']);
    expect(
      suggestion.parsedPlan.recurrenceRules.every((rule) => rule.until === '2026-04-30'),
    ).toBe(true);
  });
});
