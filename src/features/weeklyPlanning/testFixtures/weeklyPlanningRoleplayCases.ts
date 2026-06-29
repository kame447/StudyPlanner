export const SELECTED_DATE_FOR_WEEKEND_ROLEPLAY = '2026-06-26';

export const WP_RP_001_WEEKEND_EXAM_TURNS = {
  rangeOnly: '今日の19時から土日の終わりまで予定立てたい',
  examScope: [
    'とりあえず、院試進めたいよね',
    '5分野あって',
    '第 1 部　数学・数理系',
    '第 2 部　ソフトウェア系',
    '第 3 部　ハードウェア系',
    '第 4 部　OS とネットワーク',
    '第 5 部　ヒューマンサイエンス系',
    'なんだけど、七年分あって今は分野ごとに進めてて、数理系の2021まで終わってる',
  ].join('\n'),
  unitRateOnly: '一分野の一年分は2時間くらい',
  yearRangeProgressAndUnitRate: [
    '7年分は2019〜2025',
    '数学の25〜21が終わったよ',
    '一分野の一年分は2時間くらい',
  ].join('\n'),
  priorityPolicy: '分野ごとに進めてるので、数学が終わったらソフトウェアをやりたい',
  lifeConstraints: [
    'あ、今日のご飯は19時までに済ますよ',
    '一応お風呂とか寝る時間も考慮してほしいな',
  ].join('\n'),
  noFixedEvents: '他の固定予定はない',
};

export const WP_RP_001_WEEKEND_EXAM_EXPECTED = {
  yearRange: {
    startYear: 2019,
    endYear: 2025,
    sourceText: '2019〜2025',
  },
  completedYearsByField: {
    '数学・数理系': [2025, 2024, 2023, 2022, 2021],
  },
  unitRate: {
    unit: 'year_field_chunk',
    minutesPerUnit: 120,
    source: 'user',
  },
  priorityOrder: ['数学・数理系', 'ソフトウェア系'],
  remainingYearsByField: {
    '数学・数理系': [2020, 2019],
    'ソフトウェア系': [2025, 2024, 2023, 2022, 2021, 2020, 2019],
  },
  fixedEvents: [],
} as const;

export const WEEKLY_PLANNING_INTAKE_EVALUATION_CASES = {
  fieldScopedCompletionParaphrases: [
    '数学の2025〜2021は済んだ',
    '数学は25から21まで完了',
  ],
  nonCompletionPolarityExamples: [
    '数学の25〜21はまだ終わってない',
    '数学の25〜21をやる予定',
    '数学の25〜21が終わったら22をやる',
  ],
  fieldScopeAmbiguousCompletion: '25〜21が終わったよ',
  unitRateExamples: {
    unavailableDuration: '今日は2時間しかない',
    contextualYearRate: '一年分は2時間くらい',
  },
  fixedEventExamples: {
    noFixedEvents: '固定予定は特にない',
    confirmedFixedEvent: '15時から病院がある',
    ambiguousFixedEvent: 'ゼミがあるかも',
  },
} as const;