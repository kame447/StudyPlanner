# 固定予定を対象期間occurrenceから決定的にgroundingする

Status: closed
Closed: 2026-07-16
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening-review-fixes.md`

## 完了条件

- [x] exam・non-examの固定予定質問を保存済み予定だけから再構成する
- [x] AIのacknowledgementやreasoningに未登録予定を表示しない
- [x] planning rangeの開始・終了時刻を考慮する
- [x] 繰り返し予定を対象期間occurrenceへ展開する
- [x] summaryとconstraint-source availabilityで同じ抽出関数を使う
- [x] 範囲外予定だけならexisting_plansを利用不可にする
- [x] 回帰テストを追加する
