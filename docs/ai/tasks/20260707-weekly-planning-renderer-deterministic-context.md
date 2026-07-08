# renderer deterministic context の拡充(planning period・対象単位・既知予定の不足部分)

AI dialogue renderer が planning period(来週)などの事実を持たず、質問文で「今週」と勝手に補完したり、内部語(「固定の予定」)をそのまま出したりする。RenderInput の deterministic context が不足しているのが原因。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 背景(実例)

実例1(「来週」が「今週」に化ける):
```text
ユーザー: 来週、過去問を進めたい
アプリ: 今週取り組みたいことや達成したい目標はありますか？   ← 来週なのに今週
```

実例2(内部語がそのまま出る):
```text
アプリ: 固定の予定があれば教えてください。
ユーザー: 固定の予定って何ですか？   ← 内部用語が伝わらない
```

## 現行原因(コード確認済み)

- `DialogueRenderInput.acceptedFacts`(`weeklyPlanningDialogueRenderer.ts`)は `fields / yearRange / unitRateMinutes / priorityOrder / constraintSummary` のみ。**planning period(state.range の「来週」)が含まれない。** AI renderer は planning period を知らないため「今週」等を補完する(=AI が事実を勝手に補完しているのではなく、renderer input 自体が不足)。
- `DialogueNextQuestion` は `slotKey / intent / questionKind / options`。intent は `MISSING_FIELD_KEYS` 由来の内部キー的な語(`ask_fixed_events` 等)で、**ユーザー語彙への言い換えヒントがない**。AI は intent をほぼ直訳し「固定の予定」のような内部語的表現になる。
- 「対象単位(過去問=年度)」「既知予定の不足部分(何は分かっていて何が足りないか)」も renderer context にない。

## 対象範囲

- `DialogueRenderInput` に deterministic context を追加する:
  - planning period(state.range を「来週」等の表現素材として渡す。日付そのものでなく period ラベル）。
  - 対象単位(exam prep なら「年度」等)。
  - 各 nextQuestion に「ユーザー語彙のヒント / 平易な言い換え」(intent キーの内部語をそのまま訳させない)。options も活用。
  - 既知予定の不足部分(「バイトは受理済み、授業の時刻が未確定」など、差分を尋ねる素材)。※ fixed_events の状態区別タスクが入った後はその状態を context に載せる。
- deterministic fallback(`renderDeterministicMissingQuestions` / `fallbackQuestionText`)も、planning period と平易語彙を反映する。AI 未使用でも「今週/来週」を正しく出す。
- AI が context 外の事実を補完しないことをプロンプト/検証で担保(context にない period を勝手に決めない)。

## 対象外

- 「何を聞くか」の決定(questionPlan・missing 判定)。本タスクは「どう言うか」に必要な context の供給のみ。
- fixed_events の状態モデルそのもの(別タスク。本タスクはその状態を context へ渡す接続まで)。
- completion target モデル(別タスク)。
- AI renderer の sanitize/fallback の安全性ロジック(既存の観点1・2 は不変)。

## 完了条件

- 「来週」の入力に対し、質問文が「今週」と誤らない(AI・deterministic fallback とも)。
- intent の内部語がユーザー語彙へ言い換えられる素材が context にあり、「固定の予定」のような内部語的表現が緩和される。
- 既知予定の差分(受理済み/不足)を尋ねる素材が context に載る。
- 既存の renderer 観点1・2(計画外 slot 破棄・failure fallback・questionPlan 順再構成)が不変。weeklyPlanning テスト green / build 成功。

## 必要な regression test

- 「来週」state で RenderInput に planning period が含まれ、deterministic fallback が「来週」を出す(「今週」と誤らない)。
- nextQuestion に言い換えヒントが含まれる(fixed_events → 平易語彙)。
- AI renderer 経由でも sanitize が計画順・計画外破棄を維持(既存不変)。
- planning period 未設定時のフォールバック挙動。

## roadmap 対応

R2-D renderer の後続改善(context 拡充)。監査(2026-07-07)で挙げた renderer 改善群の一部。小さく即効(実例1の事実誤り・内部語を直接改善)。**先行回収を推奨。**
