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
    payloadMissingSmokeResponse: {
      candidates: [
        { command: { confidence: 'high' }, needsConfirmation: false },
        { command: { confidence: 'medium' }, needsConfirmation: true },
      ],
    },
    smokeResponseWithoutConfidence: {
      candidates: [
        {
          command: {
            type: 'set_exam_scope',
            scope: {
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
    topLevelNeedsConfirmationBareCommandResponse: {
      candidates: [
        {
          type: 'set_exam_scope',
          scope: {
            fields: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'],
            totalFields: 5,
            totalYears: 7,
            yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025〜2019' },
            strategyHint: 'field_first',
            unitModel: 'year_field_chunk',
            rawText: ['実AI応答'],
          },
          sourceText: '実AI応答',
          confidence: 'high',
        },
        {
          type: 'set_priority_policy',
          policy: { kind: 'field_first', order: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'] },
          sourceText: '実AI応答',
          confidence: 'medium',
        },
      ],
      needsConfirmation: false,
    },
    completeCommandResponse: {
      candidates: [
        {
          command: {
            type: 'set_planning_range',
            range: {
              startDateTime: '2026-07-06',
              endDateTime: '2026-07-12',
              sourceText: '来週',
              confidence: 'explicit',
            },
            sourceText: '来週',
            confidence: 'high',
          },
          needsConfirmation: false,
        },
        {
          command: {
            type: 'set_exam_scope',
            scope: {
              fields: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'],
              totalFields: 5,
              totalYears: 7,
              yearRange: { startYear: 2025, endYear: 2019, sourceText: '2025〜2019' },
              strategyHint: 'field_first',
              unitModel: 'year_field_chunk',
              rawText: ['実AI応答'],
            },
            sourceText: '実AI応答',
            confidence: 'high',
          },
          needsConfirmation: false,
        },
        {
          command: {
            type: 'set_priority_policy',
            policy: { kind: 'field_first', order: ['数学', 'OS', 'ハードウェア', 'ソフトウェア', 'ヒューマンサイエンス'] },
            sourceText: '実AI応答',
            confidence: 'medium',
          },
          needsConfirmation: true,
        },
      ],
    },
  },
  // semantic intent の real-AI 品質評価用 golden cases。
  // task md 記載の例文ではなく、意図的に「未記載の表現揺れ」を含める(意味レベルの汎化を測るため)。
  // 現在 active な参照元は timetable と existing_plans のみ(外部 calendar 連携は未実装)。
  semanticIntent: {
    // 一意に timetable を指す表現 → use_constraint_source(timetable)。
    useConstraintSourceUnambiguousTimetable: [
      '時間割に登録してある授業はそのまま使って',
      '今学期の時間割ベースで組んでほしい',
      'アプリの時間割に入ってる授業は避けて',
    ],
    // 一意に existing_plans(保存済み予定)を指す表現 → use_constraint_source(existing_plans)。
    useConstraintSourceUnambiguousExistingPlans: [
      'アプリに保存してある予定と被らないようにして',
      'もう登録してある予定はそのまま生かして',
      '保存済みのスケジュールは避けて配置して',
    ],
    // timetable / existing_plans のどちらを指すか一意に決められない曖昧表現。
    // 単一 source に勝手に確定させず、clarification に倒れることを期待する。
    useConstraintSourceAmbiguous: [
      '授業はカレンダーに入れてあるやつでお願い',
      'カレンダーに入ってる予定を使って',
      '入れてあるやつをそのまま考慮して',
    ],
    // 用語・質問の意味の聞き返し = request_clarification。
    requestClarificationParaphrases: [
      '固定の予定っていうのはどこまで含むの？',
      'さっきの質問、いまいち意味が掴めなかった',
      '何を入力したらいいのか教えてほしい',
      'その「分野」ってどういう区切りのこと？',
    ],
    // use_constraint_source / request_clarification のどちらも発火してはいけない入力。
    // 授業・予定などの語を含むが「既存ソースを使う」意図でも「聞き返し」でもないもの。
    negativeCases: [
      '来週は予定が立て込んでいて忙しい',
      '授業の予習を今週のうちに進めたい',
      '過去問を全部やりたい',
    ],
  },
} as const;