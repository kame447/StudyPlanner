# 週間計画 rules 経路の入力から保存完了までの横断結合テスト

## 目的

AI interpreter を使用しない `rules` 経路について、ユーザー入力を受け取ってから仮予定を生成し、preview を通常の仮予定へ昇格し、承認・保存・完了通知まで到達する一連の処理を横断的に検証する。

単体テストを増やすこと自体を目的にせず、各層の契約が実際に接続されていることを保証する。

## 対象経路

```text
ユーザー入力
→ executeWeeklyPlanningTurn
→ rules parser / intake reducer
→ missing 判定 / dialogue renderer
→ draftCandidates 生成
→ preview block 変換
→ WeeklyPlanDraftBlock への昇格
→ begin_approval
→ approval guard
→ PlanDraft 変換
→ saveWeeklyApprovedPlan
→ completeWeeklyApprovalOperation
→ complete_approval
→ 仮予定消去 / 完了メッセージ
```

## 対象外

- LLM API 通信
- AI interpreter の command 生成
- AI dialogue planner
- Firestore 実環境への書き込み
- ブラウザ全体を起動する E2E

保存境界は in-memory fake を使用する。ただし、approval application、approval guard、interruptible approval、PlanDraft 変換、planning reducer は実物を通す。

## 検証項目

1. rules provider で入力を処理する。
2. 条件充足済み intake state に対する作成指示から `draftCandidates` が生成される。
3. 候補の日付・時間・タイトル・field が昇格後 block へ保持される。
4. preview から昇格した block が `draft` / `未保存` として扱われる。
5. 承認時に候補数と同数の保存処理が実行される。
6. 保存される予定に週間計画 provenance が付与される。
7. operation 完了処理は全件保存後に一度だけ実行される。
8. 完了後に `pendingApproval` と承認済み draft block が残らない。
9. 最終 assistant message が保存件数を通知する。
10. 保存処理中に画面側の選択日相当の値が変化しても、承認対象 state を失わず完了する。

## 完了条件

- 横断結合テストが追加されている。
- AI interpreter を mock するのではなく、設定を `rules` に固定して実 executor を通している。
- 保存 repository 境界以外の主要処理を mock していない。
- 対象テスト、全テスト、build が成功する。
