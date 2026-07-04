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
  aiInterpreterFoundation: {
    freeTextExamScopeAndPriority: '数学とOSとハードウェアとソフトウェアとヒューマンサイエンスがあって、2025〜2019までそれぞれある。分野ごとにまとめてやる。数学から始めて最後がヒューマンサイエンスかな',
    fields: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'],
    priorityOrder: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'],
  },
} as const;