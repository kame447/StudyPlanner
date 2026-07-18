# 進行中承認をreset・週変更で中断可能にする

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18

## 1. 背景

2026-07-18の監査で、承認実行中にsession resetまたは週変更が起きても、approval domainが残りitemの保存を続行することを確認した。

観測事実:

- reducerは`pendingApproval`中でも`reset_session`を許可し、draftとpending ownershipを破棄する。
- `executeWeeklyDraftApproval`はitem loop中にapplication stateを再確認しない。
- 週変更時は別週stateがloadされ、旧`pendingApproval`は失われる。
- 保存処理は継続するが、完了actionはrequest mismatchでno-opとなるため、ユーザーへ通知されない。

## 2. 目的

承認開始時のownershipが失われた後は、新しいitemの重複確認・保存を開始しない。既に完了したitemはoperationへ残し、失われたstateへ成功・失敗messageを適用しない。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`のreviewable applyと破棄
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のrequest invalidation
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001

## 4. Entry conditions

- `20260718-weekly-planning-approval-save-side-effect-isolation.md`を先に実施し、保存自身が週変更を起こす主要因を除去する。
- application test harnessでdeferred saveとreset/week rerenderを制御できることを確認する。
- repository write開始後の単一itemは現行APIではcancelできないため、保証範囲を「次のitemを開始しない」と明記する。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/planning/weeklyPlanningApproval.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`
- 新規: なし
- テスト:
  - approval domainの継続判定test
  - application層のreset・週変更競合test

## 6. 現在の処理経路

```text
begin_approval
→ executeWeeklyDraftApproval
  → findExistingPlanId
  → saveBlock
  → 次itemへ継続
← reset / week loadを監視しない
→ onOperationCompleted
→ complete_approvalまたはfail_approval(request mismatchならno-op)
```

## 7. 確認済みの事実

- pending ownershipは`requestId`、`weekStartDate`、`baseRevision`を持つ。
- reducerは古いcomplete/fail actionを拒否するが、repository write自体は止めない。
- 現在のUIではapproval中の一部操作がdisabledでも、hook/API、週変更、副作用によってownership喪失は起こり得る。
- 既に開始したrepository upsertをAbortSignalで停止する契約はない。

## 8. 未確認事項

- 中断時のoperationをlocal ledgerへどの時点で書くか。item単位の永続化はserver-side idempotency taskと調整する。
- reset操作をapproval中UIで許可するかというUX判断。本taskはdomain safetyだけを扱う。

## 9. 問題点

state上は破棄済みの仮予定が無通知で永続化され、ユーザーの破棄意図とrepository内容が一致しない。

## 10. 修正方針

- approval domainへapplication非依存の継続判定callbackを注入する。
- 継続判定は少なくとも各itemの開始前と、非同期`findExistingPlanId`完了後の`saveBlock`直前に実行する。lookup中にownershipを失った場合も保存を開始しない。
- application側は開始時pendingと現在のpendingについて、requestId、weekStartDate、baseRevision、blockIdsの同一性を確認する。
- ownershipを失った場合、現在までのitem結果からoperationを確定して`onOperationCompleted`へ渡す。
- execute完了後にもownershipを再確認し、失われていれば`complete_approval`、`fail_approval`、成功/失敗message生成を行わずreturnする。
- 既に`saveBlock`へ入ったitemの完了は受け入れ、次itemを開始しない。cancel可能repositoryへの拡張は本taskの範囲外とする。

## 11. 触らない範囲

- approval中断ボタンの追加
- `reset_session`自体の禁止
- repository writeへのAbortSignal導入
- server-side claim、item単位永続ledger
- scheduler、preview生成

## 12. 受け入れ条件

- 1件目の保存待ち中にresetし、1件目完了後に2件目以降のlookup/saveを開始しない。
- `findExistingPlanId`待ち中にownershipを失った場合、そのitemの`saveBlock`を呼ばない。
- 週変更でも同じ中断契約が成立する。
- 中断前にsaved/skippedとなったitemはoperationに保持される。
- ownership喪失後に旧stateへcomplete/fail messageをdispatchしない。
- 中断しない全成功、部分失敗、全失敗、retryの挙動を維持する。

## 13. テスト観点

- unit: loop開始前とlookup後の継続判定、残りitemの未実行。
- integration: deferred save中のresetと週変更、保存回数、dispatch、ledger callback。
- browser/manual: approval直後にsessionを破棄しても、破棄後に残りplanが現れない。
- regression: partial retry、duplicate skip、二重approval拒否。
- property/fuzz: 不要。

## 14. リスク

- callbackをitem先頭だけで確認するとlookup中resetを取りこぼすため、save直前の再確認が必須である。
- 中断operationのstatusが`pending`または`partially_saved`になり得る。applicationが`pending`を成功完了として扱わないtestを追加する。

## 15. Dependencies

- 先行: `20260718-weekly-planning-application-behavior-tests.md`、`20260718-weekly-planning-approval-save-side-effect-isolation.md`。
- 関連: `20260716-weekly-planning-approval-persistence-and-idempotency.md`。
- 並行変更禁止: `weeklyPlanningApprovalApplication.ts`を触る他の承認task。

## 16. Exit conditions

- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- cancel可能範囲と中断operation statusを最終報告へ記載する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
