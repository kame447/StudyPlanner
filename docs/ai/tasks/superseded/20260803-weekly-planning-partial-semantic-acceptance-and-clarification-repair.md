# 週間計画 部分意味受理と曖昧性修復

Status: superseded as execution record / capability deferred for post-refactor re-evaluation
Original date: 2026-08-03
Superseded: 2026-08-11

このtaskは、partial semantic acceptance、ambiguity lifecycle、clarification transaction、resolved-only scheduler viewをPR #109へ継続実装する前提で作られた。

その前提は現在の実行順と一致しないため、active queueから外す。

現在の順序:

```text
PR #109 merge-readiness
→ #109 merge
→ legacy / 過去経路削除
→ Stable V5挙動不変リファクタ
→ 7視点再棚卸し
→ 必要性を再評価して新task化
```

partial semantic acceptanceという問題領域自体を却下したわけではない。legacy削除とリファクタ後の7視点監査で、現在のStable V5に残る実測問題から要件を再導出する。

古いtask本文の次の前提は復活させない。

- PR #109へそのまま追加実装する。
- 古い固定scenarioや旧CI失敗を受け入れ条件の中心にする。
- 2026-08-03時点のschema不足を現在も未解決だと自動継承する。

再着手する場合は、新しいmainの実装と実API観測を基に別taskを作る。

現在の正本:

- `docs/ai/strategy/weekly-planning-roadmap.md`
- `docs/ai/strategy/weekly-planning-semantic-v5-roadmap.md`
- `docs/ai/tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md`
