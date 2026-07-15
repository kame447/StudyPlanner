# 週間計画の聞き返し対象と直前質問コンテキストの一般化

Status: closed
Closed: 2026-07-15
Parent: `20260715-weekly-planning-dialogue-path-issue-breakdown.md`

## 対象問題

聞き返し判定が`createMissingQuestionPlan(previousState)`へ依存していたため、実現可能性の調整、選択肢提示、preview確認など、missingではない質問の直後に「よく分からない」と入力しても聞き返しとして扱えなかった。

また、説明対象は`ref`から解決する一方、回答例は`questionPlan[0]`から選んでいたため、「固定の予定って何ですか？」に固定予定の説明と計画開始日の回答例が混在する可能性があった。

## 実施内容

`PlanningIntakeState.lastQuestionContext`へ、直前に実際に描画された質問の`targetSlot`、`intent`、`topicId`、`actionId`をsession-localで保持する設計を追加した。

clarification targetはcommandの`target`に従って解決する。

- `referenced_question`: `lastQuestionContext.targetSlot`
- `referenced_term`: `ref`から解決した用語slot
- `unresolved_slot`: `ref`のslot

解決済みの`targetSlot`をclarification decisionからbehavior-aware rendererまで伝播し、説明と回答例を同じslotから生成するようにした。

## 完了条件

- [x] 明示用語と先頭missing slotが異なる場合も、説明と回答例が一致する
- [x] missing以外の質問後でも文脈依存の聞き返しを処理できる
- [x] missingが残っているだけではactive questionとみなさない
- [x] 非質問後の「よく分からない」を聞き返しと断定しない
- [x] AI command、AI空応答、rules-only、provider失敗で同じclarification decisionへ到達する
- [x] 特定の一文の完全一致ではなく、意味カテゴリと質問コンテキストで処理する
- [x] 追加回帰テストが通る

## 完了根拠

週間計画テスト、build、diff checkを通過した構成で上記の回帰条件を確認済みである。

## 対象外

既存pipelineへ直接統合してcore複製や一時helperを削減する作業は、次のopen taskで扱う。

`20260715-weekly-planning-dialogue-path-implementation-cleanup.md`
