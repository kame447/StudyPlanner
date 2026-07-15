# 週間計画の聞き返し対象と直前質問コンテキストの一般化

## 背景

PR #3で聞き返しを`request_clarification`へ統合したが、active questionを`createMissingQuestionPlan(previousState)`の有無から推測していた。このため、実現可能性の調整、選択肢提示、preview確認、承認など、missingではない質問の直後に「よく分からない」と入力すると聞き返しとして扱えなかった。

また、用語説明の対象は`ref`から解決していた一方、回答例は`questionPlan[0]`から選んでいた。そのため「固定の予定って何ですか？」に固定予定の説明と計画開始日の回答例が混在する問題があった。

## 修正方針

`PlanningIntakeState.lastQuestionContext`へ、直前に実際に描画された質問の`targetSlot`、`intent`、`topicId`、`actionId`をsession-localで保持する。次turnではmissingを再計算せず、このコンテキストの有無を文脈依存の聞き返し判定に使用する。

clarification targetはcommandの`target`に従って解決する。

- `referenced_question`: `lastQuestionContext.targetSlot`
- `referenced_term`: `ref`から解決した用語slot
- `unresolved_slot`: `ref`のslot

解決済みの`targetSlot`を`WeeklyPlanningDialogueDecision.clarification`から公開behavior-aware pipelineまで伝播し、説明と回答例を必ず同じslotから生成する。

## 責務境界

- clarification parser: 発話を`request_clarification`へ正規化し、文脈依存表現は実際に描画された質問がある場合だけ受理する
- intake pipeline wrapper: AI、rules、provider fallbackの結果を単一のclarification decisionへ正規化する
- dialogue manager: command targetからclarification target slotを解決し、説明文を決定する
- behavior-aware pipeline wrapper: 実際に描画されたactionから次turn用の質問コンテキストを保存する
- clarification renderer: decisionで解決済みのtarget slotに対応する回答例を描画する

既存pipeline本体はcoreとして保持し、公開pipelineで文脈管理を合成する。これにより既存のintake・behavior変換責務を変更せず、対話セッションの文脈だけを境界層へ分離する。

## 回帰条件

- 明示用語と先頭missing slotが異なっても説明と回答例が一致する
- missing以外の質問後でも文脈依存の聞き返しを処理できる
- missingが残っているだけではactive questionとみなさない
- 非質問後の「よく分からない」を聞き返しと断定しない
- AI command、AI空応答、rules-only、provider失敗で同じclarification decisionへ到達する
- 特定の一文の完全一致を追加せず、意味カテゴリと質問コンテキストで処理する
