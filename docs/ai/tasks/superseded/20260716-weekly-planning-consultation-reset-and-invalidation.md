# 相談resetと派生データ無効化

Status: superseded / consolidated
Superseded: 2026-07-28
Replacement: `../20260728-weekly-planning-personalization-rollout.md`

このworkは未実装であり、完了扱いではない。

旧taskはmessages、intake、未承認preview、planning observation、profile validityを一つのresetへ含めていた。現在はcloud conversation session、observation repository、profile aggregationが未実装であるため、resetだけを独立実装すると部分invalidityと二重authorityを作る。

次の順序でreplacement taskへ統合した。

```text
cloud session identity/revision
→ planning/outcome observation
→ idempotent reset operation
→ observation invalidation
→ aggregate再計算
```

承認済みPlan、完了済みactual、account profile reset、clear conversationは引き続き別operationである。