# 週間計画の対話経路を既存pipelineへ直接統合する

Status: open
Parent: `20260715-weekly-planning-dialogue-path-issue-breakdown.md`
Depends on:

- `20260715-weekly-planning-ai-deterministic-baseline.md` closed
- `20260715-weekly-planning-dialogue-action-priority-and-fallback.md` closed
- `20260715-weekly-planning-clarification-context-generalization.md` closed

## 背景

挙動修正と回帰テストは成立しているが、GitHub APIのファイル更新制約を回避する過程で、既存pipelineを`Core`へ複製し、公開wrapperから合成する構成や、一時的なhelper、triggerが追加された。

この構成は挙動の検証には利用できるが、変更差分が大きく、同じ責務を持つ実装が複数箇所へ分散している。挙動修正を維持したまま、既存の責務境界へ直接統合する必要がある。

## このtaskで行うこと

`weeklyPlanningIntakePipeline.ts`と`weeklyPlanningBehaviorAwareIntakePipeline.ts`へ、必要なclarification context処理を直接統合する。

通常dialogue decisionとclarification decisionは、循環参照や責務重複を生まない最小構成にする。

次の一時構成を削除する。

- `weeklyPlanningIntakePipelineCore.ts`
- `weeklyPlanningBehaviorAwareIntakePipelineCore.ts`
- `weeklyPlanningDialogueManagerCore.ts`
- 直接統合後に不要となるclarification wrapper/helper
- `.agent-integration-trigger`
- PR差分へ混入した一時検証用ファイル

## 制約

- closed taskで確定した挙動を変更しない
- parserの個別完全一致表現を増やして回避しない
- legacy fallbackをAI成功経路へ戻さない
- action上限や優先順位を元の単純sliceへ戻さない
- stateの永続保存形式を変更しない。`lastQuestionContext`はsession-localとする
- cleanupを理由に新しい会話仕様を追加しない

## 完了条件

- [ ] core複製が削除されている
- [ ] 公開pipelineから別名coreへ委譲していない
- [ ] clarification targetとlastQuestionContextの責務が一意である
- [ ] 一時trigger、script、検証artifactがPR差分に残っていない
- [ ] PRの変更ファイル数と差分量が、実際の機能変更に見合う範囲へ縮小している
- [ ] closed taskの回帰テストがすべて維持される

## 対象外

全テスト、build、diff checkの最終実行、PR本文更新、baseの復帰は次のtaskで行う。

`20260715-weekly-planning-dialogue-path-pr-finalization.md`
