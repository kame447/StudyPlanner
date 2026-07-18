# 週間計画approval永続idempotency 完了記録

Status: complete / merged / automated verified
Completed: 2026-07-18
Implementation: PR #60、PR #62、PR #63
Verification: GitHub Actions runs `29648193062`、`29649806549`、`29650224824`

## 完了内容

- `weekly-planning` source typeとversion付き構造化provenanceをPlanへ保存した。
- `userId + approvalOperationId + sourceDraftBlockId`をserver-side item identityとした。
- Firestore transaction内でoperation progress、item、Planを原子的に保存する。
- deterministic Plan IDによりmulti-tab・multi-deviceの同時保存を一件へ収束させる。
- item/operation記録消失時はPlan provenanceとdurable itemからprogressを復旧する。
- item保存済みでPlanが欠落する場合は再作成せずfail closedとする。
- server finalize失敗後はPlanを再保存せずfinalizeだけを再試行する。
- operation/itemのowner、identity、進捗単調性をFirestore rulesで制約した。
- operationと専用item subcollectionの双方へ180日TTL用`expiresAt`を保存した。

## 保証範囲

実装と自動検証は完了した。次は未完了であり、別の運用rollout taskを正とする。

- 本番Firestore rules deploy
- `weekly_planning_approval_operations.expiresAt`のTTL policy有効化
- `weekly_planning_approval_items.expiresAt`のTTL policy有効化
- Firestore Emulatorでのrules/transaction検証
- 実ブラウザ・複数client確認