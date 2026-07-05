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
    smokeResponseWithoutConfidence: {
      candidates: [
        {
          command: {
            type: 'set_exam_scope',
            scope: {
              examType: '院試',
              fields: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'],
              totalFields: 5,
              totalYears: 7,
              yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025〜2019' },
              strategyHint: 'field_first',
              unitModel: 'field-year',
              rawText: ['実AI応答'],
            },
            sourceText: '実AI応答',
          },
          needsConfirmation: false,
        },
        {
          command: {
            type: 'set_priority_policy',
            policy: { kind: 'field_first', order: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'] },
            sourceText: '実AI応答',
          },
          needsConfirmation: false,
        },
      ],
    },
  },
} as const;