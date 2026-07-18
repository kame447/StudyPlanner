# 週間計画storageのユーザー境界書き込みを保護する

Status: planned
Priority: P2
Requirement IDs: none
Updated: 2026-07-18

## 1. 背景

2026-07-18の監査で、userId変更直後に旧userの週間計画stateを新user keyへ書き得るeffect順序と、全user共通のapproval ledger keyを確認した。

観測事実:

- `useWeeklyPlanningState`はload effectの後にsave effectを宣言している。
- userId変更renderではload effectが新user stateをsetするが、同じcommitのsave effectは旧render closureの`planningState`を新user keyへ保存する。
- 次renderで正しいstateへ上書きされるが、その間にtab終了等が起きると旧user dataが残る。
- approval ledgerは`studyplanner-weekly-approval-ledger-v1`の単一keyに全user operationを保存する。
- application hookのledger stateはlazy initializerでmount時に1回だけ読み込まれ、userId変更時のreload契約がない。

## 2. 目的

stateと保存先identityを同一snapshotとして扱い、旧user/weekのstateを新identity keyへ書かない。approval ledgerはuser別にload/saveし、user切替時に旧user operationを新user keyへ書かない。

## 3. 計画書との対応

- product spec: none
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のstorage boundary
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: none

## 4. Entry conditions

- React effect順序だけでなく、各renderがcaptureしたstate identityをtestで確認する。
- legacy共通ledger内に複数userのoperationが混在する前提でmigrationを設計する。
- trace featureのremount有無に依存せず安全なhook契約にする。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/useWeeklyPlanningState.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalLedgerStorage.ts`
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
- 新規: 必要ならstorage identity型またはmigration helper
- テスト:
  - user/week rerender時の保存key
  - ledger user分離
  - legacy migrationの中断・再実行

## 6. 現在の処理経路

```text
render(new userId, old planningState closure)
→ load effect: new user stateをset
→ save effect: old planningStateをnew user keyへ保存
→ next render: new stateで上書き

ledger
→ mount時に共通keyを1回load
→ user変更後も同じReact stateを保持
→ 共通keyへ全operationを保存
```

## 7. 確認済みの事実

- `planningState.weekStartDate !== weekStartDate` guardは週不一致を一部防ぐが、同じ週開始日の別userを区別しない。
- load effectでidentity refを先に新値へ更新し、後続save effectでrefだけを比較する案では不十分である。同じcommitのsave effectが旧state closureを持つため、refは新identityでもstateは旧userのままになる。
- ledger operation自体はuserIdを持つため、legacy keyをuser別にpartitionできる。

## 8. 未確認事項

- anonymous keyに実operationが保存済みの既存利用者がいるか。
- userIdをそのままlocalStorage keyへ含める既存規約と、encode/hashの必要性。

## 9. 問題点

- state内容と保存先identityが別々に管理され、effect順序によるcross-user writeが可能である。
- ledgerをkeyだけuser別化しても、hook stateをuser変更時に入れ替えなければ旧user operationを新user keyへ保存する競合が残る。

## 10. 修正方針

- `useWeeklyPlanningState`ではplanning stateと、そのstateをloadした`userId + weekStartDate` identityを同じReact state snapshotとして保持する。例として`{ identity, planningState }`を単一stateにする。
- save effectはrender時にcaptureしたsnapshot.identityと現在propsから導出したidentityが一致する場合だけ保存する。先行load effectがmutationしたrefだけを根拠にしない。
- reducer dispatchは現在snapshotのplanningStateを更新し、identityを維持する。identity切替中に旧stateへactionを適用しないtestを追加する。
- approval ledger APIはuserIdを必須引数にし、user別keyを選択する。
- application hookは`approvalOperations`とownerIdを同じsnapshotとして保持し、owner変更renderでは旧owner operationsを新owner keyへ保存しない。新owner ledgerをloadしてから保存可能にする。
- legacy共通key migrationはoperationをuserIdごとにpartitionする。current user分だけ移す場合は、残りuser分をlegacy keyへ書き戻し、空になるまで削除しない。全groupを一括移行する場合は、全user keyへのmerge成功後だけlegacy keyを削除する。
- migrationは既存per-user operationとapprovalOperationIdでmergeし、再実行しても重複しない。

## 11. 触らない範囲

- planning state schema自体の変更
- approval判定規則
- server-side ledger
- trace repository
- account deletion全体

## 12. 受け入れ条件

- 同一週開始日のuser A→user B切替renderで、AのstateをB keyへ一度も書かない。
- 週切替でも旧週stateを新週keyへ書かない。
- load完了前のidentityへsaveしない。
- user Aのledger stateをuser B keyへ書かず、user Bへ切替後はBのoperationだけを返す。
- legacy共通keyにA/B両方のoperationがある場合、Aの初回migration後もBのoperationを失わない。
- migration中断後の再実行でoperationが重複せず、既存duplicate preventionが維持される。
- trace feature flagによるApp remountの有無にかかわらずtestが通る。

## 13. テスト観点

- unit: identity snapshot比較、ledger key、partition/merge migration。
- integration: hook rerenderでuser/week切替、同一commit中のsetItem呼出し内容を検証する。
- browser/manual: 同一ブラウザで2accountを切り替え、各key内容と復元stateを確認する。
- regression: 通常save/load、approval partial retry、sign-out→sign-in。
- property/fuzz: legacy ledgerをuserIdでpartitionし、operation集合が欠落・重複しないproperty testを検討する。

## 14. リスク

- refだけのguardは監査対象bugを直さないため採用しない。
- migration途中でlegacy keyを先に削除すると他user dataを失う。copy/merge完了後に削除または残余を書き戻す。
- raw userIdをkeyへ含める場合、ログ・スクリーンショットへの露出を既存storage key規約と合わせる。

## 15. Dependencies

- 先行推奨: `20260718-weekly-planning-application-behavior-tests.md`のuser rerender harness。
- 関連: `20260716-weekly-planning-approval-persistence-and-idempotency.md`。
- approval ledger APIを変更するtaskとは直列に実施する。

## 16. Exit conditions

- targeted test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- migration手順、crash時挙動、legacy key削除条件を最終報告へ記載する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
